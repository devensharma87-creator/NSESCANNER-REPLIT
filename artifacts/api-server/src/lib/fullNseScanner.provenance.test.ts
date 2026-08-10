/**
 * TASK 2 — Classifier Provenance Contract Tests
 *
 * Proves that the five dimensions of the provenance contract are independent
 * and never incorrectly collapsed.
 *
 * Required invariants:
 *   I1. An integrated reference (loaded=true) NEVER produces canaryStatus="CANARY_BLOCKED_REFERENCE_NOT_LOADED"
 *   I2. An integrated reference NEVER produces nseReferenceStatus="NOT_LOADED"
 *   I3. canaryStatus reflects the most-specific remaining blocker (reference > warehouse > evaluation)
 *   I4. warehousePopulationStatus and evaluationStatus are read from compile-time locks, not from reference state
 *   I5. When reference is NOT loaded, canaryStatus is "CANARY_BLOCKED_REFERENCE_NOT_LOADED" regardless of locks
 */
import { describe, it, expect } from "vitest";
import { buildClassifierProvenance } from "./fullNseScanner";

const LOADED_META = {
  loaded: true,
  totalRecords: 12345,
  seriesCounts: { EQ: 4827, SM: 212, GB: 3889 },
  snapshotDate: "2026-08-10",
  sourceHash: "abc123def456",
  sourceUrl: "https://nseindia.com/EQUITY_L.csv",
  fetchedAt: "2026-08-10T03:00:00.000Z",
};

const NOT_LOADED_META = {
  loaded: false,
  totalRecords: null,
  seriesCounts: null,
  snapshotDate: null,
  sourceHash: null,
  sourceUrl: null,
  fetchedAt: null,
};

// ── INVARIANT I1/I2: integrated reference never claims reference not loaded ──

describe("I1+I2: integrated reference (loaded=true) never claims reference is not loaded", () => {
  it("loaded + warehouse locked + eval locked → canaryStatus != REFERENCE_NOT_LOADED", () => {
    const p = buildClassifierProvenance(LOADED_META, {
      warehousePopulationAuthorized: false,
      evaluationAuthorized: false,
    });
    expect(p.canaryStatus).not.toBe("CANARY_BLOCKED_REFERENCE_NOT_LOADED");
    expect(p.nseReferenceStatus).not.toBe("NOT_LOADED");
    expect(p.authoritativeNseReferenceIntegrated).toBe(true);
  });

  it("loaded + warehouse authorized + eval locked → canaryStatus != REFERENCE_NOT_LOADED", () => {
    const p = buildClassifierProvenance(LOADED_META, {
      warehousePopulationAuthorized: true,
      evaluationAuthorized: false,
    });
    expect(p.canaryStatus).not.toBe("CANARY_BLOCKED_REFERENCE_NOT_LOADED");
    expect(p.authoritativeNseReferenceIntegrated).toBe(true);
  });

  it("loaded + both authorized → CANARY_AUTHORIZED_AWAITING_RUNTIME_VALIDATION (never CANARY_PASS from locks alone)", () => {
    const p = buildClassifierProvenance(LOADED_META, {
      warehousePopulationAuthorized: true,
      evaluationAuthorized: true,
    });
    // Authorization is NECESSARY but NOT SUFFICIENT for CANARY_PASS.
    // Runtime evidence of a completed canary is required; locks alone cannot produce CANARY_PASS.
    expect(p.canaryStatus).toBe("CANARY_AUTHORIZED_AWAITING_RUNTIME_VALIDATION");
    expect(p.canaryStatus).not.toBe("CANARY_PASS");
    expect(p.nseReferenceStatus).toBe("LOADED_AND_INTEGRATED");
    expect(p.authoritativeNseReferenceIntegrated).toBe(true);
  });
});

// ── INVARIANT I3: canaryStatus reflects most-specific blocker in priority order ──

