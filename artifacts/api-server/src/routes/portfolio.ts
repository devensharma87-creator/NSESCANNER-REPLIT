/**
 * Portfolio Analyser — per-user saved portfolios (Phase 2).
 *
 *   GET    /portfolios               — list the user's portfolios (metadata)
 *   POST   /portfolios               — create a named portfolio (+holdings)
 *   GET    /portfolios/:id           — one portfolio with its holdings
 *   PATCH  /portfolios/:id           — rename and/or set as default
 *   DELETE /portfolios/:id           — delete portfolio (+holdings, cascade)
 *   PUT    /portfolios/:id/holdings  — replace all holdings (bulk save)
 *
 * Every row is scoped by an opaque `ownerKey` ("owner" for the site owner,
 * "u:<id>" for subscribers) — mirrors the personal-watchlist pattern. Reads
 * in public-access mode return empty / 404 (no per-user identity); all writes
 * 403 for cookieless visitors. We persist ONLY user-supplied figures — never
 * any live-market or fabricated value.
 */

import { Router, type IRouter, type Request } from "express";
import { eq, and, asc, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  portfoliosTable,
  portfolioHoldingsTable,
  type PortfolioHoldingRow,
} from "@workspace/db/schema";
import {
  CreatePortfolioBody,
  UpdatePortfolioBody,
  ReplacePortfolioHoldingsBody,
} from "@workspace/api-zod";
import { getSession, requireSubscriberOrOwner } from "../lib/userAuth";
import { isPublicAccessEnabled } from "../lib/publicAccess";
import {
  resolveInstrument as resolveMasterInstrument,
  isResolverReady,
} from "../lib/marketData/instrumentResolver";

const router: IRouter = Router();

const SYMBOL_RE = /^[A-Z0-9.\-_&^]{1,40}$/;
const MAX_PORTFOLIOS_PER_OWNER = 50;
const MAX_HOLDINGS = 500;

function ownerKeyFor(req: Request): string | null {
  const s = getSession(req);
  if (!s) return null;
  return s.role === "owner" ? "owner" : `u:${s.userId}`;
}

function paramId(req: Request): string {
  const v = req.params["id"];
  return typeof v === "string" ? v : "";
}

type HoldingInput = {
  symbol: string;
  name?: string | null;
  exchange?: string | null;
  sector?: string | null;
  purchaseDate?: string | null;
  qty: number;
  rate: number;
  isin?: string | null;
  broker?: string | null;
  tag?: string | null;
  notes?: string | null;
  dividendReceived?: number | null;
  realisedPnl?: number | null;
};

type CleanHolding = {
  symbol: string;
  name: string | null;
  exchange: string | null;
  sector: string | null;
  purchaseDate: string | null;
  qty: number;
  rate: number;
  isin: string | null;
  broker: string | null;
  tag: string | null;
  notes: string | null;
  dividendReceived: number | null;
  realisedPnl: number | null;
};

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t.slice(0, 200) : null;
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

const BENCHMARK_RE = /^[A-Z0-9]{1,32}$/;

/**
 * Normalise a chosen benchmark key. Opaque to the server — the frontend
 * validates against its known options on read, so we only enforce a safe
 * shape here. Returns null for absent/blank/invalid values so a stale or
 * malformed key never sticks.
 */
function benchmarkOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toUpperCase();
  return BENCHMARK_RE.test(t) ? t : null;
}

/**
 * Validate + normalise an array of holding inputs. Returns an error string on
 * the first invalid row so the whole bulk save is rejected atomically (no
 * partial / silently-dropped holdings).
 */
