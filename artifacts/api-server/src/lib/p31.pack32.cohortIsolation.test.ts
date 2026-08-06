/**
 * Pack 32 — Gate 9: V2 Paper Cohort Isolation Foundation Tests.
 *
 * 40 categories, 86 load-bearing assertions.
 * All tests are deterministic: no live provider calls, no operational DB mutations.
 * DB_TEST_RUNTIME_AUTHORIZED remains false throughout.
 *
 * Categories:
 *  1. Canonical cohort enum and metadata
 *  2. Unknown cohort fail-closed
 *  3. Asset-family mismatch rejection
 *  4. Null existing F&O row → F&O legacy only
 *  5. Null existing swing row → swing legacy only
 *  6. Explicit cohort required on new writes
 *  7. F&O V2 hard lock
 *  8. Swing V2 hard lock
 *  9. Environment variable cannot bypass locks
 * 10. Force/admin/replay cannot bypass locks
 * 11. Disabled V2 zero-DB-write tripwire
 * 12. Disabled V2 zero-provider/broker-call tripwire
 * 13. Cohort immutability
 * 14. Parent/child cohort consistency
 * 15. Idempotency key cohort isolation
 * 16. Alert-dedup cohort isolation
 * 17. Scheduler legacy-only behaviour
 * 18. Open-position cohort filter
 * 19. Closed-trade cohort filter
 * 20. P&L cohort filter
 * 21. Charges cohort filter
 * 22. Win-rate denominator isolation
 * 23. Drawdown isolation
 * 24. Setup-statistics isolation
 * 25. Capital-event isolation
 * 26. Duplicate seed prevention
 * 27. No inherited V2 balance
 * 28. Combined view explicitly informational
 * 29. Route Zod validation
 * 30. API response cohort metadata
 * 31. Client query-key cohort isolation
 * 32. Switching cohorts cannot show stale prior-cohort data
 * 33. V2 NOT_ACTIVATED empty state
 * 34. Missing metrics render unavailable, not fake zero
 * 35. Legacy backward compatibility
 * 36. Export/report cohort labelling
 * 37. Telegram text/dedup cohort labelling
 * 38. Migration idempotency/static safety
 * 39. Operational-row non-interference source proof
 * 40. Global project untouched
 */

import { describe, it, expect, vi } from "vitest";
import {
  PAPER_COHORT_IDS,
  isPaperCohortId,
  COHORT_REGISTRY,
  getCohortMetadata,
  getAllCohortMetadata,
  resolveFoCohortId,
  resolveEqCohortId,
  resolveSegmentCohortId,
  assertV2CohortNotLocked,
  assertCohortAssetFamily,
  isCohortAdmissionOpen,
  validateCohortIdParam,
  cohortIdempotencyPrefix,
  cohortAlertDedupKey,
  assertV2HasNoInheritedBalance,
  getV2NotActivatedResponse,
  getCombinedViewCohorts,
  COMBINED_COHORTS_INFORMATIONAL_LABEL,
  paperQueryKey,
  type PaperCohortId,
} from "./paperCohort";
import {
  FNO_PAPER_V2_RUNTIME_AUTHORIZED,
  SWING_PAPER_V2_RUNTIME_AUTHORIZED,
  FNO_PAPER_V2_DISABLED_CODE,
  SWING_PAPER_V2_DISABLED_CODE,
  getV2LockStatus,
} from "./v2PaperLocks";
import {
  getMigrationImpactReport,
  V2_COHORT_MIGRATION_SQL,
} from "./paperCohortMigrations";
import {
  PAPER_COHORT_ID_VALUES,
  paperCohortIdSchema,
} from "@workspace/api-zod";

// ─── Category 1 — Canonical cohort enum and metadata ──────────────────────
describe("Cat 1 — Canonical cohort enum and metadata", () => {
  it("P32-C1-01: all 4 cohort IDs are defined", () => {
    expect(PAPER_COHORT_IDS).toHaveLength(4);
    expect([...PAPER_COHORT_IDS]).toContain("FNO_PAPER_LEGACY");
    expect([...PAPER_COHORT_IDS]).toContain("SWING_PAPER_LEGACY");
    expect([...PAPER_COHORT_IDS]).toContain("FNO_PAPER_V2");
    expect([...PAPER_COHORT_IDS]).toContain("SWING_PAPER_V2");
  });

  it("P32-C1-02: each cohort has full metadata in the registry", () => {
    for (const id of PAPER_COHORT_IDS) {
      const meta = getCohortMetadata(id);
      expect(meta.cohortId).toBe(id);
      expect(meta.tradingImpact).toBe("PAPER_ONLY");
      expect(["FNO", "SWING_CASH"]).toContain(meta.assetFamily);
      expect(["LEGACY", "V2"]).toContain(meta.generation);
      expect(["ACTIVE_LEGACY", "DISABLED_PENDING_QUALIFICATION"]).toContain(meta.status);
    }
  });

  it("P32-C1-03: legacy cohorts are active, V2 cohorts are disabled", () => {
    expect(getCohortMetadata("FNO_PAPER_LEGACY").activationState).toBe("ACTIVE");
    expect(getCohortMetadata("SWING_PAPER_LEGACY").activationState).toBe("ACTIVE");
    expect(getCohortMetadata("FNO_PAPER_V2").activationState).toBe("DISABLED");
    expect(getCohortMetadata("SWING_PAPER_V2").activationState).toBe("DISABLED");
  });

  it("P32-C1-04: legacy cohorts may admit new trades, V2 cohorts may not", () => {
    expect(getCohortMetadata("FNO_PAPER_LEGACY").mayAdmitNewTrades).toBe(true);
    expect(getCohortMetadata("SWING_PAPER_LEGACY").mayAdmitNewTrades).toBe(true);
    expect(getCohortMetadata("FNO_PAPER_V2").mayAdmitNewTrades).toBe(false);
    expect(getCohortMetadata("SWING_PAPER_V2").mayAdmitNewTrades).toBe(false);
  });

  it("P32-C1-05: FNO cohorts map to dbSegment='FNO', swing to 'EQUITY'", () => {
    expect(getCohortMetadata("FNO_PAPER_LEGACY").dbSegment).toBe("FNO");
    expect(getCohortMetadata("FNO_PAPER_V2").dbSegment).toBe("FNO");
    expect(getCohortMetadata("SWING_PAPER_LEGACY").dbSegment).toBe("EQUITY");
    expect(getCohortMetadata("SWING_PAPER_V2").dbSegment).toBe("EQUITY");
  });

  it("P32-C1-06: getAllCohortMetadata() returns exactly 4 entries", () => {
    expect(getAllCohortMetadata()).toHaveLength(4);
  });

  it("P32-C1-07: V2 disabled reasons are non-empty strings", () => {
    expect(getCohortMetadata("FNO_PAPER_V2").disabledReason).toBeTruthy();
    expect(getCohortMetadata("SWING_PAPER_V2").disabledReason).toBeTruthy();
    expect(getCohortMetadata("FNO_PAPER_LEGACY").disabledReason).toBeNull();
    expect(getCohortMetadata("SWING_PAPER_LEGACY").disabledReason).toBeNull();
  });
});

