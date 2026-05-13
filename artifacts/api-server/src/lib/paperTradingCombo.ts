/**
 * Paper-trading COMBO lane — business logic (Tier C, Phase 1).
 *
 * Server-side orchestration around `paperTradeComboTable` /
 * `paperTradeComboLegTable`. The whole reason this lane exists is so
 * combo trades CAN'T pollute the single-leg `paper_trade_fo` flow; this
 * file does NOT touch the existing F&O paper-trader.
 *
 * Key invariants (enforced here, must not be relaxed without re-review):
 *
 *   1. **Server reprice at open.** The route hands us `{ underlying,
 *      expiry?, legs:[{strike, optionType, action, lots}] }` and nothing
 *      else. We fetch the live chain, run `buildCustomStrategy`, and
 *      persist the snapshot the *server* computed. Client-supplied
 *      premium / Greeks / margin / P&L are impossible by construction —
 *      the openCombo signature does not even accept them.
 *
 *   2. **Server reprice at MTM.** Each MTM tick re-fetches the live chain
 *      and re-runs `buildCustomStrategy` against the persisted leg specs.
 *      We snapshot per-leg `lastPremium` + `lastSource` and the combo's
 *      net mark.
 *
 *   3. **Defined-risk only (v1).** Reject opens where `maxLoss` is null
 *      (unbounded) — this rules out naked short legs and ratio combos
 *      with net short gamma.
 *
 *   4. **Manual entry only (v1).** No auto-trader path. The only way a
 *      row ever lands in `paper_trade_combo` is via the owner-only POST
 *      /paper/combos route.
 *
 * MTM source priority (Phase 1):
 *   chain mid → BS theoretical (via simulateScenario at currentSpot/0/0).
 *
 * WS-priority is deferred to Phase 2 because subscribing arbitrary option
 * tradingsymbols requires explicit per-combo subscription bookkeeping —
 * see `docs/combo-paper-trader-design.md`.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  paperTradeComboTable,
  paperTradeComboLegTable,
  type PaperTradeComboRow,
  type PaperTradeComboLegRow,
} from "@workspace/db";
import { fetchOptionChain } from "./optionChain";
import { computeAnalytics } from "./optionAnalytics";
import { enrichAnalyticsWithIv } from "./ivHistory";
import {
  buildCustomStrategy,
  simulateScenario,
  type CustomLegSpec,
  type CustomStrategyResponse,
} from "./optionStrategies";
import { logger } from "./logger";

/** Maximum simultaneously-OPEN combos per account. Conservative for v1. */
export const COMBO_MAX_OPEN = 5;
/** Reject opens whose net debit exceeds 5 % of seed equity (₹10L → ₹50k). */
export const COMBO_SEED_EQUITY_RUPEES = 1_000_000;
export const COMBO_MAX_NET_DEBIT_PCT = 0.05;

export type ComboOpenError =
  | { code: "EMPTY"; message: string }
  | { code: "TOO_MANY_LEGS"; message: string }
  | { code: "TOO_MANY_OPEN"; message: string }
  | { code: "CHAIN_UNAVAILABLE"; message: string }
  | { code: "BUILD_FAILED"; message: string }
  | { code: "UNDEFINED_RISK"; message: string }
  | { code: "DEBIT_TOO_LARGE"; message: string };

export interface OpenComboInput {
  underlying: string;
  /** Optional YYYY-MM-DD expiry override; default = chain's nearest. */
  expiry?: string;
  /**
   * Leg specs from the client. ONLY `strike / optionType / action / lots`
   * are honoured — `premiumOverride` and `ivOverride` are stripped here
   * so a tampered client cannot influence the open price. The route
   * layer also strips them via Zod, but defense-in-depth.
   */
  legs: Array<Pick<CustomLegSpec, "strike" | "optionType" | "action" | "lots">>;
  /** Optional human label (e.g. "Bull Call Spread"). */
  strategyName?: string | null;
  /** Optional initial journal entry. */
  journal?: string | null;
}

export interface OpenComboResult {
  combo: ComboPosition;
}

/**
 * Sanitised, server-priced combo position. Uses the server's snapshot —
 * never echoes anything the client could have tampered with.
 */
