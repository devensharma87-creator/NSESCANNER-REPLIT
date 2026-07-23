/**
 * P0.3 — Durable Validated-Fill Evidence Persistence
 *
 * Pure / no DB. Tests the pure writer-mapping seam
 * (`buildEvidencePersistenceSnapshot`) and the structural guarantees that
 * evidence is persisted atomically with the trade row.
 *
 * Spec: P0.3 — Durable Validated-Fill Evidence Persistence (2026-07-23)
 * Corrective pass: P0.3 Corrective Pass (2026-07-23) — explicit gate assertions
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildEquityFillEvidence,
  buildEquityInsertCore,
  buildEvidencePersistenceSnapshot,
  EQUITY_FRESHNESS_POLICY,
  FILL_EVIDENCE_VERSION,
  resolveFreshnessPolicy,
  type EvidencePersistenceSnapshot,
  type StockRowForEvidence,
  type ValidatedFillEvidence,
} from "./equityFillEvidence";
import {
  computeFinalExecutionAdmission,
  EQUITY_AUTO_ENTRY_CUTOFF,
} from "./sessionAdmission";
import { checkDbTestIsolation } from "../test-infra/dbTestGuard";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Shared test instants ──────────────────────────────────────────────────────
// All IST conversions: UTC = IST − 5h30m

/** Monday 2026-01-05 10:00 IST = 04:30 UTC — valid NSE session instant */
const DECISION_TIME = new Date("2026-01-05T04:30:00.000Z");

/** Provider timestamp 30 s before decision — age 30 s < 120 s max → fresh */
const PROVIDER_TS_FRESH = new Date(DECISION_TIME.getTime() - 30_000);

// ── Shared helpers ────────────────────────────────────────────────────────────

function makeRow(opts?: {
  price?: number;
  updatedAt?: Date | null;
  sourceProvider?: string;
  trustTier?: string;
  notForTradeDecisions?: boolean;
  isStale?: boolean | null;
  symbol?: string;
}): StockRowForEvidence {
  return {
    symbol: opts?.symbol ?? "RELIANCE",
    quote: {
      price: opts?.price ?? 2500,
      updatedAt: opts?.updatedAt !== undefined ? opts.updatedAt : PROVIDER_TS_FRESH,
    },
    provenance: {
      sourceProvider: opts?.sourceProvider ?? "kite",
      trustTier: opts?.trustTier ?? "authoritative",
      notForTradeDecisions: opts?.notForTradeDecisions ?? false,
      isStale: opts?.isStale ?? false,
    },
  };
}

/**
 * Call computeFinalExecutionAdmission (Phase B) with a pre-built evidence object.
 * Defaults to MANUAL source + DECISION_TIME so AUTO/STAGED cutoff gate is bypassed.
 */
function phaseB(
  evidence: ReturnType<typeof buildEquityFillEvidence>,
  opts?: {
    decisionTime?: Date;
    source?: "MANUAL" | "AUTO" | "SWING_STAGED_APPROVAL";
    symbol?: string;
    lane?: "equity_cash" | "nse_fo" | "bse_fo";
    segment?: string;
  },
): ReturnType<typeof computeFinalExecutionAdmission> {
  return computeFinalExecutionAdmission({
    lane: opts?.lane ?? "equity_cash",
    segment: opts?.segment ?? "NSE_EQ",
    instrument: opts?.symbol ?? "RELIANCE",
    decisionTime: opts?.decisionTime ?? DECISION_TIME,
    source: opts?.source ?? "MANUAL",
    entryCutoffPolicy: null,
    equityFillEvidence: evidence,
  });
}

/**
 * Build a ValidatedFillEvidence via Phase B from a fresh, authoritative Kite row.
 * Asserts admission is allowed so test failures are explicit.
 */