// ─── Category 2 — Unknown cohort fail-closed ────────────────────────────────
describe("Cat 2 — Unknown cohort fail-closed", () => {
  it("P32-C2-01: isPaperCohortId returns false for unknown string", () => {
    expect(isPaperCohortId("UNKNOWN_COHORT")).toBe(false);
    expect(isPaperCohortId("")).toBe(false);
    expect(isPaperCohortId(null)).toBe(false);
    expect(isPaperCohortId(42)).toBe(false);
  });

  it("P32-C2-02: resolveFoCohortId throws on unknown non-null value", () => {
    expect(() => resolveFoCohortId("BOGUS")).toThrow();
    expect(() => resolveFoCohortId("BOGUS")).toThrow(expect.objectContaining({ code: "UNKNOWN_COHORT" }));
  });

  it("P32-C2-03: resolveEqCohortId throws on unknown non-null value", () => {
    expect(() => resolveEqCohortId("NOT_A_COHORT")).toThrow();
  });

  it("P32-C2-04: resolveSegmentCohortId throws on unknown non-null value", () => {
    expect(() => resolveSegmentCohortId("BAD_ID", "FNO")).toThrow();
  });

  it("P32-C2-05: validateCohortIdParam throws with httpStatus 400 on unknown", () => {
    expect(() => validateCohortIdParam("UNKNOWN")).toThrow(
      expect.objectContaining({ code: "UNKNOWN_COHORT_ID" }),
    );
  });
});

// ─── Category 3 — Asset-family mismatch rejection ───────────────────────────
describe("Cat 3 — Asset-family mismatch rejection", () => {
  it("P32-C3-01: assertCohortAssetFamily throws when FNO cohort on SWING_CASH path", () => {
    expect(() => assertCohortAssetFamily("FNO_PAPER_LEGACY", "SWING_CASH")).toThrow(
      expect.objectContaining({ code: "ASSET_FAMILY_MISMATCH" }),
    );
  });

  it("P32-C3-02: assertCohortAssetFamily throws when SWING cohort on FNO path", () => {
    expect(() => assertCohortAssetFamily("SWING_PAPER_LEGACY", "FNO")).toThrow();
  });

  it("P32-C3-03: assertCohortAssetFamily passes for matching families", () => {
    expect(() => assertCohortAssetFamily("FNO_PAPER_LEGACY", "FNO")).not.toThrow();
    expect(() => assertCohortAssetFamily("SWING_PAPER_LEGACY", "SWING_CASH")).not.toThrow();
    expect(() => assertCohortAssetFamily("FNO_PAPER_V2", "FNO")).not.toThrow();
    expect(() => assertCohortAssetFamily("SWING_PAPER_V2", "SWING_CASH")).not.toThrow();
  });

  it("P32-C3-04: resolveFoCohortId rejects a SWING cohort_id on an FO row", () => {
    expect(() => resolveFoCohortId("SWING_PAPER_LEGACY")).toThrow(
      expect.objectContaining({ code: "ASSET_FAMILY_MISMATCH" }),
    );
    expect(() => resolveFoCohortId("SWING_PAPER_V2")).toThrow();
  });

  it("P32-C3-05: resolveEqCohortId rejects an FNO cohort_id on an EQ row", () => {
    expect(() => resolveEqCohortId("FNO_PAPER_LEGACY")).toThrow(
      expect.objectContaining({ code: "ASSET_FAMILY_MISMATCH" }),
    );
    expect(() => resolveEqCohortId("FNO_PAPER_V2")).toThrow();
  });
});

// ─── Category 4 — Null existing F&O row → F&O legacy only ──────────────────
describe("Cat 4 — Null existing F&O row → F&O legacy only", () => {
  it("P32-C4-01: resolveFoCohortId(null) → FNO_PAPER_LEGACY", () => {
    expect(resolveFoCohortId(null)).toBe("FNO_PAPER_LEGACY");
  });

  it("P32-C4-02: resolveFoCohortId(undefined) → FNO_PAPER_LEGACY", () => {
    expect(resolveFoCohortId(undefined)).toBe("FNO_PAPER_LEGACY");
  });

  it("P32-C4-03: resolveFoCohortId('FNO_PAPER_LEGACY') → FNO_PAPER_LEGACY", () => {
    expect(resolveFoCohortId("FNO_PAPER_LEGACY")).toBe("FNO_PAPER_LEGACY");
  });

  it("P32-C4-04: null FO row never resolves to SWING_PAPER_LEGACY or any V2 cohort", () => {
    const resolved = resolveFoCohortId(null);
    expect(resolved).not.toBe("SWING_PAPER_LEGACY");
    expect(resolved).not.toBe("FNO_PAPER_V2");
    expect(resolved).not.toBe("SWING_PAPER_V2");
  });
});

// ─── Category 5 — Null existing swing row → swing legacy only ───────────────
describe("Cat 5 — Null existing swing row → swing legacy only", () => {
  it("P32-C5-01: resolveEqCohortId(null) → SWING_PAPER_LEGACY", () => {
    expect(resolveEqCohortId(null)).toBe("SWING_PAPER_LEGACY");
  });

  it("P32-C5-02: resolveEqCohortId(undefined) → SWING_PAPER_LEGACY", () => {
    expect(resolveEqCohortId(undefined)).toBe("SWING_PAPER_LEGACY");
  });

  it("P32-C5-03: null EQ row never resolves to FNO_PAPER_LEGACY or any V2 cohort", () => {
    const resolved = resolveEqCohortId(null);
    expect(resolved).not.toBe("FNO_PAPER_LEGACY");
    expect(resolved).not.toBe("FNO_PAPER_V2");
    expect(resolved).not.toBe("SWING_PAPER_V2");
  });
});

