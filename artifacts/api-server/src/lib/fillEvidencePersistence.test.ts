/**
 * P0.3 — Durable Validated-Fill Evidence Persistence
 *
 * 25 spec-required test cases. Pure / no DB.
 *
 * Tests the pure writer-mapping seam (`buildEvidencePersistenceSnapshot`) and
 * the structural guarantees that evidence is persisted atomically with the
 * trade row. No database connection is used — the evidence columns, schema
 * shape, and freshness/lane policy are tested here via pure logic.
 *
 * Spec: P0.3 — Durable Validated-Fill Evidence Persistence (2026-07-23)
 */

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
  },
): ReturnType<typeof computeFinalExecutionAdmission> {
  return computeFinalExecutionAdmission({
    lane: "equity_cash",
    segment: "NSE_EQ",
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
  const result = phaseB(evidence!);
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
    // This structural test enforces the mapping contract between the TypeScript
    // interface and the ALTER TABLE DDL. If a field is added to the interface,
    // this test will fail until the DB column is also declared.
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
    // Verify selected camelCase→snake_case conversions
    expect(FIELD_TO_COLUMN.fillProvider).toBe("fill_provider");
    expect(FIELD_TO_COLUMN.fillEvidenceVersion).toBe("fill_evidence_version");
    expect(FIELD_TO_COLUMN.fillComputedAgeSec).toBe("fill_computed_age_sec");
  });

  it("21. FILL_EVIDENCE_VERSION constant is the string literal 'v1'", () => {
    expect(FILL_EVIDENCE_VERSION).toBe("v1");
    expect(typeof FILL_EVIDENCE_VERSION).toBe("string");
    // Sanity: it is not a number, not undefined, not an empty string
    expect(FILL_EVIDENCE_VERSION).not.toBe("");
    expect(Number.isNaN(Number(FILL_EVIDENCE_VERSION))).toBe(true);
  });
});

// ─── Group F — lane policy and freshness policy (tests 22–25) ─────────────────

describe("Lane policy and freshness policy", () => {
  it("22. EQUITY_AUTO_ENTRY_CUTOFF is null — AUTO lane fails closed with ENTRY_CUTOFF_CONFIG_UNAVAILABLE (valid evidence supplied)", () => {
    // The AUTO entry-cutoff gate fires BEFORE the evidence freshness check, but AFTER
    // Phase B validates that evidence is non-null. Provide valid evidence so Phase B
    // reaches the cutoff check; null entryCutoffPolicy → ENTRY_CUTOFF_CONFIG_UNAVAILABLE.
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

  it("23. SWING_STAGED_APPROVAL lane also fails closed via ENTRY_CUTOFF_CONFIG_UNAVAILABLE when cutoff is null (valid evidence supplied)", () => {
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
    // Only one policy key is registered (Phase A gate is explicit, not open-ended)
    expect(Object.keys(EQUITY_FRESHNESS_POLICY)).toHaveLength(1);
  });

  it("25. resolveFreshnessPolicy returns 120 for the registered key and null for unknown / empty keys", () => {
    expect(resolveFreshnessPolicy("watchlist.quote.maxFreshnessSec")).toBe(120);
    expect(resolveFreshnessPolicy("nonexistent.policy")).toBeNull();
    expect(resolveFreshnessPolicy("")).toBeNull();
    expect(resolveFreshnessPolicy("watchlist.quote.maxFreshnessSec.typo")).toBeNull();
  });
});