export interface ComboPosition {
  id: string;
  underlying: string;
  expiry: string;
  strategyName: string | null;
  status: "OPEN" | "CLOSED";
  openedAt: string;
  closedAt: string | null;
  closeReason: string | null;
  lotSize: number;
  spotAtEntry: number;
  spotLast: number | null;
  netDebitEntry: number;
  maxProfitEntry: number | null;
  maxLossEntry: number | null;
  breakevensEntry: number[];
  netGreeksEntry: { delta: number; gamma: number; vega: number; theta: number };
  marginRequired: number;
  capitalDeployed: number;
  netMtm: number | null;
  realizedPnl: number | null;
  lastEvaluatedAt: string | null;
  journal: string | null;
  legs: ComboLegPublic[];
  /** Holding-period flags useful for the UI. */
  daysToExpiry: number;
}

export interface ComboLegPublic {
  id: string;
  legIndex: number;
  action: "BUY" | "SELL";
  optionType: "CE" | "PE";
  strike: number;
  qty: number;
  lots: number;
  entryPremium: number;
  ivAtEntry: number | null;
  entrySource: "chain" | "bs";
  lastPremium: number | null;
  lastSource: "chain" | "bs" | "ws" | null;
  exitPremium: number | null;
  /** Per-leg unrealised mark = sign × (last - entry) × qty. */
  unrealizedPnl: number | null;
}

function num(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function numOr(v: string | number | null | undefined, fallback = 0): number {
  return num(v) ?? fallback;
}
function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(fromIso).getTime();
  const b = new Date(toIso).getTime();
  return Math.max(0, Math.floor((a - b) / (1000 * 60 * 60 * 24)));
}

/**
 * Build the freshest possible chain + analytics + IV enrichment for the
 * combo math. Pulled out so open + MTM share exactly one code path.
 */
async function fetchPricedSnapshot(
  underlying: string,
  expiry: string | undefined,
  legs: OpenComboInput["legs"],
): Promise<
  | { ok: true; response: CustomStrategyResponse }
  | { ok: false; code: "CHAIN_UNAVAILABLE" | "BUILD_FAILED"; message: string }
> {
  const chain = await fetchOptionChain(underlying, expiry);
  if (!chain) {
    return { ok: false, code: "CHAIN_UNAVAILABLE", message: `Live option chain unavailable for ${underlying}.` };
  }
  const analytics = computeAnalytics(chain);
  try {
    const iv = await enrichAnalyticsWithIv(analytics);
    analytics.ivRank = iv.ivRank;
    analytics.ivPercentile = iv.ivPercentile;
  } catch (err) {
    logger.warn(
      { err: (err as Error).message, underlying },
      "combo: IV enrichment failed (continuing with raw analytics)",
    );
  }
  // Strip any client-supplied price/iv fields here too — defense in depth.
  const cleanLegs: CustomLegSpec[] = legs.map((l) => ({
    strike: l.strike,
    optionType: l.optionType,
    action: l.action,
    lots: l.lots,
    premiumOverride: null,
    ivOverride: null,
  }));
  const result = buildCustomStrategy(chain, analytics, cleanLegs);
  if (!result.ok) {
    return { ok: false, code: "BUILD_FAILED", message: result.error };
  }
  return { ok: true, response: result.response };
}

/**
 * Open a new combo. Returns the persisted, server-priced position.
 */