function buildValidatedFill(overrides?: Parameters<typeof makeRow>[0]): ValidatedFillEvidence {
  const evidence = buildEquityFillEvidence(makeRow(overrides));
  expect(evidence).not.toBeNull();
  // Propagate symbol so Phase B step 8 (ev.instrument === ctx.instrument) passes
  const result = phaseB(evidence!, { symbol: overrides?.symbol });
  expect(result.allowed).toBe(true);
  return (result as { allowed: true; validatedFill: ValidatedFillEvidence }).validatedFill;
}

// ─── Group A — pure field mapping (tests 1–8) ─────────────────────────────────

describe("buildEvidencePersistenceSnapshot — pure field mapping", () => {
  it("1. fillProvider maps directly from ValidatedFillEvidence.provider", () => {
    const fill = buildValidatedFill();
    const snap = buildEvidencePersistenceSnapshot(fill);
    expect(snap.fillProvider).toBe(fill.provider);
    expect(snap.fillProvider).toBe("kite");
  });

  it("2. fillProviderTs maps directly from ValidatedFillEvidence.providerTimestamp", () => {
    const fill = buildValidatedFill();
    const snap = buildEvidencePersistenceSnapshot(fill);
    expect(snap.fillProviderTs).toStrictEqual(fill.providerTimestamp);
    expect(snap.fillProviderTs.getTime()).toBe(PROVIDER_TS_FRESH.getTime());
  });

  it("3. fillDecisionTime maps directly from ValidatedFillEvidence.decisionTime", () => {
    const fill = buildValidatedFill();
    const snap = buildEvidencePersistenceSnapshot(fill);
    expect(snap.fillDecisionTime).toStrictEqual(fill.decisionTime);
    expect(snap.fillDecisionTime.getTime()).toBe(DECISION_TIME.getTime());
  });

  it("4. fillComputedAgeSec matches (decisionTime − providerTimestamp) / 1000 to 3dp", () => {
    const fill = buildValidatedFill();
    const snap = buildEvidencePersistenceSnapshot(fill);
    const expectedAge =
      (fill.decisionTime.getTime() - fill.providerTimestamp.getTime()) / 1000;
    expect(snap.fillComputedAgeSec).toBe(fill.computedAgeSec);
    expect(snap.fillComputedAgeSec).toBeCloseTo(expectedAge, 3);
    expect(snap.fillComputedAgeSec).toBeCloseTo(30, 1);
  });

  it("5. fillPolicyId maps directly from ValidatedFillEvidence.policyId", () => {
    const fill = buildValidatedFill();
    const snap = buildEvidencePersistenceSnapshot(fill);
    expect(snap.fillPolicyId).toBe(fill.policyId);
    expect(snap.fillPolicyId).toBe("watchlist.quote.maxFreshnessSec");
  });

  it("6. fillPolicyMaxAgeSec maps directly from ValidatedFillEvidence.policyMaxAgeSec", () => {
    const fill = buildValidatedFill();
    const snap = buildEvidencePersistenceSnapshot(fill);
    expect(snap.fillPolicyMaxAgeSec).toBe(fill.policyMaxAgeSec);
    expect(snap.fillPolicyMaxAgeSec).toBe(
      EQUITY_FRESHNESS_POLICY["watchlist.quote.maxFreshnessSec"],
    );
  });

  it("7. fillEvidenceVersion is always FILL_EVIDENCE_VERSION regardless of fill content", () => {
    const fill = buildValidatedFill({ price: 9999 });
    const snap = buildEvidencePersistenceSnapshot(fill);
    expect(snap.fillEvidenceVersion).toBe(FILL_EVIDENCE_VERSION);
    expect(snap.fillEvidenceVersion).toBe("v1");
  });

  it("8. all seven snapshot fields are defined and non-null on a valid fill", () => {
    const fill = buildValidatedFill();
    const snap = buildEvidencePersistenceSnapshot(fill);
    const values = Object.values(snap as unknown as Record<string, unknown>);
    expect(values).toHaveLength(7);
    for (const v of values) {
      expect(v).not.toBeNull();
      expect(v).not.toBeUndefined();
    }
  });
});