function sanitizeHoldings(
  raw: HoldingInput[],
): { ok: true; holdings: CleanHolding[] } | { ok: false; error: string } {
  if (raw.length > MAX_HOLDINGS) {
    return { ok: false, error: `too_many_holdings_max_${MAX_HOLDINGS}` };
  }
  const out: CleanHolding[] = [];
  for (let i = 0; i < raw.length; i++) {
    const h = raw[i]!;
    const symbol = (typeof h.symbol === "string" ? h.symbol : "").trim().toUpperCase();
    if (!SYMBOL_RE.test(symbol)) {
      return { ok: false, error: `invalid_symbol_at_index_${i}` };
    }
    const qty = finiteOrNull(h.qty);
    const rate = finiteOrNull(h.rate);
    if (qty === null || qty <= 0) {
      return { ok: false, error: `invalid_qty_at_index_${i}` };
    }
    if (rate === null || rate < 0) {
      return { ok: false, error: `invalid_rate_at_index_${i}` };
    }
    out.push({
      symbol,
      name: str(h.name),
      exchange: str(h.exchange),
      sector: str(h.sector),
      purchaseDate: str(h.purchaseDate),
      qty,
      rate,
      isin: str(h.isin),
      broker: str(h.broker),
      tag: str(h.tag),
      notes: str(h.notes),
      dividendReceived: finiteOrNull(h.dividendReceived),
      realisedPnl: finiteOrNull(h.realisedPnl),
    });
  }
  return { ok: true, holdings: out };
}

function mapHolding(r: PortfolioHoldingRow) {
  return {
    id: r.id,
    symbol: r.symbol,
    name: r.name,
    exchange: r.exchange,
    sector: r.sector,
    purchaseDate: r.purchaseDate,
    qty: r.qty,
    rate: r.rate,
    isin: r.isin,
    broker: r.broker,
    tag: r.tag,
    notes: r.notes,
    dividendReceived: r.dividendReceived,
    realisedPnl: r.realisedPnl,
    sortIndex: r.sortIndex,
  };
}

/** Load one portfolio (with holdings) scoped to ownerKey, or null. */
async function loadPortfolio(owner: string, id: string) {
  const [p] = await db
    .select()
    .from(portfoliosTable)
    .where(and(eq(portfoliosTable.id, id), eq(portfoliosTable.ownerKey, owner)))
    .limit(1);
  if (!p) return null;
  const holdings = await db
    .select()
    .from(portfolioHoldingsTable)
    .where(eq(portfolioHoldingsTable.portfolioId, id))
    .orderBy(asc(portfolioHoldingsTable.sortIndex), asc(portfolioHoldingsTable.createdAt));
  return {
    id: p.id,
    name: p.name,
    isDefault: p.isDefault,
    benchmark: p.benchmark,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    holdings: holdings.map(mapHolding),
  };
}

// ----- list -----