export async function openCombo(
  input: OpenComboInput,
): Promise<{ ok: true; combo: ComboPosition } | { ok: false; error: ComboOpenError }> {
  if (!Array.isArray(input.legs) || input.legs.length === 0) {
    return { ok: false, error: { code: "EMPTY", message: "At least one leg is required." } };
  }
  if (input.legs.length > 8) {
    return { ok: false, error: { code: "TOO_MANY_LEGS", message: "Maximum 8 legs supported." } };
  }

  // Open-cap gate. Read inside its own SELECT so an in-flight close can't
  // race past the cap.
  const openCount = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(paperTradeComboTable)
    .where(eq(paperTradeComboTable.status, "OPEN"));
  if ((openCount[0]?.n ?? 0) >= COMBO_MAX_OPEN) {
    return {
      ok: false,
      error: {
        code: "TOO_MANY_OPEN",
        message: `Maximum ${COMBO_MAX_OPEN} simultaneously-open combos. Close one first.`,
      },
    };
  }

  const priced = await fetchPricedSnapshot(input.underlying, input.expiry, input.legs);
  if (!priced.ok) {
    return { ok: false, error: { code: priced.code, message: priced.message } };
  }
  const r = priced.response;
  const snap = r.snapshot;

  // Defined-risk only — reject unbounded shorts.
  if (snap.maxLoss == null) {
    return {
      ok: false,
      error: {
        code: "UNDEFINED_RISK",
        message: "Combo has unbounded loss (naked short / ratio). v1 only allows defined-risk combos.",
      },
    };
  }

  // Net-debit cap. snap.netDebit is per-share; capital deployed at open is
  // max(debit × qty, marginRequired). For credits (negative debit) the
  // capital deployed is just the margin.
  const grossDebitRupees =
    snap.netDebit > 0 ? snap.netDebit * snap.legs.reduce((a, l) => a + l.qty, 0) : 0;
  const capitalDeployed = Math.max(grossDebitRupees, snap.marginRequired);
  const seedCapPct = capitalDeployed / COMBO_SEED_EQUITY_RUPEES;
  if (seedCapPct > COMBO_MAX_NET_DEBIT_PCT) {
    return {
      ok: false,
      error: {
        code: "DEBIT_TOO_LARGE",
        message: `Capital deployed ₹${Math.round(capitalDeployed).toLocaleString("en-IN")} exceeds ${(
          COMBO_MAX_NET_DEBIT_PCT * 100
        ).toFixed(0)}% of seed equity (₹${Math.round(
          COMBO_SEED_EQUITY_RUPEES * COMBO_MAX_NET_DEBIT_PCT,
        ).toLocaleString("en-IN")}).`,
      },
    };
  }

  // Persist combo + legs in one transaction.
  const inserted = await db.transaction(async (tx) => {
    const [combo] = await tx
      .insert(paperTradeComboTable)
      .values({
        underlying: r.underlying,
        expiry: r.expiry,
        strategyName: input.strategyName ?? null,
        lotSize: r.lotSize,
        status: "OPEN",
        spotAtEntry: String(r.spot),
        netDebitEntry: String(snap.netDebit),
        maxProfitEntry: snap.maxProfit != null ? String(snap.maxProfit) : null,
        maxLossEntry: snap.maxLoss != null ? String(snap.maxLoss) : null,
        breakevensEntry: snap.breakevens,
        netGreeksEntry: snap.netGreeks,
        marginRequired: String(snap.marginRequired),
        capitalDeployed: String(capitalDeployed),
        spotLast: String(r.spot),
        journal: input.journal ?? null,
        buildSnapshot: r as unknown as object,
      })
      .returning();
    if (!combo) throw new Error("combo insert returned no row");

    // Snapshot's `legs` order matches the request's `legs` order.
    await tx.insert(paperTradeComboLegTable).values(
      snap.legs.map((leg, i) => ({
        comboId: combo.id,
        legIndex: i,
        action: leg.action,
        optionType: leg.optionType,
        strike: String(leg.strike),
        qty: leg.qty,
        // Reverse-derive lots from qty + lotSize for storage convenience.
        lots: Math.max(1, Math.round(leg.qty / r.lotSize)),
        entryPremium: String(leg.premium),
        ivAtEntry: leg.iv != null ? String(leg.iv) : null,
        entrySource: leg.source,
        lastPremium: String(leg.premium),
        lastSource: leg.source,
        lastEvaluatedAt: new Date(),
      })),
    );
    return combo;
  });

  const position = await loadCombo(inserted.id);
  if (!position) throw new Error("Failed to reload combo immediately after insert.");
  return { ok: true, combo: position };
}

/**
 * Refresh per-leg `lastPremium` from the live chain (chain → BS fallback)
 * and roll up combo `netMtm`. Idempotent. Safe to call from a polling
 * tick or from a read endpoint.
 */