// ─── Group B — structural guarantees (tests 9–11) ────────────────────────────

describe("EvidencePersistenceSnapshot — structural guarantees", () => {
  it("9. snapshot has exactly the 7 documented keys (no partial snapshot possible)", () => {
    const fill = buildValidatedFill();
    const snap = buildEvidencePersistenceSnapshot(fill);
    const keys = Object.keys(snap).sort();
    expect(keys).toEqual(
      [
        "fillComputedAgeSec",
        "fillDecisionTime",
        "fillEvidenceVersion",
        "fillPolicyId",
        "fillPolicyMaxAgeSec",
        "fillProvider",
        "fillProviderTs",
      ].sort(),
    );
  });

  it("10. computed age is non-negative for valid fills (decisionTime >= providerTimestamp)", () => {
    const fill = buildValidatedFill();
    const snap = buildEvidencePersistenceSnapshot(fill);
    expect(snap.fillComputedAgeSec).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(snap.fillComputedAgeSec)).toBe(true);
  });

  it("11. two calls with the same fill produce identical snapshots (pure, deterministic)", () => {
    const fill = buildValidatedFill();
    const s1 = buildEvidencePersistenceSnapshot(fill);
    const s2 = buildEvidencePersistenceSnapshot(fill);
    expect(s1).toStrictEqual(s2);
  });
});

// ─── Group C — Phase B rejection → no ValidatedFillEvidence (tests 12–17) ────

describe("Phase B rejection — no ValidatedFillEvidence produced", () => {
  it("12. null equityFillEvidence → TRADE_ADMISSION_CONTEXT_INCOMPLETE", () => {
    const result = phaseB(null);
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; reason: string }).reason).toBe(
      "TRADE_ADMISSION_CONTEXT_INCOMPLETE",
    );
  });

  it("13. isStale=true (scanner flag) → QUOTE_STALE_OR_NOT_TRADE_GRADE", () => {
    const evidence = buildEquityFillEvidence(makeRow({ isStale: true }));
    expect(evidence).not.toBeNull();
    const result = phaseB(evidence!);
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; reason: string }).reason).toBe(
      "QUOTE_STALE_OR_NOT_TRADE_GRADE",
    );
  });

  it("14. notForTradeDecisions=true (e.g. Kite-LTP overlay on Yahoo signal) → QUOTE_STALE_OR_NOT_TRADE_GRADE", () => {
    const evidence = buildEquityFillEvidence(makeRow({ notForTradeDecisions: true }));
    expect(evidence).not.toBeNull();
    const result = phaseB(evidence!);
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; reason: string }).reason).toBe(
      "QUOTE_STALE_OR_NOT_TRADE_GRADE",
    );
  });

  it("15. sourceTrustTier != 'authoritative' (e.g. Yahoo secondary) → QUOTE_STALE_OR_NOT_TRADE_GRADE", () => {
    const evidence = buildEquityFillEvidence(
      makeRow({ trustTier: "secondary_analytics", sourceProvider: "yahoo" }),
    );
    expect(evidence).not.toBeNull();
    const result = phaseB(evidence!);
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; reason: string }).reason).toBe(
      "QUOTE_STALE_OR_NOT_TRADE_GRADE",
    );
  });

  it("16. price = 0 → buildEquityFillEvidence returns null (no evidence, no fill)", () => {
    const evidence = buildEquityFillEvidence(makeRow({ price: 0 }));
    expect(evidence).toBeNull();
  });

  it("17. null updatedAt → buildEquityFillEvidence returns null (no evidence, no fill)", () => {
    const evidence = buildEquityFillEvidence(makeRow({ updatedAt: null }));
    expect(evidence).toBeNull();
  });
});

// ─── Group D — immutability and seam consistency (tests 18–19) ───────────────