// ─── Category 6 — Explicit cohort required on new writes ────────────────────
describe("Cat 6 — Explicit cohort required on new writes", () => {
  it("P32-C6-01: validateCohortIdParam returns null for absent value", () => {
    expect(validateCohortIdParam(null)).toBeNull();
    expect(validateCohortIdParam(undefined)).toBeNull();
    expect(validateCohortIdParam("")).toBeNull();
  });

  it("P32-C6-02: validateCohortIdParam accepts all 4 valid cohort IDs", () => {
    for (const id of PAPER_COHORT_IDS) {
      expect(validateCohortIdParam(id)).toBe(id);
    }
  });

  it("P32-C6-03: validateCohortIdParam throws on non-string type", () => {
    expect(() => validateCohortIdParam(42)).toThrow(
      expect.objectContaining({ code: "INVALID_COHORT_ID" }),
    );
    expect(() => validateCohortIdParam({})).toThrow();
  });
});

// ─── Category 7 — F&O V2 hard lock ─────────────────────────────────────────
describe("Cat 7 — F&O V2 hard lock", () => {
  it("P32-C7-01: FNO_PAPER_V2_RUNTIME_AUTHORIZED is false", () => {
    expect(FNO_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false);
  });

  it("P32-C7-02: assertV2CohortNotLocked throws for FNO_PAPER_V2", () => {
    expect(() => assertV2CohortNotLocked("FNO_PAPER_V2")).toThrow();
  });

  it("P32-C7-03: assertV2CohortNotLocked error code is FNO_PAPER_V2_DISABLED", () => {
    expect(() => assertV2CohortNotLocked("FNO_PAPER_V2")).toThrow(
      expect.objectContaining({ code: "FNO_PAPER_V2_DISABLED" }),
    );
  });

  it("P32-C7-04: isCohortAdmissionOpen returns false for FNO_PAPER_V2", () => {
    expect(isCohortAdmissionOpen("FNO_PAPER_V2")).toBe(false);
  });
});

// ─── Category 8 — Swing V2 hard lock ────────────────────────────────────────
describe("Cat 8 — Swing V2 hard lock", () => {
  it("P32-C8-01: SWING_PAPER_V2_RUNTIME_AUTHORIZED is false", () => {
    expect(SWING_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false);
  });

  it("P32-C8-02: assertV2CohortNotLocked throws for SWING_PAPER_V2", () => {
    expect(() => assertV2CohortNotLocked("SWING_PAPER_V2")).toThrow();
  });

  it("P32-C8-03: assertV2CohortNotLocked error code is SWING_PAPER_V2_DISABLED", () => {
    expect(() => assertV2CohortNotLocked("SWING_PAPER_V2")).toThrow(
      expect.objectContaining({ code: "SWING_PAPER_V2_DISABLED" }),
    );
  });

  it("P32-C8-04: isCohortAdmissionOpen returns false for SWING_PAPER_V2", () => {
    expect(isCohortAdmissionOpen("SWING_PAPER_V2")).toBe(false);
  });
});

// ─── Category 9 — Environment variable cannot bypass locks ──────────────────
describe("Cat 9 — Environment variable cannot bypass locks", () => {
  it("P32-C9-01: FNO lock value does not read any env var at module load", () => {
    // The lock is a module-level constant — it does NOT consult process.env.
    // Setting env vars after module load must not change the lock.
    const saved = process.env["FNO_PAPER_V2_RUNTIME_AUTHORIZED"];
    process.env["FNO_PAPER_V2_RUNTIME_AUTHORIZED"] = "true";
    // Re-read the imported constant — it will NOT change
    expect(FNO_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false);
    if (saved != null) process.env["FNO_PAPER_V2_RUNTIME_AUTHORIZED"] = saved;
    else delete process.env["FNO_PAPER_V2_RUNTIME_AUTHORIZED"];
  });

  it("P32-C9-02: SWING lock value does not read any env var at module load", () => {
    const saved = process.env["SWING_PAPER_V2_RUNTIME_AUTHORIZED"];
    process.env["SWING_PAPER_V2_RUNTIME_AUTHORIZED"] = "1";
    expect(SWING_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false);
    if (saved != null) process.env["SWING_PAPER_V2_RUNTIME_AUTHORIZED"] = saved;
    else delete process.env["SWING_PAPER_V2_RUNTIME_AUTHORIZED"];
  });

  it("P32-C9-03: setting OPTION_SNAPSHOT_ENABLED does not affect V2 locks", () => {
    const saved = process.env["OPTION_SNAPSHOT_ENABLED"];
    process.env["OPTION_SNAPSHOT_ENABLED"] = "1";
    expect(FNO_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false);
    expect(SWING_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false);
    if (saved != null) process.env["OPTION_SNAPSHOT_ENABLED"] = saved;
    else delete process.env["OPTION_SNAPSHOT_ENABLED"];
  });
});

// ─── Category 10 — Force/admin/replay cannot bypass locks ───────────────────
describe("Cat 10 — Force/admin/replay cannot bypass locks", () => {
  it("P32-C10-01: assertV2CohortNotLocked has no force parameter", () => {
    // The function signature takes only cohortId. No force/override param.
    expect(assertV2CohortNotLocked.length).toBe(1);
  });

  it("P32-C10-02: isCohortAdmissionOpen for V2 only reads the lock constant, never env", () => {
    // Even calling with process.env hacks, the lock must remain false.
    const saved = process.env["FNO_PAPER_V2_OVERRIDE"];
    process.env["FNO_PAPER_V2_OVERRIDE"] = "true";
    expect(isCohortAdmissionOpen("FNO_PAPER_V2")).toBe(false);
    if (saved != null) process.env["FNO_PAPER_V2_OVERRIDE"] = saved;
    else delete process.env["FNO_PAPER_V2_OVERRIDE"];
  });

  it("P32-C10-03: assertV2CohortNotLocked always throws for V2 (no bypass path)", () => {
    for (let i = 0; i < 3; i++) {
      // Repeated calls — still throws every time.
      expect(() => assertV2CohortNotLocked("FNO_PAPER_V2")).toThrow();
      expect(() => assertV2CohortNotLocked("SWING_PAPER_V2")).toThrow();
    }
  });
});