router.get("/portfolios", requireSubscriberOrOwner(), async (req, res) => {
  const owner = ownerKeyFor(req);
  if (!owner) {
    if (isPublicAccessEnabled()) {
      res.json({ items: [] });
      return;
    }
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const rows = await db
    .select({
      id: portfoliosTable.id,
      name: portfoliosTable.name,
      isDefault: portfoliosTable.isDefault,
      createdAt: portfoliosTable.createdAt,
      updatedAt: portfoliosTable.updatedAt,
      holdingsCount: sql<number>`count(${portfolioHoldingsTable.id})`.mapWith(Number),
    })
    .from(portfoliosTable)
    .leftJoin(
      portfolioHoldingsTable,
      eq(portfolioHoldingsTable.portfolioId, portfoliosTable.id),
    )
    .where(eq(portfoliosTable.ownerKey, owner))
    .groupBy(portfoliosTable.id)
    .orderBy(asc(portfoliosTable.createdAt));
  res.json({
    items: rows.map(r => ({
      id: r.id,
      name: r.name,
      isDefault: r.isDefault,
      holdingsCount: r.holdingsCount,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
});

// ----- create -----

router.post("/portfolios", requireSubscriberOrOwner(), async (req, res) => {
  const owner = ownerKeyFor(req);
  if (!owner) {
    res.status(403).json({
      error: "owner_only_write",
      code: "PUBLIC_MODE_READ_ONLY",
      message: "Sign in to save portfolios.",
    });
    return;
  }
  const parsed = CreatePortfolioBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }
  const name = parsed.data.name.trim();
  if (name.length === 0) {
    res.status(400).json({ error: "invalid_name" });
    return;
  }
  const wantDefault = parsed.data.isDefault === true;
  const benchmark = benchmarkOrNull(parsed.data.benchmark);
  const clean = sanitizeHoldings((parsed.data.holdings ?? []) as HoldingInput[]);
  if (!clean.ok) {
    res.status(400).json({ error: clean.error });
    return;
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(portfoliosTable)
    .where(eq(portfoliosTable.ownerKey, owner));
  if ((count ?? 0) >= MAX_PORTFOLIOS_PER_OWNER) {
    res.status(409).json({ error: `too_many_portfolios_max_${MAX_PORTFOLIOS_PER_OWNER}` });
    return;
  }

  try {
    const created = await db.transaction(async (tx) => {
      // First portfolio for a user is the default unless explicitly told.
      const firstForOwner = (count ?? 0) === 0;
      const makeDefault = wantDefault || firstForOwner;
      if (makeDefault) {
        await tx
          .update(portfoliosTable)
          .set({ isDefault: false })
          .where(eq(portfoliosTable.ownerKey, owner));
      }
      const [p] = await tx
        .insert(portfoliosTable)
        .values({ ownerKey: owner, name, isDefault: makeDefault, benchmark })
        .returning();
      if (clean.holdings.length > 0) {
        await tx.insert(portfolioHoldingsTable).values(
          clean.holdings.map((h, idx) => ({
            portfolioId: p!.id,
            ...h,
            sortIndex: idx,
          })),
        );
      }
      return p!;
    });
    const full = await loadPortfolio(owner, created.id);
    res.status(201).json(full);
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "duplicate_name" });
      return;
    }
    throw err;
  }
});

// ----- detail -----

router.get("/portfolios/:id", requireSubscriberOrOwner(), async (req, res) => {
  const owner = ownerKeyFor(req);
  if (!owner) {
    res.status(isPublicAccessEnabled() ? 404 : 401).json({ error: "not_found" });
    return;
  }
  const full = await loadPortfolio(owner, paramId(req));
  if (!full) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(full);
});

// ----- rename / set default -----

router.patch("/portfolios/:id", requireSubscriberOrOwner(), async (req, res) => {
  const owner = ownerKeyFor(req);
  if (!owner) {
    res.status(403).json({
      error: "owner_only_write",
      code: "PUBLIC_MODE_READ_ONLY",
      message: "Sign in to edit portfolios.",
    });
    return;
  }
  const parsed = UpdatePortfolioBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }
  const id = paramId(req);
  const name = parsed.data.name?.trim();
  const setDefault = parsed.data.isDefault === true;
  // `benchmark` is present in the body (vs. omitted) → user wants to set/clear it.
  const benchmarkProvided = "benchmark" in (parsed.data as Record<string, unknown>);
  const benchmark = benchmarkProvided ? benchmarkOrNull(parsed.data.benchmark) : null;
  if (name === undefined && !setDefault && !benchmarkProvided) {
    res.status(400).json({ error: "nothing_to_update" });
    return;
  }
  if (name !== undefined && name.length === 0) {
    res.status(400).json({ error: "invalid_name" });
    return;
  }

  try {
    const ok = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: portfoliosTable.id })
        .from(portfoliosTable)
        .where(and(eq(portfoliosTable.id, id), eq(portfoliosTable.ownerKey, owner)))
        .limit(1);
      if (!existing) return false;
      if (setDefault) {
        await tx
          .update(portfoliosTable)
          .set({ isDefault: false })
          .where(eq(portfoliosTable.ownerKey, owner));
      }
      const patch: {
        name?: string;
        isDefault?: boolean;
        benchmark?: string | null;
        updatedAt: Date;
      } = {
        updatedAt: new Date(),
      };
      if (name !== undefined) patch.name = name;
      if (setDefault) patch.isDefault = true;
      if (benchmarkProvided) patch.benchmark = benchmark;
      await tx.update(portfoliosTable).set(patch).where(eq(portfoliosTable.id, id));
      return true;
    });
    if (!ok) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const full = await loadPortfolio(owner, id);
    res.json(full);
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({ error: "duplicate_name" });
      return;
    }
    throw err;
  }
});

// ----- delete -----