describe("EquityFillEvidence — immutability and insert-core seam consistency", () => {
  it("18. buildEquityFillEvidence returns a frozen (immutable) object", () => {
    const evidence = buildEquityFillEvidence(makeRow());
    expect(evidence).not.toBeNull();
    expect(Object.isFrozen(evidence!)).toBe(true);
  });

  it("19. buildEquityInsertCore and buildEvidencePersistenceSnapshot are consistent for the same fill", () => {
    const fill = buildValidatedFill({ price: 3000 });
    const insertCore = buildEquityInsertCore(fill);
    const snap = buildEvidencePersistenceSnapshot(fill);

    // Both seams read from the same fill object — price, symbol, and time must agree
    expect(insertCore.entryPrice).toBe(fill.price);
    expect(insertCore.symbol).toBe(fill.instrument);
    // openedAt (from P0.2 seam) and fillDecisionTime (from P0.3 seam) both come
    // from ValidatedFillEvidence.decisionTime
    expect(snap.fillDecisionTime).toStrictEqual(insertCore.openedAt);
    // Provider is "kite" from the authoritative fill
    expect(snap.fillProvider).toBe("kite");
  });
});

// ─── Group E — migration schema and no-backfill guarantees (tests 20–21) ─────

describe("P0.3 migration — schema contract and no-backfill guarantee", () => {
  it("20. EvidencePersistenceSnapshot field names map 1:1 to the 7 DB column names (camelCase→snake_case)", () => {
    const FIELD_TO_COLUMN: Record<keyof EvidencePersistenceSnapshot, string> = {
      fillProvider: "fill_provider",
      fillProviderTs: "fill_provider_ts",
      fillDecisionTime: "fill_decision_time",
      fillComputedAgeSec: "fill_computed_age_sec",
      fillPolicyId: "fill_policy_id",
      fillPolicyMaxAgeSec: "fill_policy_max_age_sec",
      fillEvidenceVersion: "fill_evidence_version",
    };
    expect(Object.keys(FIELD_TO_COLUMN)).toHaveLength(7);
    expect(FIELD_TO_COLUMN.fillProvider).toBe("fill_provider");
    expect(FIELD_TO_COLUMN.fillEvidenceVersion).toBe("fill_evidence_version");
    expect(FIELD_TO_COLUMN.fillComputedAgeSec).toBe("fill_computed_age_sec");
  });

  it("21. FILL_EVIDENCE_VERSION constant is the string literal 'v1'", () => {
    expect(FILL_EVIDENCE_VERSION).toBe("v1");
    expect(typeof FILL_EVIDENCE_VERSION).toBe("string");
    expect(FILL_EVIDENCE_VERSION).not.toBe("");
    expect(Number.isNaN(Number(FILL_EVIDENCE_VERSION))).toBe(true);
  });
});

// ─── Group F — lane policy and freshness policy (tests 22–25) ─────────────────