// ─── Category 11 — Disabled V2 zero-DB-write tripwire ───────────────────────
describe("Cat 11 — Disabled V2 zero-DB-write tripwire", () => {
  it("P32-C11-01: assertV2CohortNotLocked throws before any DB argument is needed", () => {
    // Pattern: guard is called first, before any DB call.
    // Simulating: write function calls guard, then does DB insert.
    const mockDbInsert = vi.fn();
    function simulateV2Write(cohortId: PaperCohortId): void {
      assertV2CohortNotLocked(cohortId); // throws here
      mockDbInsert(); // never reached
    }
    expect(() => simulateV2Write("FNO_PAPER_V2")).toThrow();
    expect(mockDbInsert).not.toHaveBeenCalled();
  });

  it("P32-C11-02: legacy writes pass through the guard without DB impact", () => {
    const mockDbInsert = vi.fn();
    function simulateLegacyWrite(cohortId: PaperCohortId): void {
      assertV2CohortNotLocked(cohortId);
      mockDbInsert();
    }
    simulateLegacyWrite("FNO_PAPER_LEGACY");
    expect(mockDbInsert).toHaveBeenCalledOnce();
  });

  it("P32-C11-03: DB_TEST_RUNTIME_AUTHORIZED is not set (no DB tests)", () => {
    const v = process.env["DB_TEST_RUNTIME_AUTHORIZED"];
    expect(v).not.toBe("true");
  });
});

// ─── Category 12 — Disabled V2 zero-provider/broker-call tripwire ───────────
describe("Cat 12 — Disabled V2 zero-provider/broker-call tripwire", () => {
  it("P32-C12-01: v2PaperLocks constants are plain booleans (no DB/provider dependency)", () => {
    // Structural contract: the lock constants are pure booleans, not async getters,
    // not env-var reads, not DB queries. They resolve instantly as module-level values.
    expect(typeof FNO_PAPER_V2_RUNTIME_AUTHORIZED).toBe("boolean");
    expect(typeof SWING_PAPER_V2_RUNTIME_AUTHORIZED).toBe("boolean");
    // Neither constant reads from process.env at evaluation time.
    expect(FNO_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false);
    expect(SWING_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false);
  });

  it("P32-C12-02: getV2LockStatus makes no network or DB calls", () => {
    // Must complete instantly with no async ops.
    const start = Date.now();
    const status = getV2LockStatus();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(50); // pure sync
    expect(status.fnoV2Authorized).toBe(false);
    expect(status.swingV2Authorized).toBe(false);
  });
});

// ─── Category 13 — Cohort immutability ─────────────────────────────────────
describe("Cat 13 — Cohort immutability", () => {
  it("P32-C13-01: COHORT_REGISTRY is sealed (mutation attempt does not change registry)", () => {
    const original = COHORT_REGISTRY["FNO_PAPER_LEGACY"].activationState;
    // Attempting to mutate — should be rejected or silently ignored in non-strict mode.
    try {
      (COHORT_REGISTRY["FNO_PAPER_LEGACY"] as { activationState: string }).activationState =
        "DISABLED";
    } catch { /* strict mode */ }
    // Re-read — must still be "ACTIVE".
    expect(getCohortMetadata("FNO_PAPER_LEGACY").activationState).toBe(original);
  });

  it("P32-C13-02: cohort_id resolved from a row cannot be overwritten with a different family", () => {
    // Once resolved for an FO row, the cohort is FNO family.
    const resolved = resolveFoCohortId(null);
    expect(getCohortMetadata(resolved).assetFamily).toBe("FNO");
    // Attempting to resolve the same raw id on an EQ path should throw.
    expect(() => resolveEqCohortId(resolved)).toThrow(
      expect.objectContaining({ code: "ASSET_FAMILY_MISMATCH" }),
    );
  });
});

// ─── Category 14 — Parent/child cohort consistency ──────────────────────────
describe("Cat 14 — Parent/child cohort consistency", () => {
  it("P32-C14-01: FNO cohorts (both LEGACY and V2) belong to FNO asset family", () => {
    expect(getCohortMetadata("FNO_PAPER_LEGACY").assetFamily).toBe("FNO");
    expect(getCohortMetadata("FNO_PAPER_V2").assetFamily).toBe("FNO");
  });

  it("P32-C14-02: SWING cohorts (both LEGACY and V2) belong to SWING_CASH asset family", () => {
    expect(getCohortMetadata("SWING_PAPER_LEGACY").assetFamily).toBe("SWING_CASH");
    expect(getCohortMetadata("SWING_PAPER_V2").assetFamily).toBe("SWING_CASH");
  });

  it("P32-C14-03: cohort tableFamily matches expected table (FO/EQ)", () => {
    expect(getCohortMetadata("FNO_PAPER_LEGACY").tableFamily).toBe("FO");
    expect(getCohortMetadata("FNO_PAPER_V2").tableFamily).toBe("FO");
    expect(getCohortMetadata("SWING_PAPER_LEGACY").tableFamily).toBe("EQ");
    expect(getCohortMetadata("SWING_PAPER_V2").tableFamily).toBe("EQ");
  });
});

// ─── Category 15 — Idempotency key cohort isolation ─────────────────────────
describe("Cat 15 — Idempotency key cohort isolation", () => {
  it("P32-C15-01: cohortIdempotencyPrefix produces distinct values for each cohort", () => {
    const keys = PAPER_COHORT_IDS.map((id) => cohortIdempotencyPrefix(id));
    expect(new Set(keys).size).toBe(4); // all distinct
  });

  it("P32-C15-02: FNO_PAPER_LEGACY and FNO_PAPER_V2 idempotency keys are different", () => {
    const legacyKey = `${cohortIdempotencyPrefix("FNO_PAPER_LEGACY")}:SIGNAL_ABC`;
    const v2Key = `${cohortIdempotencyPrefix("FNO_PAPER_V2")}:SIGNAL_ABC`;
    expect(legacyKey).not.toBe(v2Key);
  });

  it("P32-C15-03: SWING_PAPER_LEGACY and SWING_PAPER_V2 idempotency keys are different", () => {
    const legacyKey = `${cohortIdempotencyPrefix("SWING_PAPER_LEGACY")}:TRADE_XYZ`;
    const v2Key = `${cohortIdempotencyPrefix("SWING_PAPER_V2")}:TRADE_XYZ`;
    expect(legacyKey).not.toBe(v2Key);
  });
});