router.delete("/portfolios/:id", requireSubscriberOrOwner(), async (req, res) => {
  const owner = ownerKeyFor(req);
  if (!owner) {
    res.status(403).json({
      error: "owner_only_write",
      code: "PUBLIC_MODE_READ_ONLY",
      message: "Sign in to delete portfolios.",
    });
    return;
  }
  const deleted = await db
    .delete(portfoliosTable)
    .where(and(eq(portfoliosTable.id, paramId(req)), eq(portfoliosTable.ownerKey, owner)))
    .returning({ id: portfoliosTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json({ ok: true });
});

// ----- replace holdings (bulk save) -----

router.put("/portfolios/:id/holdings", requireSubscriberOrOwner(), async (req, res) => {
  const owner = ownerKeyFor(req);
  if (!owner) {
    res.status(403).json({
      error: "owner_only_write",
      code: "PUBLIC_MODE_READ_ONLY",
      message: "Sign in to save holdings.",
    });
    return;
  }
  const parsed = ReplacePortfolioHoldingsBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
    return;
  }
  const clean = sanitizeHoldings(parsed.data.holdings as HoldingInput[]);
  if (!clean.ok) {
    res.status(400).json({ error: clean.error });
    return;
  }
  const id = paramId(req);
  const ok = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: portfoliosTable.id })
      .from(portfoliosTable)
      .where(and(eq(portfoliosTable.id, id), eq(portfoliosTable.ownerKey, owner)))
      .limit(1);
    if (!existing) return false;
    await tx.delete(portfolioHoldingsTable).where(eq(portfolioHoldingsTable.portfolioId, id));
    if (clean.holdings.length > 0) {
      await tx.insert(portfolioHoldingsTable).values(
        clean.holdings.map((h, idx) => ({ portfolioId: id, ...h, sortIndex: idx })),
      );
    }
    await tx
      .update(portfoliosTable)
      .set({ updatedAt: new Date() })
      .where(eq(portfoliosTable.id, id));
    return true;
  });
  if (!ok) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  const full = await loadPortfolio(owner, id);
  res.json(full);
});

/**
 * Postgres unique-violation detection (SQLSTATE 23505). Drizzle wraps the
 * underlying pg error, so the `23505` code can live on the thrown error OR on
 * its `cause` chain — we walk it so duplicate-name inserts reliably surface as
 * 409, never a 500.
 */
function isUniqueViolation(err: unknown): boolean {
  let cur: unknown = err;
  for (let depth = 0; depth < 5 && cur != null; depth++) {
    if (
      typeof cur === "object" &&
      "code" in cur &&
      (cur as { code?: string }).code === "23505"
    ) {
      return true;
    }
    cur = typeof cur === "object" && "cause" in cur ? (cur as { cause?: unknown }).cause : null;
  }
  return false;
}

// ----- resolver diagnostics -----
//
// GET /portfolio/resolve-debug?symbols=A,B,C
// Owner/subscriber read-only. Shows, per supplied symbol, exactly how the
// canonical instrument resolver maps it (normalized form, ordered strategies
// attempted, the matched strategy, and the resolved canonical instrument) or
// the precise reason it could not be resolved. Pure resolver — no quotes, no
// DB writes, no fabricated data.
router.get("/portfolio/resolve-debug", requireSubscriberOrOwner(), (req, res) => {
  const rawSymbols =
    typeof req.query["symbols"] === "string"
      ? (req.query["symbols"] as string)
      : typeof req.query["symbol"] === "string"
        ? (req.query["symbol"] as string)
        : "";
  const symbols = rawSymbols
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 50);
  if (symbols.length === 0) {
    res.status(400).json({ error: "provide ?symbols=A,B,C", code: "BAD_QUERY" });
    return;
  }
  const results = symbols.map(input => {
    const r = resolveMasterInstrument(input, { preferExchange: "NSE" });
    return {
      input,
      normalized: r.normalized,
      resolved: r.resolved,
      matchedVia: r.matched_via,
      reason: r.reason,
      attempts: r.attempts,
      instrument: r.instrument
        ? {
            canonicalSymbol: r.instrument.canonical_symbol,
            displayName: r.instrument.display_name,
            exchange: r.instrument.exchange,
            instrumentType: r.instrument.instrument_type,
            kiteKey: r.instrument.kite_key,
            instrumentToken: r.instrument.instrument_token,
            bseCode: r.instrument.bse_code,
            aliases: r.instrument.aliases,
            source: r.instrument.source,
          }
        : null,
    };
  });
  res.json({ resolverReady: isResolverReady(), count: results.length, results });
});

export default router;