export async function markComboToMarket(comboId: string): Promise<ComboPosition | null> {
  const combo = await db.query.paperTradeComboTable.findFirst({
    where: eq(paperTradeComboTable.id, comboId),
  });
  if (!combo) return null;
  if (combo.status !== "OPEN") return loadCombo(comboId);

  const legs = await db
    .select()
    .from(paperTradeComboLegTable)
    .where(eq(paperTradeComboLegTable.comboId, comboId))
    .orderBy(paperTradeComboLegTable.legIndex);

  const reprice = await fetchPricedSnapshot(
    combo.underlying,
    combo.expiry,
    legs.map((l) => ({
      strike: numOr(l.strike),
      optionType: l.optionType as "CE" | "PE",
      action: l.action as "BUY" | "SELL",
      lots: l.lots,
    })),
  );
  if (!reprice.ok) {
    // Fail-OPEN: don't blow up the read path. Just return the stored row.
    logger.warn(
      { comboId, code: reprice.code, message: reprice.message },
      "combo MTM: reprice failed, keeping stored marks",
    );
    return loadCombo(comboId);
  }

  const snap = reprice.response.snapshot;
  const newSpot = reprice.response.spot;
  const now = new Date();

  await db.transaction(async (tx) => {
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      const fresh = snap.legs[i];
      if (!fresh) continue;
      await tx
        .update(paperTradeComboLegTable)
        .set({
          lastPremium: String(fresh.premium),
          lastSource: fresh.source,
          lastEvaluatedAt: now,
        })
        .where(eq(paperTradeComboLegTable.id, leg.id));
    }
    // Combo netMtm = Σ sign × (last - entry) × qty.
    let netMtm = 0;
    for (let i = 0; i < legs.length; i++) {
      const leg = legs[i];
      const fresh = snap.legs[i];
      if (!fresh) continue;
      const entry = numOr(leg.entryPremium);
      const sign = leg.action === "BUY" ? 1 : -1;
      netMtm += sign * (fresh.premium - entry) * leg.qty;
    }
    await tx
      .update(paperTradeComboTable)
      .set({
        spotLast: String(newSpot),
        netMtm: String(+netMtm.toFixed(2)),
        lastEvaluatedAt: now,
      })
      .where(eq(paperTradeComboTable.id, comboId));
  });

  return loadCombo(comboId);
}

/**
 * Close a combo at the freshly-marked premium. Realised P&L is whatever
 * `markComboToMarket` arrives at on the close pass — never accepts a
 * client-supplied number.
 */
export async function closeCombo(
  comboId: string,
  opts?: { reason?: "MANUAL" | "EXPIRY"; journal?: string | null },
): Promise<{ ok: true; combo: ComboPosition } | { ok: false; error: string }> {
  const existing = await db.query.paperTradeComboTable.findFirst({
    where: eq(paperTradeComboTable.id, comboId),
  });
  if (!existing) return { ok: false, error: "Combo not found." };
  if (existing.status !== "OPEN") {
    return { ok: false, error: "Combo is already closed." };
  }

  // Refresh marks first so the realised P&L matches what the user just saw.
  await markComboToMarket(comboId);

  const legs = await db
    .select()
    .from(paperTradeComboLegTable)
    .where(eq(paperTradeComboLegTable.comboId, comboId))
    .orderBy(paperTradeComboLegTable.legIndex);

  let realized = 0;
  await db.transaction(async (tx) => {
    for (const leg of legs) {
      const last = numOr(leg.lastPremium, numOr(leg.entryPremium));
      const entry = numOr(leg.entryPremium);
      const sign = leg.action === "BUY" ? 1 : -1;
      realized += sign * (last - entry) * leg.qty;
      await tx
        .update(paperTradeComboLegTable)
        .set({ exitPremium: String(last) })
        .where(eq(paperTradeComboLegTable.id, leg.id));
    }
    await tx
      .update(paperTradeComboTable)
      .set({
        status: "CLOSED",
        closedAt: new Date(),
        closeReason: opts?.reason ?? "MANUAL",
        realizedPnl: String(+realized.toFixed(2)),
        netMtm: String(+realized.toFixed(2)),
        ...(opts?.journal != null ? { journal: opts.journal } : {}),
      })
      .where(eq(paperTradeComboTable.id, comboId));
  });

  const combo = await loadCombo(comboId);
  if (!combo) return { ok: false, error: "Failed to reload combo after close." };
  return { ok: true, combo };
}

/** List combos, newest first. */
export async function listCombos(filter?: {
  status?: "OPEN" | "CLOSED";
  limit?: number;
}): Promise<ComboPosition[]> {
  const lim = Math.min(Math.max(filter?.limit ?? 100, 1), 500);
  const rows = filter?.status
    ? await db
        .select()
        .from(paperTradeComboTable)
        .where(eq(paperTradeComboTable.status, filter.status))
        .orderBy(desc(paperTradeComboTable.openedAt))
        .limit(lim)
    : await db
        .select()
        .from(paperTradeComboTable)
        .orderBy(desc(paperTradeComboTable.openedAt))
        .limit(lim);

  // For OPEN combos we refresh marks lazily on read so the UI is honest.
  // CLOSED rows never re-mark.
  const out: ComboPosition[] = [];
  for (const row of rows) {
    const refreshed =
      row.status === "OPEN" ? await markComboToMarket(row.id) : await loadCombo(row.id);
    if (refreshed) out.push(refreshed);
  }
  return out;
}