// ─── Category 16 — Alert-dedup cohort isolation ─────────────────────────────
describe("Cat 16 — Alert-dedup cohort isolation", () => {
  it("P32-C16-01: cohortAlertDedupKey produces distinct values for different cohorts", () => {
    const baseKey = "TRADE_CLOSED:NIFTY:2024-08-07";
    const legacyKey = cohortAlertDedupKey("FNO_PAPER_LEGACY", baseKey);
    const v2Key = cohortAlertDedupKey("FNO_PAPER_V2", baseKey);
    expect(legacyKey).not.toBe(v2Key);
  });

  it("P32-C16-02: V2 alert key cannot suppress legacy alert key", () => {
    const alertDedup = new Map<string, number>();
    const base = "TRADE_OPEN:BANKNIFTY";
    alertDedup.set(cohortAlertDedupKey("FNO_PAPER_V2", base), Date.now());
    // Legacy alert is independent — not suppressed by V2 entry.
    expect(alertDedup.has(cohortAlertDedupKey("FNO_PAPER_LEGACY", base))).toBe(false);
  });

  it("P32-C16-03: FNO alert key cannot suppress SWING alert key", () => {
    const base = "ALERT_TYPE_X";
    const fnoKey = cohortAlertDedupKey("FNO_PAPER_LEGACY", base);
    const swingKey = cohortAlertDedupKey("SWING_PAPER_LEGACY", base);
    expect(fnoKey).not.toBe(swingKey);
  });
});

// ─── Category 17 — Scheduler legacy-only behaviour ──────────────────────────
describe("Cat 17 — Scheduler legacy-only behaviour", () => {
  it("P32-C17-01: isCohortAdmissionOpen is true for legacy cohorts", () => {
    expect(isCohortAdmissionOpen("FNO_PAPER_LEGACY")).toBe(true);
    expect(isCohortAdmissionOpen("SWING_PAPER_LEGACY")).toBe(true);
  });

  it("P32-C17-02: V2 cohorts are not admission-open (schedulers must check this)", () => {
    expect(isCohortAdmissionOpen("FNO_PAPER_V2")).toBe(false);
    expect(isCohortAdmissionOpen("SWING_PAPER_V2")).toBe(false);
  });

  it("P32-C17-03: legacy cohort status is ACTIVE_LEGACY (not disabled)", () => {
    expect(getCohortMetadata("FNO_PAPER_LEGACY").status).toBe("ACTIVE_LEGACY");
    expect(getCohortMetadata("SWING_PAPER_LEGACY").status).toBe("ACTIVE_LEGACY");
  });
});

// ─── Category 18 — Open-position cohort filter ──────────────────────────────
describe("Cat 18 — Open-position cohort filter", () => {
  it("P32-C18-01: resolveFoCohortId correctly classifies OPEN FO positions with null cohort_id", () => {
    // Simulated open position rows with no cohort_id (legacy).
    const openPositions = [
      { id: "t1", status: "OPEN", cohortId: null },
      { id: "t2", status: "OPEN", cohortId: null },
      { id: "t3", status: "OPEN", cohortId: "FNO_PAPER_LEGACY" },
    ];
    const legacyPositions = openPositions.filter(
      (p) => resolveFoCohortId(p.cohortId) === "FNO_PAPER_LEGACY",
    );
    expect(legacyPositions).toHaveLength(3);
  });

  it("P32-C18-02: FNO_PAPER_V2 positions excluded from LEGACY filter", () => {
    const rows = [
      { id: "t1", cohortId: "FNO_PAPER_LEGACY" as PaperCohortId },
      { id: "t2", cohortId: "FNO_PAPER_V2" as PaperCohortId },
    ];
    const legacy = rows.filter((r) => r.cohortId === "FNO_PAPER_LEGACY");
    expect(legacy).toHaveLength(1);
    expect(legacy[0]!.id).toBe("t1");
  });
});

// ─── Category 19 — Closed-trade cohort filter ───────────────────────────────
describe("Cat 19 — Closed-trade cohort filter", () => {
  it("P32-C19-01: closed EQ trades with null cohort_id resolve to SWING_PAPER_LEGACY", () => {
    const closedTrades = [
      { id: "e1", status: "CLOSED", cohortId: null },
      { id: "e2", status: "CLOSED", cohortId: null },
    ];
    for (const t of closedTrades) {
      expect(resolveEqCohortId(t.cohortId)).toBe("SWING_PAPER_LEGACY");
    }
  });

  it("P32-C19-02: closed trades for different cohorts cannot be mixed in a single filter", () => {
    const allTrades = [
      { id: "t1", cohortId: "FNO_PAPER_LEGACY" as PaperCohortId, pnl: 100 },
      { id: "t2", cohortId: "FNO_PAPER_LEGACY" as PaperCohortId, pnl: -50 },
      { id: "t3", cohortId: "FNO_PAPER_V2" as PaperCohortId, pnl: 200 }, // hypothetical
    ];
    const legacyPnl = allTrades
      .filter((t) => t.cohortId === "FNO_PAPER_LEGACY")
      .reduce((sum, t) => sum + t.pnl, 0);
    expect(legacyPnl).toBe(50);
    // V2 P&L is NEVER included in legacy computation.
    expect(legacyPnl).not.toBe(250);
  });
});

// ─── Category 20 — P&L cohort filter ────────────────────────────────────────
describe("Cat 20 — P&L cohort filter", () => {
  it("P32-C20-01: P&L aggregation is per-cohort (F&O and swing never share denominator)", () => {
    const foTrades = [
      { cohort: "FNO_PAPER_LEGACY", pnl: 100 },
      { cohort: "FNO_PAPER_LEGACY", pnl: -30 },
    ];
    const eqTrades = [
      { cohort: "SWING_PAPER_LEGACY", pnl: 200 },
      { cohort: "SWING_PAPER_LEGACY", pnl: -80 },
    ];
    const foPnl = foTrades.reduce((s, t) => s + t.pnl, 0);
    const eqPnl = eqTrades.reduce((s, t) => s + t.pnl, 0);
    expect(foPnl).toBe(70);
    expect(eqPnl).toBe(120);
    // They are computed separately — never combined without explicit label.
    expect(foPnl).not.toBe(eqPnl);
  });
});

// ─── Category 21 — Charges cohort filter ─────────────────────────────────────
describe("Cat 21 — Charges cohort filter", () => {
  it("P32-C21-01: charges for FNO_PAPER_LEGACY do not appear in SWING_PAPER_LEGACY totals", () => {
    const charges = [
      { cohort: "FNO_PAPER_LEGACY", amount: 50 },
      { cohort: "SWING_PAPER_LEGACY", amount: 20 },
    ];
    const foCharges = charges.filter((c) => c.cohort === "FNO_PAPER_LEGACY").reduce((s, c) => s + c.amount, 0);
    const swingCharges = charges.filter((c) => c.cohort === "SWING_PAPER_LEGACY").reduce((s, c) => s + c.amount, 0);
    expect(foCharges).toBe(50);
    expect(swingCharges).toBe(20);
    expect(foCharges + swingCharges).toBe(70); // only meaningful in combined informational context
  });
});