describe("I3: canaryStatus reflects the most specific remaining blocker", () => {
  it("not loaded → CANARY_BLOCKED_REFERENCE_NOT_LOADED (reference is the primary blocker)", () => {
    const p = buildClassifierProvenance(NOT_LOADED_META, {
      warehousePopulationAuthorized: false,
      evaluationAuthorized: false,
    });
    expect(p.canaryStatus).toBe("CANARY_BLOCKED_REFERENCE_NOT_LOADED");
  });

  it("loaded + warehouse locked → CANARY_BLOCKED_WAREHOUSE_POPULATION_LOCKED", () => {
    const p = buildClassifierProvenance(LOADED_META, {
      warehousePopulationAuthorized: false,
      evaluationAuthorized: false,
    });
    expect(p.canaryStatus).toBe("CANARY_BLOCKED_WAREHOUSE_POPULATION_LOCKED");
  });

  it("loaded + warehouse authorized + eval locked → CANARY_BLOCKED_EVALUATION_LOCKED", () => {
    const p = buildClassifierProvenance(LOADED_META, {
      warehousePopulationAuthorized: true,
      evaluationAuthorized: false,
    });
    expect(p.canaryStatus).toBe("CANARY_BLOCKED_EVALUATION_LOCKED");
  });

  it("loaded + both authorized → CANARY_AUTHORIZED_AWAITING_RUNTIME_VALIDATION (not CANARY_PASS)", () => {
    const p = buildClassifierProvenance(LOADED_META, {
      warehousePopulationAuthorized: true,
      evaluationAuthorized: true,
    });
    expect(p.canaryStatus).toBe("CANARY_AUTHORIZED_AWAITING_RUNTIME_VALIDATION");
    expect(p.canaryStatus).not.toBe("CANARY_PASS");
  });
});

// ── INVARIANT I4: lock statuses are independent of reference state ──────────

describe("I4: warehousePopulationStatus and evaluationStatus reflect compile-time locks, not reference state", () => {
  it("not loaded + warehouse locked → warehousePopulationStatus=LOCKED", () => {
    const p = buildClassifierProvenance(NOT_LOADED_META, {
      warehousePopulationAuthorized: false,
      evaluationAuthorized: false,
    });
    expect(p.warehousePopulationStatus).toBe("LOCKED");
    expect(p.evaluationStatus).toBe("LOCKED");
    expect(p.nseReferenceStatus).toBe("NOT_LOADED");
  });

  it("not loaded + warehouse authorized → warehousePopulationStatus=AUTHORIZED (lock independent of ref)", () => {
    const p = buildClassifierProvenance(NOT_LOADED_META, {
      warehousePopulationAuthorized: true,
      evaluationAuthorized: false,
    });
    expect(p.warehousePopulationStatus).toBe("AUTHORIZED");
    expect(p.evaluationStatus).toBe("LOCKED");
    // Reference state remains NOT_LOADED — independent of lock state
    expect(p.nseReferenceStatus).toBe("NOT_LOADED");
    expect(p.authoritativeNseReferenceIntegrated).toBe(false);
  });

  it("loaded + warehouse locked → warehousePopulationStatus=LOCKED, nseReferenceStatus=LOADED_AND_INTEGRATED", () => {
    const p = buildClassifierProvenance(LOADED_META, {
      warehousePopulationAuthorized: false,
      evaluationAuthorized: true,
    });
    expect(p.warehousePopulationStatus).toBe("LOCKED");
    expect(p.evaluationStatus).toBe("AUTHORIZED");
    expect(p.nseReferenceStatus).toBe("LOADED_AND_INTEGRATED");
    // The reference IS integrated even though warehouse is locked
    expect(p.authoritativeNseReferenceIntegrated).toBe(true);
  });
});

// ── INVARIANT I5: not-loaded always → CANARY_BLOCKED_REFERENCE_NOT_LOADED ───

describe("I5: not-loaded reference always produces REFERENCE_NOT_LOADED canary status", () => {
  const lockCombinations = [
    { warehousePopulationAuthorized: false, evaluationAuthorized: false },
    { warehousePopulationAuthorized: true,  evaluationAuthorized: false },
    { warehousePopulationAuthorized: false, evaluationAuthorized: true  },
    { warehousePopulationAuthorized: true,  evaluationAuthorized: true  },
  ];
  for (const locks of lockCombinations) {
    it(`not loaded + warehouse=${locks.warehousePopulationAuthorized} eval=${locks.evaluationAuthorized} → REFERENCE_NOT_LOADED`, () => {
      const p = buildClassifierProvenance(NOT_LOADED_META, locks);
      expect(p.canaryStatus).toBe("CANARY_BLOCKED_REFERENCE_NOT_LOADED");
      expect(p.nseReferenceStatus).toBe("NOT_LOADED");
      expect(p.authoritativeNseReferenceIntegrated).toBe(false);
      // Type must reflect provisional state
      expect(p.type).toBe("PROVISIONAL_KITE_MASTER_PLUS_SUFFIX");
    });
  }
});