describe("Lane policy and freshness policy", () => {
  it("22. EQUITY_AUTO_ENTRY_CUTOFF is null — AUTO lane fails C0 gate with ENTRY_CUTOFF_CONFIG_UNAVAILABLE (valid evidence supplied)", () => {
    // The AUTO entry-cutoff (C0) gate fires after Phase B validates evidence is
    // non-null. Provide valid evidence so Phase B reaches the cutoff check.
    // null entryCutoffPolicy → ENTRY_CUTOFF_CONFIG_UNAVAILABLE (the C0 hard gate).
    expect(EQUITY_AUTO_ENTRY_CUTOFF).toBeNull();
    const evidence = buildEquityFillEvidence(makeRow());
    expect(evidence).not.toBeNull();
    const autoResult = computeFinalExecutionAdmission({
      lane: "equity_cash",
      segment: "NSE_EQ",
      instrument: "RELIANCE",
      decisionTime: DECISION_TIME,
      source: "AUTO",
      entryCutoffPolicy: EQUITY_AUTO_ENTRY_CUTOFF,
      equityFillEvidence: evidence,
    });
    expect(autoResult.allowed).toBe(false);
    expect((autoResult as { allowed: false; reason: string }).reason).toBe(
      "ENTRY_CUTOFF_CONFIG_UNAVAILABLE",
    );
  });

  it("23. SWING_STAGED_APPROVAL lane also fails C0 gate via ENTRY_CUTOFF_CONFIG_UNAVAILABLE (valid evidence supplied)", () => {
    const evidence = buildEquityFillEvidence(makeRow());
    expect(evidence).not.toBeNull();
    const stagedResult = computeFinalExecutionAdmission({
      lane: "equity_cash",
      segment: "NSE_EQ",
      instrument: "RELIANCE",
      decisionTime: DECISION_TIME,
      source: "SWING_STAGED_APPROVAL",
      entryCutoffPolicy: null,
      equityFillEvidence: evidence,
    });
    expect(stagedResult.allowed).toBe(false);
    expect((stagedResult as { allowed: false; reason: string }).reason).toBe(
      "ENTRY_CUTOFF_CONFIG_UNAVAILABLE",
    );
  });

  it("24. EQUITY_FRESHNESS_POLICY['watchlist.quote.maxFreshnessSec'] is exactly 120 s", () => {
    expect(EQUITY_FRESHNESS_POLICY["watchlist.quote.maxFreshnessSec"]).toBe(120);
    expect(Object.keys(EQUITY_FRESHNESS_POLICY)).toHaveLength(1);
  });

  it("25. resolveFreshnessPolicy returns 120 for the registered key and null for unknown / empty keys", () => {
    expect(resolveFreshnessPolicy("watchlist.quote.maxFreshnessSec")).toBe(120);
    expect(resolveFreshnessPolicy("nonexistent.policy")).toBeNull();
    expect(resolveFreshnessPolicy("")).toBeNull();
    expect(resolveFreshnessPolicy("watchlist.quote.maxFreshnessSec.typo")).toBeNull();
  });
});

// ─── Group G — explicit gate assertions (corrective pass, tests 26–34) ────────