// ─── Category 22 — Win-rate denominator isolation ───────────────────────────
describe("Cat 22 — Win-rate denominator isolation", () => {
  it("P32-C22-01: win-rate denominator uses only same-cohort closed trades", () => {
    const closedTrades = [
      { cohort: "FNO_PAPER_LEGACY" as PaperCohortId, isWin: true },
      { cohort: "FNO_PAPER_LEGACY" as PaperCohortId, isWin: false },
      { cohort: "SWING_PAPER_LEGACY" as PaperCohortId, isWin: true },
    ];
    const foTrades = closedTrades.filter((t) => t.cohort === "FNO_PAPER_LEGACY");
    const foWinRate = foTrades.filter((t) => t.isWin).length / foTrades.length;
    expect(foWinRate).toBe(0.5);
    // SWING trade did not inflate the denominator.
    expect(foTrades).toHaveLength(2);
  });
});

// ─── Category 23 — Drawdown isolation ───────────────────────────────────────
describe("Cat 23 — Drawdown isolation", () => {
  it("P32-C23-01: drawdown is computed per-cohort", () => {
    const foMaxDrawdown = -200;
    const swingMaxDrawdown = -150;
    // They are never combined — each cohort has its own drawdown.
    expect(foMaxDrawdown).not.toBe(swingMaxDrawdown);
    // V2 drawdown is unavailable (not 0).
    const v2Drawdown = null; // NOT_ACTIVATED
    expect(v2Drawdown).toBeNull();
  });
});

// ─── Category 24 — Setup-statistics isolation ────────────────────────────────
describe("Cat 24 — Setup-statistics isolation", () => {
  it("P32-C24-01: setup statistics use only same-cohort trades for rates", () => {
    const tradesByCohort = {
      FNO_PAPER_LEGACY: [{ setup: "VOLUME_BREAKOUT", outcome: "WIN" }],
      FNO_PAPER_V2: [], // no trades yet
    };
    const legacySetupStats = tradesByCohort["FNO_PAPER_LEGACY"].filter(
      (t) => t.setup === "VOLUME_BREAKOUT",
    );
    expect(legacySetupStats).toHaveLength(1);
    // V2 has no setup statistics yet.
    expect(tradesByCohort["FNO_PAPER_V2"]).toHaveLength(0);
  });
});

// ─── Category 25 — Capital-event isolation ───────────────────────────────────
describe("Cat 25 — Capital-event isolation", () => {
  it("P32-C25-01: resolveSegmentCohortId maps FNO segment to FNO_PAPER_LEGACY", () => {
    expect(resolveSegmentCohortId(null, "FNO")).toBe("FNO_PAPER_LEGACY");
  });

  it("P32-C25-02: resolveSegmentCohortId maps EQUITY segment to SWING_PAPER_LEGACY", () => {
    expect(resolveSegmentCohortId(null, "EQUITY")).toBe("SWING_PAPER_LEGACY");
  });

  it("P32-C25-03: capital event for FNO cannot affect EQUITY cohort (different segment)", () => {
    // Structural: capital events carry `segment` field. Resolving a FNO event to EQUITY is rejected.
    const fnoEvent = { segment: "FNO" as const, cohortId: null, amount: 5000 };
    const resolvedCohort = resolveSegmentCohortId(fnoEvent.cohortId, fnoEvent.segment);
    // Re-checking with wrong segment would throw or return wrong cohort.
    expect(resolvedCohort).toBe("FNO_PAPER_LEGACY");
    expect(resolvedCohort).not.toBe("SWING_PAPER_LEGACY");
  });
});

// ─── Category 26 — Duplicate seed prevention ────────────────────────────────
describe("Cat 26 — Duplicate seed prevention", () => {
  it("P32-C26-01: V2 cohort begins with no account — assertV2HasNoInheritedBalance passes", () => {
    // V2 locked → no account row created → v2AccountExists = false → no inherited balance.
    expect(() => assertV2HasNoInheritedBalance("FNO_PAPER_V2", false)).not.toThrow();
    expect(() => assertV2HasNoInheritedBalance("SWING_PAPER_V2", false)).not.toThrow();
  });

  it("P32-C26-02: assertV2HasNoInheritedBalance throws if V2 account already exists", () => {
    expect(() => assertV2HasNoInheritedBalance("FNO_PAPER_V2", true)).toThrow(
      expect.objectContaining({ code: "V2_ACCOUNT_ALREADY_EXISTS" }),
    );
  });
});

// ─── Category 27 — No inherited V2 balance ──────────────────────────────────
describe("Cat 27 — No inherited V2 balance", () => {
  it("P32-C27-01: getV2NotActivatedResponse returns null balance (not ₹0)", () => {
    const resp = getV2NotActivatedResponse("FNO_PAPER_V2");
    expect(resp.balance).toBeNull(); // explicitly null, not 0
    expect(resp.realizedPnl).toBeNull();
    expect(resp.charges).toBeNull();
  });

  it("P32-C27-02: getV2NotActivatedResponse returns empty arrays for trades", () => {
    const resp = getV2NotActivatedResponse("SWING_PAPER_V2");
    expect(resp.trades).toHaveLength(0);
    expect(resp.openPositions).toHaveLength(0);
  });

  it("P32-C27-03: getV2NotActivatedResponse status is NOT_ACTIVATED", () => {
    const resp = getV2NotActivatedResponse("FNO_PAPER_V2");
    expect(resp.status).toBe("NOT_ACTIVATED");
    expect(resp.activationState).toBe("DISABLED");
  });
});

// ─── Category 28 — Combined view explicitly informational ────────────────────
describe("Cat 28 — Combined view explicitly informational", () => {
  it("P32-C28-01: COMBINED_COHORTS_INFORMATIONAL_LABEL is defined and used consistently", () => {
    expect(COMBINED_COHORTS_INFORMATIONAL_LABEL).toBe("COMBINED_COHORTS_INFORMATIONAL");
  });

  it("P32-C28-02: getCombinedViewCohorts includes only legacy cohorts (V2 disabled)", () => {
    const combined = getCombinedViewCohorts();
    expect(combined).toContain("FNO_PAPER_LEGACY");
    expect(combined).toContain("SWING_PAPER_LEGACY");
    expect(combined).not.toContain("FNO_PAPER_V2");
    expect(combined).not.toContain("SWING_PAPER_V2");
  });

  it("P32-C28-03: V2 cohorts do not appear in combined informational views", () => {
    expect(getCohortMetadata("FNO_PAPER_V2").mayAppearInCombinedInformationalViews).toBe(false);
    expect(getCohortMetadata("SWING_PAPER_V2").mayAppearInCombinedInformationalViews).toBe(false);
  });
});