// ── Full contract shape when reference IS integrated (current production state) ──

describe("Production-state contract: reference integrated, both locks locked", () => {
  it("matches the intended post-fix production contract", () => {
    const p = buildClassifierProvenance(LOADED_META, {
      warehousePopulationAuthorized: false,
      evaluationAuthorized: false,
    });
    // Reference dimension
    expect(p.authoritativeNseReferenceIntegrated).toBe(true);
    expect(p.nseReferenceStatus).toBe("LOADED_AND_INTEGRATED");
    expect(p.type).toBe("NSE_EQUITY_L_REFERENCE_JOINED");
    expect(p.status).toBe("ELIGIBILITY_CLASSIFIER_AUTHORITATIVE_NSE_REFERENCE");
    // Lock dimensions (independent)
    expect(p.warehousePopulationStatus).toBe("LOCKED");
    expect(p.evaluationStatus).toBe("LOCKED");
    // Canary: most-specific blocker is warehouse (not reference, not eval)
    expect(p.canaryStatus).toBe("CANARY_BLOCKED_WAREHOUSE_POPULATION_LOCKED");
    // Source metadata preserved
    expect(p.nseReferenceSource?.sourceHash).toBe("abc123def456");
    expect(p.nseReferenceSource?.totalRecords).toBe(12345);
    expect(p.nseReferenceSource?.snapshotDate).toBe("2026-08-10");
    // Must NOT claim reference is still required
    expect(p.canaryStatus).not.toBe("CANARY_BLOCKED_REFERENCE_NOT_LOADED");
  });
});

// ── CRITICAL: lock values alone can NEVER produce CANARY_PASS or CANARY_FAILED ──

describe("Authorization locks alone can never produce CANARY_PASS or CANARY_FAILED", () => {
  const allCombinations = [
    { loaded: false, warehousePopulationAuthorized: false, evaluationAuthorized: false },
    { loaded: false, warehousePopulationAuthorized: true,  evaluationAuthorized: false },
    { loaded: false, warehousePopulationAuthorized: false, evaluationAuthorized: true  },
    { loaded: false, warehousePopulationAuthorized: true,  evaluationAuthorized: true  },
    { loaded: true,  warehousePopulationAuthorized: false, evaluationAuthorized: false },
    { loaded: true,  warehousePopulationAuthorized: true,  evaluationAuthorized: false },
    { loaded: true,  warehousePopulationAuthorized: false, evaluationAuthorized: true  },
    { loaded: true,  warehousePopulationAuthorized: true,  evaluationAuthorized: true  },
  ];

  for (const { loaded, warehousePopulationAuthorized, evaluationAuthorized } of allCombinations) {
    const label = `loaded=${loaded} W=${warehousePopulationAuthorized} E=${evaluationAuthorized}`;

    it(`${label} → canaryStatus is not CANARY_PASS`, () => {
      const meta = loaded ? LOADED_META : NOT_LOADED_META;
      const p = buildClassifierProvenance(meta, { warehousePopulationAuthorized, evaluationAuthorized });
      expect(p.canaryStatus).not.toBe("CANARY_PASS");
    });

    it(`${label} → canaryStatus is not CANARY_FAILED`, () => {
      const meta = loaded ? LOADED_META : NOT_LOADED_META;
      const p = buildClassifierProvenance(meta, { warehousePopulationAuthorized, evaluationAuthorized });
      expect(p.canaryStatus).not.toBe("CANARY_FAILED");
    });
  }

  it("CANARY_AUTHORIZED_AWAITING_RUNTIME_VALIDATION is the maximum state producible by buildClassifierProvenance", () => {
    // With all prerequisites satisfied (reference integrated, both locks authorized),
    // the function produces AWAITING_RUNTIME_VALIDATION — not PASS.
    // CANARY_PASS requires durable runtime evidence from a completed canary validation.
    const p = buildClassifierProvenance(LOADED_META, {
      warehousePopulationAuthorized: true,
      evaluationAuthorized: true,
    });
    expect(p.canaryStatus).toBe("CANARY_AUTHORIZED_AWAITING_RUNTIME_VALIDATION");
  });
});