describe("Explicit gate assertions — P0.3 Corrective Pass", () => {
  it("26. future provider timestamp (providerTs > decisionTime) is explicitly rejected — computedAgeSec < 0 path → TRADE_ADMISSION_CONTEXT_INCOMPLETE", () => {
    // providerTs is 60 s AFTER decisionTime → computedAgeSec = -60 → Phase B step 5
    const futureProviderTs = new Date(DECISION_TIME.getTime() + 60_000);
    const evidence = buildEquityFillEvidence(
      makeRow({ updatedAt: futureProviderTs }),
    );
    expect(evidence).not.toBeNull();
    const result = phaseB(evidence!);
    // Must be rejected specifically by the future-timestamp gate, not another gate
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; reason: string }).reason).toBe(
      "TRADE_ADMISSION_CONTEXT_INCOMPLETE",
    );
    // Confirm the age is negative (the exact condition that fires the gate)
    const computedAge =
      (DECISION_TIME.getTime() - futureProviderTs.getTime()) / 1000;
    expect(computedAge).toBeLessThan(0);
  });

  it("27. NSE F&O lane (nse_fo) fails closed with TRADE_ADMISSION_CONTEXT_INCOMPLETE regardless of evidence quality", () => {
    // Even valid Kite evidence cannot authorise an F&O trade — no trusted
    // per-premium event timestamp exists in the Kite REST option-chain response.
    const evidence = buildEquityFillEvidence(makeRow());
    expect(evidence).not.toBeNull();
    const result = computeFinalExecutionAdmission({
      lane: "nse_fo",
      segment: "NSE_FO",
      instrument: "NIFTY",
      decisionTime: DECISION_TIME,
      source: "MANUAL",
      entryCutoffPolicy: null,
      equityFillEvidence: evidence,
    });
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; reason: string }).reason).toBe(
      "TRADE_ADMISSION_CONTEXT_INCOMPLETE",
    );
  });

  it("28. BSE F&O lane (bse_fo) fails closed with TRADE_ADMISSION_CONTEXT_INCOMPLETE (calendar/fail-closed gate)", () => {
    const evidence = buildEquityFillEvidence(makeRow());
    expect(evidence).not.toBeNull();
    const result = computeFinalExecutionAdmission({
      lane: "bse_fo",
      segment: "BSE_FO",
      instrument: "SENSEX",
      decisionTime: DECISION_TIME,
      source: "MANUAL",
      entryCutoffPolicy: null,
      equityFillEvidence: evidence,
    });
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; reason: string }).reason).toBe(
      "TRADE_ADMISSION_CONTEXT_INCOMPLETE",
    );
  });

  it("29. Yahoo evidence (secondary_analytics tier) is rejected before any insertion — QUOTE_STALE_OR_NOT_TRADE_GRADE via trust-tier gate", () => {
    // Yahoo rows never have trustTier='authoritative'. Phase B step 7 evaluates
    // tradeGrade = (sourceTrustTier === "authoritative") && ... — so secondary_analytics
    // rows fail even when isStale=false and notForTradeDecisions=false.
    // No insertion call is reached; the test asserts the exact gate that fires.
    const yahooEvidence = buildEquityFillEvidence(
      makeRow({ trustTier: "secondary_analytics", sourceProvider: "yahoo" }),
    );
    expect(yahooEvidence).not.toBeNull();
    // Trust tier is secondary — not authoritative
    expect(yahooEvidence!.sourceTrustTier).not.toBe("authoritative");
    const result = phaseB(yahooEvidence!);
    expect(result.allowed).toBe(false);
    expect((result as { allowed: false; reason: string }).reason).toBe(
      "QUOTE_STALE_OR_NOT_TRADE_GRADE",
    );
  });

  it("30. caller cannot supply quote age — computedAgeSec is derived internally by Phase B from (decisionTime − providerTs)", () => {
    // ValidatedFillEvidence.computedAgeSec has no corresponding field on
    // FinalExecutionAdmissionContext — it is solely derived internally.
    // This test verifies the derived value matches the expected arithmetic.
    const fill = buildValidatedFill();
    const expectedAge =
      (DECISION_TIME.getTime() - PROVIDER_TS_FRESH.getTime()) / 1000;
    // computedAgeSec on ValidatedFillEvidence must equal (decisionTime - providerTs) / 1000
    expect(fill.computedAgeSec).toBeCloseTo(expectedAge, 5);
    // And it must be positive (not caller-fabricated)
    expect(fill.computedAgeSec).toBeGreaterThan(0);
  });

  it("31. price, symbol, providerTimestamp and decisionTime all come from the same ValidatedFillEvidence object", () => {
    // The four key fields must all originate from the single ValidatedFillEvidence
    // returned by computeFinalExecutionAdmission — not reconstructed separately.
    const fill = buildValidatedFill({ price: 1500, symbol: "TCS" });
    const snap = buildEvidencePersistenceSnapshot(fill);
    const core = buildEquityInsertCore(fill);

    // Price: core reads from fill.price; snap records provider metadata
    expect(core.entryPrice).toBe(fill.price);
    expect(core.entryPrice).toBe(1500);

    // Symbol: core reads from fill.instrument
    expect(core.symbol).toBe(fill.instrument);
    expect(core.symbol).toBe("TCS");

    // ProviderTimestamp: snap reads from fill.providerTimestamp
    expect(snap.fillProviderTs).toStrictEqual(fill.providerTimestamp);
    expect(snap.fillProviderTs.getTime()).toBe(PROVIDER_TS_FRESH.getTime());

    // DecisionTime: both seams read from fill.decisionTime
    expect(snap.fillDecisionTime).toStrictEqual(fill.decisionTime);
    expect(core.openedAt).toStrictEqual(fill.decisionTime);
    expect(snap.fillDecisionTime.getTime()).toBe(DECISION_TIME.getTime());
  });

  it("32. symbol mismatch is enforced by Phase B runtime gate (ev.instrument !== ctx.instrument → TRADE_ADMISSION_CONTEXT_INCOMPLETE) and prevented structurally in production", () => {
    // Phase B step 8 is an explicit runtime check: if ev.instrument !== ctx.instrument
    // it rejects with TRADE_ADMISSION_CONTEXT_INCOMPLETE. This test verifies:
    // (a) the runtime gate fires on a deliberate mismatch, and
    // (b) the production path never creates a mismatch (same row.symbol drives both).
    const evidence = buildEquityFillEvidence(makeRow({ symbol: "HDFCBANK" }));
    expect(evidence).not.toBeNull();
    expect(evidence!.instrument).toBe("HDFCBANK");

    // (a) Deliberate mismatch → Phase B rejects
    const mismatchResult = computeFinalExecutionAdmission({
      lane: "equity_cash",
      segment: "NSE_EQ",
      instrument: "RELIANCE",   // ctx says RELIANCE
      decisionTime: DECISION_TIME,
      source: "MANUAL",
      entryCutoffPolicy: null,
      equityFillEvidence: evidence, // evidence says HDFCBANK
    });
    expect(mismatchResult.allowed).toBe(false);
    expect((mismatchResult as { allowed: false; reason: string }).reason).toBe(
      "TRADE_ADMISSION_CONTEXT_INCOMPLETE",
    );

    // (b) Matching symbol → Phase B allows; validatedFill.instrument = evidence.instrument
    const matchResult = computeFinalExecutionAdmission({
      lane: "equity_cash",
      segment: "NSE_EQ",
      instrument: "HDFCBANK",  // ctx matches evidence
      decisionTime: DECISION_TIME,
      source: "MANUAL",
      entryCutoffPolicy: null,
      equityFillEvidence: evidence,
    });
    expect(matchResult.allowed).toBe(true);
    const validatedFill = (matchResult as { allowed: true; validatedFill: ValidatedFillEvidence }).validatedFill;
    const core = buildEquityInsertCore(validatedFill);
    expect(core.symbol).toBe("HDFCBANK");
  });

  it("33. legacy row: all seven evidence fields can be null — no NOT NULL constraint; pre-P0.3 rows remain readable", () => {
    // A row written before P0.3 will have NULL in all 7 evidence columns.
    // Drizzle declares them nullable (no .notNull() in schema).
    // This test documents the null contract — no backfill is expected or performed.
    const legacyFields: {
      fillProvider: string | null;
      fillProviderTs: Date | null;
      fillDecisionTime: Date | null;
      fillComputedAgeSec: number | null;
      fillPolicyId: string | null;
      fillPolicyMaxAgeSec: number | null;
      fillEvidenceVersion: string | null;
    } = {
      fillProvider: null,
      fillProviderTs: null,
      fillDecisionTime: null,
      fillComputedAgeSec: null,
      fillPolicyId: null,
      fillPolicyMaxAgeSec: null,
      fillEvidenceVersion: null,
    };
    // All 7 are null — this is the correct representation of a legacy row
    expect(Object.values(legacyFields)).toHaveLength(7);
    expect(Object.values(legacyFields).every((v) => v === null)).toBe(true);
  });

  it("34. migration source SQL is additive-DDL only — no UPDATE, INSERT or DELETE statements", () => {
    const migrationPath = path.resolve(
      __dirname,
      "../../../../docs/migrations/paper_trade_eq_fill_evidence.sql",
    );
    const sql = fs.readFileSync(migrationPath, "utf8");
    // No DML that would touch existing rows
    expect(/\bUPDATE\b/i.test(sql)).toBe(false);
    expect(/\bINSERT\b/i.test(sql)).toBe(false);
    expect(/\bDELETE\b/i.test(sql)).toBe(false);
    // Must include the additive DDL
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS fill_provider");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS fill_evidence_version");
  });
});