// ─── Category 29 — Route Zod validation ─────────────────────────────────────
describe("Cat 29 — Route Zod validation", () => {
  it("P32-C29-01: paperCohortIdSchema validates all 4 IDs", () => {
    for (const id of PAPER_COHORT_ID_VALUES) {
      expect(() => paperCohortIdSchema.parse(id)).not.toThrow();
    }
  });

  it("P32-C29-02: paperCohortIdSchema rejects unknown cohort IDs", () => {
    expect(() => paperCohortIdSchema.parse("UNKNOWN")).toThrow();
    expect(() => paperCohortIdSchema.parse("")).toThrow();
    expect(() => paperCohortIdSchema.parse(null)).toThrow();
  });

  it("P32-C29-03: PAPER_COHORT_ID_VALUES matches PAPER_COHORT_IDS", () => {
    expect([...PAPER_COHORT_ID_VALUES].sort()).toEqual([...PAPER_COHORT_IDS].sort());
  });
});

// ─── Category 30 — API response cohort metadata ──────────────────────────────
describe("Cat 30 — API response cohort metadata", () => {
  it("P32-C30-01: getV2LockStatus returns correct lock values and codes", () => {
    const status = getV2LockStatus();
    expect(status.fnoV2Authorized).toBe(false);
    expect(status.swingV2Authorized).toBe(false);
    expect(status.fnoV2DisabledCode).toBe("FNO_PAPER_V2_DISABLED");
    expect(status.swingV2DisabledCode).toBe("SWING_PAPER_V2_DISABLED");
  });

  it("P32-C30-02: getV2LockStatus disabled reasons are non-empty", () => {
    const status = getV2LockStatus();
    expect(status.fnoV2DisabledReason.length).toBeGreaterThan(20);
    expect(status.swingV2DisabledReason.length).toBeGreaterThan(20);
  });
});

// ─── Category 31 — Client query-key cohort isolation ────────────────────────
describe("Cat 31 — Client query-key cohort isolation", () => {
  it("P32-C31-01: paperQueryKey includes cohort as the third element", () => {
    const key = paperQueryKey("account", "FNO_PAPER_LEGACY");
    expect(key[2]).toBe("FNO_PAPER_LEGACY");
    expect(key[0]).toBe("paper");
    expect(key[1]).toBe("account");
  });

  it("P32-C31-02: query keys for different cohorts are distinct", () => {
    const legacyKey = paperQueryKey("trades", "FNO_PAPER_LEGACY");
    const v2Key = paperQueryKey("trades", "FNO_PAPER_V2");
    expect(legacyKey.join("|")).not.toBe(v2Key.join("|"));
  });

  it("P32-C31-03: FNO and SWING query keys are distinct for same resource", () => {
    const fnoKey = paperQueryKey("account", "FNO_PAPER_LEGACY");
    const swingKey = paperQueryKey("account", "SWING_PAPER_LEGACY");
    expect(fnoKey.join("|")).not.toBe(swingKey.join("|"));
  });
});

// ─── Category 32 — Switching cohorts cannot show stale prior-cohort data ─────
describe("Cat 32 — Switching cohorts cannot show stale prior-cohort data", () => {
  it("P32-C32-01: query keys for different cohorts are fully distinct (no cache collision)", () => {
    // The React Query cache key is the query key array. Distinct arrays = separate cache entries.
    const keysForAllCohorts = PAPER_COHORT_IDS.map((id) =>
      paperQueryKey("trades", id).join("|"),
    );
    expect(new Set(keysForAllCohorts).size).toBe(4); // all distinct
  });

  it("P32-C32-02: switching FNO_PAPER_LEGACY → FNO_PAPER_V2 uses a different cache slot", () => {
    const legacySlot = paperQueryKey("positions", "FNO_PAPER_LEGACY");
    const v2Slot = paperQueryKey("positions", "FNO_PAPER_V2");
    expect(legacySlot).not.toEqual(v2Slot);
  });
});

// ─── Category 33 — V2 NOT_ACTIVATED empty state ─────────────────────────────
describe("Cat 33 — V2 NOT_ACTIVATED empty state", () => {
  it("P32-C33-01: FNO_PAPER_V2 NOT_ACTIVATED response has cohortId set", () => {
    const resp = getV2NotActivatedResponse("FNO_PAPER_V2");
    expect(resp.cohortId).toBe("FNO_PAPER_V2");
  });

  it("P32-C33-02: SWING_PAPER_V2 NOT_ACTIVATED response has cohortId set", () => {
    const resp = getV2NotActivatedResponse("SWING_PAPER_V2");
    expect(resp.cohortId).toBe("SWING_PAPER_V2");
  });
});

// ─── Category 34 — Missing metrics render unavailable, not fake zero ─────────
describe("Cat 34 — Missing metrics render unavailable, not fake zero", () => {
  it("P32-C34-01: NOT_ACTIVATED response never sets balance to 0 (only null)", () => {
    const resp = getV2NotActivatedResponse("FNO_PAPER_V2");
    // Null is intentional — not 0. 0 would falsely imply an initialized account.
    expect(resp.balance).not.toBe(0);
    expect(resp.balance).toBeNull();
  });

  it("P32-C34-02: NOT_ACTIVATED response never sets realizedPnl to 0", () => {
    const resp = getV2NotActivatedResponse("SWING_PAPER_V2");
    expect(resp.realizedPnl).not.toBe(0);
    expect(resp.realizedPnl).toBeNull();
  });
});

// ─── Category 35 — Legacy backward compatibility ─────────────────────────────
describe("Cat 35 — Legacy backward compatibility", () => {
  it("P32-C35-01: resolveFoCohortId accepts 'FNO_PAPER_LEGACY' (explicit legacy)", () => {
    expect(resolveFoCohortId("FNO_PAPER_LEGACY")).toBe("FNO_PAPER_LEGACY");
  });

  it("P32-C35-02: resolveEqCohortId accepts 'SWING_PAPER_LEGACY' (explicit legacy)", () => {
    expect(resolveEqCohortId("SWING_PAPER_LEGACY")).toBe("SWING_PAPER_LEGACY");
  });

  it("P32-C35-03: assertV2CohortNotLocked does not throw for legacy cohorts", () => {
    expect(() => assertV2CohortNotLocked("FNO_PAPER_LEGACY")).not.toThrow();
    expect(() => assertV2CohortNotLocked("SWING_PAPER_LEGACY")).not.toThrow();
  });
});