/** Single-combo detail (always re-marks if OPEN). */
export async function getCombo(comboId: string): Promise<ComboPosition | null> {
  const row = await db.query.paperTradeComboTable.findFirst({
    where: eq(paperTradeComboTable.id, comboId),
  });
  if (!row) return null;
  if (row.status === "OPEN") return markComboToMarket(comboId);
  return loadCombo(comboId);
}

/** Plain in-DB read (no refresh). Internal only. */
async function loadCombo(comboId: string): Promise<ComboPosition | null> {
  const row = await db.query.paperTradeComboTable.findFirst({
    where: eq(paperTradeComboTable.id, comboId),
  });
  if (!row) return null;
  const legs = await db
    .select()
    .from(paperTradeComboLegTable)
    .where(eq(paperTradeComboLegTable.comboId, comboId))
    .orderBy(paperTradeComboLegTable.legIndex);

  return rowToPosition(row, legs);
}

function rowToPosition(
  row: PaperTradeComboRow,
  legs: PaperTradeComboLegRow[],
): ComboPosition {
  const todayIso = new Date().toISOString();
  return {
    id: row.id,
    underlying: row.underlying,
    expiry: row.expiry,
    strategyName: row.strategyName,
    status: row.status as "OPEN" | "CLOSED",
    openedAt: row.openedAt.toISOString(),
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    closeReason: row.closeReason,
    lotSize: row.lotSize,
    spotAtEntry: numOr(row.spotAtEntry),
    spotLast: num(row.spotLast),
    netDebitEntry: numOr(row.netDebitEntry),
    maxProfitEntry: num(row.maxProfitEntry),
    maxLossEntry: num(row.maxLossEntry),
    breakevensEntry: Array.isArray(row.breakevensEntry)
      ? (row.breakevensEntry as number[])
      : [],
    netGreeksEntry: (row.netGreeksEntry as ComboPosition["netGreeksEntry"]) ?? {
      delta: 0, gamma: 0, vega: 0, theta: 0,
    },
    marginRequired: numOr(row.marginRequired),
    capitalDeployed: numOr(row.capitalDeployed),
    netMtm: num(row.netMtm),
    realizedPnl: num(row.realizedPnl),
    lastEvaluatedAt: row.lastEvaluatedAt ? row.lastEvaluatedAt.toISOString() : null,
    journal: row.journal,
    daysToExpiry: daysBetween(row.expiry + "T15:30:00.000Z", todayIso),
    legs: legs.map((l) => {
      const last = num(l.lastPremium);
      const entry = numOr(l.entryPremium);
      const sign = l.action === "BUY" ? 1 : -1;
      const upnl = last == null ? null : +(sign * (last - entry) * l.qty).toFixed(2);
      return {
        id: l.id,
        legIndex: l.legIndex,
        action: l.action as "BUY" | "SELL",
        optionType: l.optionType as "CE" | "PE",
        strike: numOr(l.strike),
        qty: l.qty,
        lots: l.lots,
        entryPremium: entry,
        ivAtEntry: num(l.ivAtEntry),
        entrySource: (l.entrySource as "chain" | "bs") ?? "chain",
        lastPremium: last,
        lastSource: (l.lastSource as "chain" | "bs" | "ws" | null) ?? null,
        exitPremium: num(l.exitPremium),
        unrealizedPnl: upnl,
      };
    }),
  };
}

// Re-export for the test file's convenience.
export { simulateScenario };

// ──────────────────────────────────────────────────────────────────────────
// Exposed only for tests — pure helpers that do NOT touch the DB.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Pure realised-P&L roll-up used by tests. Mirrors the reduce in
 * `closeCombo` exactly so a test can pin the math without spinning up a
 * DB. Keep these two implementations identical when changing one.
 */
export function computeRealizedPnl(
  legs: Array<{
    action: "BUY" | "SELL";
    qty: number;
    entryPremium: number;
    exitPremium: number;
  }>,
): number {
  let n = 0;
  for (const l of legs) {
    const sign = l.action === "BUY" ? 1 : -1;
    n += sign * (l.exitPremium - l.entryPremium) * l.qty;
  }
  return +n.toFixed(2);
}

/**
 * Strip client-tampered fields from a leg spec. Equivalent to what
 * `fetchPricedSnapshot` does inline; broken out so the test can verify
 * the stripping invariant directly.
 */
export function sanitizeLegSpec(
  raw: CustomLegSpec & Record<string, unknown>,
): CustomLegSpec {
  return {
    strike: raw.strike,
    optionType: raw.optionType,
    action: raw.action,
    lots: raw.lots,
    premiumOverride: null,
    ivOverride: null,
  };
}