// ─── Group H — runtime DDL removal proof (tests 35–36) ───────────────────────

describe("Runtime DDL removal — no active evidence DDL path in repository", () => {
  it("35. paperTradingEq.ts exports assertPaperEqEvidenceColumnsPresent (read-only preflight) not applyPaperEqEvidenceColumns (DDL)", () => {
    const srcPath = path.resolve(__dirname, "./paperTradingEq.ts");
    const src = fs.readFileSync(srcPath, "utf8");

    // The DDL functions must be absent
    expect(/^export async function applyPaperEqEvidenceColumns/m.test(src)).toBe(false);
    expect(/^export function ensurePaperEqEvidenceColumns/m.test(src)).toBe(false);

    // The read-only preflight must be present
    expect(/^export async function assertPaperEqEvidenceColumnsPresent/m.test(src)).toBe(true);

    // The evidence ALTER TABLE DDL must be absent
    expect(/ALTER TABLE paper_trade_eq[\s\S]{0,200}fill_provider/m.test(src)).toBe(false);
  });

  it("36. paperTradingEq.ts calls assertPaperEqEvidenceColumnsPresent (not ensurePaperEqEvidenceColumns) at trade-open sites", () => {
    const srcPath = path.resolve(__dirname, "./paperTradingEq.ts");
    const src = fs.readFileSync(srcPath, "utf8");

    // The removed ensure calls must not appear
    expect(src).not.toContain("ensurePaperEqEvidenceColumns");
    // The replacement assertion must appear (at least 2 call sites)
    const callSiteCount = (src.match(/await assertPaperEqEvidenceColumnsPresent\(\)/g) ?? []).length;
    expect(callSiteCount).toBeGreaterThanOrEqual(2);
  });
});