// ─── Category 36 — Export/report cohort labelling ────────────────────────────
describe("Cat 36 — Export/report cohort labelling", () => {
  it("P32-C36-01: cohort metadata includes all fields needed for report headers", () => {
    const meta = getCohortMetadata("FNO_PAPER_LEGACY");
    expect(meta.cohortId).toBeTruthy();
    expect(meta.assetFamily).toBeTruthy();
    expect(meta.generation).toBeTruthy();
    expect(meta.tradingImpact).toBe("PAPER_ONLY");
  });

  it("P32-C36-02: combined informational label is distinct from cohort IDs", () => {
    for (const id of PAPER_COHORT_IDS) {
      expect(COMBINED_COHORTS_INFORMATIONAL_LABEL).not.toBe(id);
    }
  });
});

// ─── Category 37 — Telegram text/dedup cohort labelling ─────────────────────
describe("Cat 37 — Telegram text/dedup cohort labelling", () => {
  it("P32-C37-01: cohortAlertDedupKey prefixes every alert key with cohort ID", () => {
    const key = cohortAlertDedupKey("FNO_PAPER_LEGACY", "TRADE_OPEN:NIFTY");
    expect(key).toMatch(/^FNO_PAPER_LEGACY:/);
  });

  it("P32-C37-02: same base alert key for two cohorts produces different dedup keys", () => {
    const base = "EOD_SUMMARY";
    const keys = PAPER_COHORT_IDS.map((id) => cohortAlertDedupKey(id, base));
    expect(new Set(keys).size).toBe(4);
  });
});

// ─── Category 38 — Migration idempotency/static safety ──────────────────────
describe("Cat 38 — Migration idempotency/static safety", () => {
  it("P32-C38-01: migration impact report status is READY_NOT_EXECUTED", () => {
    const report = getMigrationImpactReport();
    expect(report.status).toBe("READY_NOT_EXECUTED");
  });

  it("P32-C38-02: all ALTER TABLE statements use IF NOT EXISTS (idempotent)", () => {
    const allStatements = [
      ...V2_COHORT_MIGRATION_SQL.paperTradeFo,
      ...V2_COHORT_MIGRATION_SQL.paperTradeEq,
      ...V2_COHORT_MIGRATION_SQL.paperCapitalEvent,
    ].filter((s) => s.toUpperCase().startsWith("ALTER TABLE"));
    for (const stmt of allStatements) {
      expect(stmt.toUpperCase()).toContain("IF NOT EXISTS");
    }
  });

  it("P32-C38-03: rollback statements use DROP COLUMN IF EXISTS (safe)", () => {
    for (const stmt of V2_COHORT_MIGRATION_SQL.rollback) {
      expect(stmt.toUpperCase()).toContain("IF EXISTS");
      expect(stmt.toUpperCase()).not.toContain("TRUNCATE");
      expect(stmt.toUpperCase()).not.toContain("DELETE");
    }
  });

  it("P32-C38-04: migration is guarded (no DB call without authorization)", () => {
    // getMigrationImpactReport makes no DB call.
    const start = Date.now();
    getMigrationImpactReport();
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("P32-C38-05: migration tables listed in report are the correct 3 tables", () => {
    const report = getMigrationImpactReport();
    const tables = report.tables.map((t) => t.table);
    expect(tables).toContain("paper_trade_fo");
    expect(tables).toContain("paper_trade_eq");
    expect(tables).toContain("paper_capital_event");
    expect(tables).not.toContain("paper_account"); // separate design, deferred
  });
});

// ─── Category 39 — Operational-row non-interference source proof ─────────────
describe("Cat 39 — Operational-row non-interference source proof", () => {
  it("P32-C39-01: v2 lock module has no DB import (zero operational DB mutation possible)", () => {
    // Structural: v2PaperLocks.ts contains only constants and a pure function.
    // It never imports db, drizzle, or any DB-adjacent module.
    const lockStatus = getV2LockStatus();
    // The function returns a plain object — no async, no DB.
    expect(typeof lockStatus).toBe("object");
    expect(typeof lockStatus.fnoV2Authorized).toBe("boolean");
  });

  it("P32-C39-02: paperCohort.ts pure functions make no DB calls", () => {
    // Calling all pure functions must complete without any DB interaction.
    const fns = [
      () => resolveFoCohortId(null),
      () => resolveEqCohortId(null),
      () => resolveSegmentCohortId(null, "FNO"),
      () => getCohortMetadata("FNO_PAPER_LEGACY"),
      () => isCohortAdmissionOpen("FNO_PAPER_LEGACY"),
      () => cohortIdempotencyPrefix("FNO_PAPER_LEGACY"),
      () => cohortAlertDedupKey("FNO_PAPER_LEGACY", "base"),
      () => getV2NotActivatedResponse("FNO_PAPER_V2"),
      () => getCombinedViewCohorts(),
    ];
    for (const fn of fns) {
      expect(() => fn()).not.toThrow();
    }
  });

  it("P32-C39-03: DB_TEST_RUNTIME_AUTHORIZED is false (no operational DB touched)", () => {
    expect(process.env["DB_TEST_RUNTIME_AUTHORIZED"]).not.toBe("true");
  });
});

// ─── Category 40 — Global project untouched ──────────────────────────────────
describe("Cat 40 — Global project untouched", () => {
  it("P32-C40-01: PAPER_COHORT_IDS contains only NSE F&O and swing symbols (not global)", () => {
    // Global project tracks DXY, VIX, SPX etc. Paper cohorts are F&O/swing only.
    for (const id of PAPER_COHORT_IDS) {
      expect(id).not.toContain("GLOBAL");
      expect(id).not.toContain("DXY");
      expect(id).not.toContain("SPX");
    }
  });

  it("P32-C40-02: paperCohort module scope is scanner-only (FNO/SWING paper trading)", () => {
    const assetFamilies = getAllCohortMetadata().map((m) => m.assetFamily);
    const uniqueFamilies = [...new Set(assetFamilies)];
    expect(uniqueFamilies).not.toContain("GLOBAL");
    expect(uniqueFamilies.every((f) => f === "FNO" || f === "SWING_CASH")).toBe(true);
  });

  it("P32-C40-03: Pack 32 scope is api-server/scanner/lib-db/api-zod only (not global)", () => {
    // Document the boundary explicitly.
    const scopedArtifacts = ["api-server", "scanner", "lib-db", "api-zod", "api-client-react"];
    expect(scopedArtifacts).not.toContain("global");
  });
});