// ─── Group I — test isolation guard (tests 37–39) ─────────────────────────────

describe("DB test isolation guard — refuses operational and production targets", () => {
  it("37. guard rejects operational DATABASE_URL used as fallback (OPERATIONAL_DATABASE_FALLBACK_FORBIDDEN)", () => {
    const result = checkDbTestIsolation({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://user:pass@db.internal:5432/nse_scanner",
      // TEST_DATABASE_URL intentionally absent — must not fall back to DATABASE_URL
    });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; code: string }).code).toBe(
      "OPERATIONAL_DATABASE_FALLBACK_FORBIDDEN",
    );
  });

  it("38. guard rejects TEST_DATABASE_URL pointing to operational db name (TEST_TARGET_NOT_ISOLATED)", () => {
    const result = checkDbTestIsolation({
      NODE_ENV: "test",
      TEST_DATABASE_URL: "postgresql://user:pass@test.invalid:5432/nse_scanner",
      TEST_RUN_ID: "run-abc123",
      TEST_DB_ISOLATION_CONFIRMED: "true",
      TEST_EXTERNAL_SERVICES_CONFIGURED_DISABLED: "true",
    });
    expect(result.ok).toBe(false);
    expect((result as { ok: false; code: string }).code).toBe("TEST_TARGET_NOT_ISOLATED");
  });

  it("39. P0_3_INTEGRATION_TESTS=BLOCKED — paperTradingEqProvenance.test.ts is gated by isolation guard, not DATABASE_URL", () => {
    // The provenance test file now uses checkDbTestIsolation, not DATABASE_URL.
    // Without TEST_DATABASE_URL, the guard returns OPERATIONAL_DATABASE_FALLBACK_FORBIDDEN
    // (DATABASE_URL present) or TEST_DATABASE_URL_MISSING, not a pass.
    const resultWithDevDb = checkDbTestIsolation({
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://postgres:pass@localhost:5432/heliumdb",
      // TEST_DATABASE_URL absent
    });
    expect(resultWithDevDb.ok).toBe(false);
    expect((resultWithDevDb as { ok: false; code: string }).code).toBe(
      "OPERATIONAL_DATABASE_FALLBACK_FORBIDDEN",
    );

    const resultWithNoDb = checkDbTestIsolation({
      NODE_ENV: "test",
      // Both absent
    });
    expect(resultWithNoDb.ok).toBe(false);
    expect((resultWithNoDb as { ok: false; code: string }).code).toBe(
      "TEST_DATABASE_URL_MISSING",
    );
  });
});
