/**
 * Phase A0.3 — Index F&O Setup Availability Contract Tests
 *
 * Verifies the authoritative availability contract for the three setups
 * retired/unavailable in the index-F&O context:
 *   - VOLUME_BREAKOUT (always unavailable: zero-volume cash indices)
 *   - MEAN_REVERSION  (always unavailable: session VWAP unavailable)
 *   - TREND_CONTINUATION, no-VWAP branch (retired: conf max 35 < 50 threshold)
 *
 * Scope: computeIndexFnoSetupAvailability — pure function, no network/DB/secrets.
 *
 * Non-regression invariants preserved:
 *   - No threshold changes.
 *   - No mocked detector returns.
 *   - VWAP-available TREND_CONTINUATION is ACTIVE — no entry in the list.
 *   - VWAP_RECLAIM and EMA_PULLBACK are ACTIVE — no entry in the list.
 *   - All non-ACTIVE entries have eligibleForEmission: false.
 *   - All entries have scope: "INDEX_FNO".
 *   - reasonCode values are stable across calls (machine-readable, no prose).
 */

import { describe, it, expect } from "vitest";
import {
  computeIndexFnoSetupAvailability,
  type IndexFnoSetupAvailability,
} from "./optionSignals.js";

// ─────────────────────────────────────────────────────────────────────────────
// §10 Matrix — Authorised reason codes (stable across deploys)
// ─────────────────────────────────────────────────────────────────────────────
const AUTHORISED_REASON_CODES = new Set([
  "INDEX_VOLUME_UNAVAILABLE",
  "SESSION_VWAP_UNAVAILABLE",
  "SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY",
]);

const AUTHORISED_STATUSES = new Set<string>([
  "ACTIVE",
  "UNAVAILABLE_REQUIRED_INPUT",
  "RETIRED_INDEX_FNO_POLICY",
]);

// ─────────────────────────────────────────────────────────────────────────────
// §10.1 — vwapAvailable=false (cash-index structural reality)
// ─────────────────────────────────────────────────────────────────────────────
describe("computeIndexFnoSetupAvailability — vwapAvailable=false (cash-index reality)", () => {
  const entries = computeIndexFnoSetupAvailability(false);

  it("returns exactly 3 entries when vwapAvailable=false", () => {
    expect(entries).toHaveLength(3);
  });

  it("includes VOLUME_BREAKOUT entry", () => {
    const e = entries.find(x => x.setupKey === "VOLUME_BREAKOUT");
    expect(e).toBeDefined();
  });

  it("includes MEAN_REVERSION entry", () => {
    const e = entries.find(x => x.setupKey === "MEAN_REVERSION");
    expect(e).toBeDefined();
  });

  it("includes TREND_CONTINUATION entry when vwapAvailable=false", () => {
    const e = entries.find(x => x.setupKey === "TREND_CONTINUATION");
    expect(e).toBeDefined();
  });

  it("does NOT include an ACTIVE entry — all entries are retired/unavailable", () => {
    const activeEntries = entries.filter(x => x.status === "ACTIVE");
    expect(activeEntries).toHaveLength(0);
  });

  it("does NOT include VWAP_RECLAIM (active setup — no entry)", () => {
    const e = entries.find(x => x.setupKey === "VWAP_RECLAIM");
    expect(e).toBeUndefined();
  });

  it("does NOT include EMA_PULLBACK (active setup — no entry)", () => {
    const e = entries.find(x => x.setupKey === "EMA_PULLBACK");
    expect(e).toBeUndefined();
  });

  it("does NOT include BASELINE_OUTLOOK (active setup — no entry)", () => {
    const e = entries.find(x => x.setupKey === "BASELINE_OUTLOOK");
    expect(e).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10.2 — vwapAvailable=true (hypothetical: VWAP-available index F&O)
// ─────────────────────────────────────────────────────────────────────────────
describe("computeIndexFnoSetupAvailability — vwapAvailable=true (VWAP path active)", () => {
  const entries = computeIndexFnoSetupAvailability(true);

  it("returns exactly 2 entries when vwapAvailable=true", () => {
    expect(entries).toHaveLength(2);
  });

  it("includes VOLUME_BREAKOUT (still unavailable — volume not present when VWAP is)", () => {
    const e = entries.find(x => x.setupKey === "VOLUME_BREAKOUT");
    expect(e).toBeDefined();
  });

  it("includes MEAN_REVERSION (still unavailable — VWAP-available doesn't restore volume profile)", () => {
    const e = entries.find(x => x.setupKey === "MEAN_REVERSION");
    expect(e).toBeDefined();
  });

  it("does NOT include TREND_CONTINUATION when vwapAvailable=true (VWAP path is ACTIVE)", () => {
    const e = entries.find(x => x.setupKey === "TREND_CONTINUATION");
    expect(e).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10.3 — VOLUME_BREAKOUT entry properties (always-unavailable)
// ─────────────────────────────────────────────────────────────────────────────
describe("VOLUME_BREAKOUT availability entry properties", () => {
  const entry = computeIndexFnoSetupAvailability(false).find(
    x => x.setupKey === "VOLUME_BREAKOUT",
  )!;

  it("has status=UNAVAILABLE_REQUIRED_INPUT", () => {
    expect(entry.status).toBe("UNAVAILABLE_REQUIRED_INPUT");
  });

  it("has reasonCode=INDEX_VOLUME_UNAVAILABLE (stable machine-readable code)", () => {
    expect(entry.reasonCode).toBe("INDEX_VOLUME_UNAVAILABLE");
  });

  it("has scope=INDEX_FNO", () => {
    expect(entry.scope).toBe("INDEX_FNO");
  });

  it("has eligibleForEmission=false", () => {
    expect(entry.eligibleForEmission).toBe(false);
  });

  it("has non-empty explanation string", () => {
    expect(entry.explanation).toBeTruthy();
    expect(typeof entry.explanation).toBe("string");
    expect(entry.explanation.length).toBeGreaterThan(10);
  });

  it("has missingInputs array containing 'volumeProfile'", () => {
    expect(Array.isArray(entry.missingInputs)).toBe(true);
    expect(entry.missingInputs).toContain("volumeProfile");
  });

  it("has missingInputs array containing 'lastVol'", () => {
    expect(entry.missingInputs).toContain("lastVol");
  });

  it("has missingInputs array containing 'avgVol20'", () => {
    expect(entry.missingInputs).toContain("avgVol20");
  });

  it("reasonCode is in the authorised set (not prose)", () => {
    expect(AUTHORISED_REASON_CODES.has(entry.reasonCode)).toBe(true);
  });

  it("status is in the authorised set", () => {
    expect(AUTHORISED_STATUSES.has(entry.status)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10.4 — MEAN_REVERSION entry properties (always-unavailable)
// ─────────────────────────────────────────────────────────────────────────────
describe("MEAN_REVERSION availability entry properties", () => {
  const entry = computeIndexFnoSetupAvailability(false).find(
    x => x.setupKey === "MEAN_REVERSION",
  )!;

  it("has status=UNAVAILABLE_REQUIRED_INPUT", () => {
    expect(entry.status).toBe("UNAVAILABLE_REQUIRED_INPUT");
  });

  it("has reasonCode=SESSION_VWAP_UNAVAILABLE (stable machine-readable code)", () => {
    expect(entry.reasonCode).toBe("SESSION_VWAP_UNAVAILABLE");
  });

  it("has scope=INDEX_FNO", () => {
    expect(entry.scope).toBe("INDEX_FNO");
  });

  it("has eligibleForEmission=false", () => {
    expect(entry.eligibleForEmission).toBe(false);
  });

  it("has non-empty explanation string", () => {
    expect(entry.explanation).toBeTruthy();
    expect(typeof entry.explanation).toBe("string");
    expect(entry.explanation.length).toBeGreaterThan(10);
  });

  it("has missingInputs array containing 'sessionVwap'", () => {
    expect(Array.isArray(entry.missingInputs)).toBe(true);
    expect(entry.missingInputs).toContain("sessionVwap");
  });

  it("has missingInputs array containing 'vwapAvailable'", () => {
    expect(entry.missingInputs).toContain("vwapAvailable");
  });

  it("reasonCode is in the authorised set (not prose)", () => {
    expect(AUTHORISED_REASON_CODES.has(entry.reasonCode)).toBe(true);
  });

  it("MEAN_REVERSION entry is consistent across vwapAvailable=false and vwapAvailable=true", () => {
    const entryFalse = computeIndexFnoSetupAvailability(false).find(
      x => x.setupKey === "MEAN_REVERSION",
    )!;
    const entryTrue = computeIndexFnoSetupAvailability(true).find(
      x => x.setupKey === "MEAN_REVERSION",
    )!;
    expect(entryFalse.reasonCode).toBe(entryTrue.reasonCode);
    expect(entryFalse.status).toBe(entryTrue.status);
    expect(entryFalse.eligibleForEmission).toBe(entryTrue.eligibleForEmission);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10.5 — TREND_CONTINUATION (no-VWAP branch) entry properties
// ─────────────────────────────────────────────────────────────────────────────
describe("TREND_CONTINUATION (no-VWAP branch) availability entry properties", () => {
  const entry = computeIndexFnoSetupAvailability(false).find(
    x => x.setupKey === "TREND_CONTINUATION",
  )!;

  it("has status=RETIRED_INDEX_FNO_POLICY", () => {
    expect(entry.status).toBe("RETIRED_INDEX_FNO_POLICY");
  });

  it("has reasonCode=SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY (stable code)", () => {
    expect(entry.reasonCode).toBe("SETUP_RETIRED_UNDER_CURRENT_INDEX_FNO_POLICY");
  });

  it("has scope=INDEX_FNO", () => {
    expect(entry.scope).toBe("INDEX_FNO");
  });

  it("has eligibleForEmission=false", () => {
    expect(entry.eligibleForEmission).toBe(false);
  });

  it("has non-empty explanation that mentions 35 (operational max conf)", () => {
    expect(entry.explanation).toMatch(/35/);
  });

  it("has non-empty explanation that mentions 50 (threshold)", () => {
    expect(entry.explanation).toMatch(/50/);
  });

  it("has missingInputs array containing 'sessionVwap'", () => {
    expect(Array.isArray(entry.missingInputs)).toBe(true);
    expect(entry.missingInputs).toContain("sessionVwap");
  });

  it("reasonCode is in the authorised set (not prose)", () => {
    expect(AUTHORISED_REASON_CODES.has(entry.reasonCode)).toBe(true);
  });

  it("TREND_CONTINUATION absent when vwapAvailable=true (VWAP path is ACTIVE)", () => {
    const trueEntries = computeIndexFnoSetupAvailability(true);
    const tcEntry = trueEntries.find(x => x.setupKey === "TREND_CONTINUATION");
    expect(tcEntry).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10.6 — Shared boundary invariants across all entries
// ─────────────────────────────────────────────────────────────────────────────
describe("Shared boundary invariants — all entries", () => {
  const allEntries = [
    ...computeIndexFnoSetupAvailability(false),
    ...computeIndexFnoSetupAvailability(true),
  ];

  it("every entry has eligibleForEmission=false (no non-ACTIVE entry can emit)", () => {
    for (const e of allEntries) {
      expect(e.eligibleForEmission).toBe(false);
    }
  });

  it("every entry has scope=INDEX_FNO", () => {
    for (const e of allEntries) {
      expect(e.scope).toBe("INDEX_FNO");
    }
  });

  it("every entry has a stable reasonCode (in authorised set)", () => {
    for (const e of allEntries) {
      // If this fails, the setupKey is shown in the test output via the loop
      expect(AUTHORISED_REASON_CODES.has(e.reasonCode)).toBe(true);
    }
  });

  it("every entry has a valid status (in authorised set)", () => {
    for (const e of allEntries) {
      // If this fails, the setupKey is shown in the test output via the loop
      expect(AUTHORISED_STATUSES.has(e.status)).toBe(true);
    }
  });

  it("every entry has a non-empty string explanation", () => {
    for (const e of allEntries) {
      expect(typeof e.explanation).toBe("string");
      expect(e.explanation.length).toBeGreaterThan(20);
    }
  });

  it("every entry has a non-empty missingInputs array", () => {
    for (const e of allEntries) {
      expect(Array.isArray(e.missingInputs)).toBe(true);
      expect(e.missingInputs.length).toBeGreaterThan(0);
    }
  });

  it("every entry has a non-empty setupKey string", () => {
    for (const e of allEntries) {
      expect(typeof e.setupKey).toBe("string");
      expect(e.setupKey.length).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10.7 — Stability: calling twice with same arg returns identical values
// ─────────────────────────────────────────────────────────────────────────────
describe("Stability — deterministic output (pure function contract)", () => {
  it("vwapAvailable=false: two calls return identical setupKey/status/reasonCode", () => {
    const a = computeIndexFnoSetupAvailability(false);
    const b = computeIndexFnoSetupAvailability(false);
    expect(a.map(e => e.setupKey)).toEqual(b.map(e => e.setupKey));
    expect(a.map(e => e.status)).toEqual(b.map(e => e.status));
    expect(a.map(e => e.reasonCode)).toEqual(b.map(e => e.reasonCode));
  });

  it("vwapAvailable=true: two calls return identical setupKey/status/reasonCode", () => {
    const a = computeIndexFnoSetupAvailability(true);
    const b = computeIndexFnoSetupAvailability(true);
    expect(a.map(e => e.setupKey)).toEqual(b.map(e => e.setupKey));
    expect(a.map(e => e.status)).toEqual(b.map(e => e.status));
    expect(a.map(e => e.reasonCode)).toEqual(b.map(e => e.reasonCode));
  });

  it("vwapAvailable=false has 1 more entry than vwapAvailable=true (the TC retirement entry)", () => {
    const falseEntries = computeIndexFnoSetupAvailability(false);
    const trueEntries = computeIndexFnoSetupAvailability(true);
    expect(falseEntries.length - trueEntries.length).toBe(1);
  });

  it("VOLUME_BREAKOUT and MEAN_REVERSION are present in both variants (always structural)", () => {
    const falseEntries = computeIndexFnoSetupAvailability(false);
    const trueEntries = computeIndexFnoSetupAvailability(true);
    for (const key of ["VOLUME_BREAKOUT", "MEAN_REVERSION"]) {
      expect(falseEntries.find(e => e.setupKey === key)).toBeDefined();
      expect(trueEntries.find(e => e.setupKey === key)).toBeDefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §10.8 — A0_2_RESIDUAL_PROPAGATION_GAP_DISCOVERED_IN_A0_3:
//         MEAN_REVERSION never appears with a proxy-available status
// ─────────────────────────────────────────────────────────────────────────────
describe("A0_2_RESIDUAL_PROPAGATION_GAP_DISCOVERED_IN_A0_3 — MEAN_REVERSION cannot be ACTIVE", () => {
  it("MEAN_REVERSION is UNAVAILABLE_REQUIRED_INPUT regardless of vwapAvailable value", () => {
    for (const v of [true, false]) {
      const e = computeIndexFnoSetupAvailability(v).find(
        x => x.setupKey === "MEAN_REVERSION",
      );
      // MEAN_REVERSION must always be present and always unavailable
      expect(e).toBeDefined();
      expect(e!.status).toBe("UNAVAILABLE_REQUIRED_INPUT");
      expect(e!.reasonCode).toBe("SESSION_VWAP_UNAVAILABLE");
      expect(e!.eligibleForEmission).toBe(false);
    }
  });

  it("MEAN_REVERSION explanation does not mention 'proxy' or 'substitute' as a workaround", () => {
    // The guard removes the spot-as-VWAP proxy. The explanation must not imply
    // a proxy is ever used — it is explicitly prohibited.
    const e = computeIndexFnoSetupAvailability(false).find(
      x => x.setupKey === "MEAN_REVERSION",
    )!;
    // 'No proxy is used' is acceptable; what is prohibited is describing a proxy
    // as a valid calculation path. Check it doesn't say proxy IS used.
    const explanation = e.explanation.toLowerCase();
    expect(explanation).not.toMatch(/proxy\s+is\s+used/);
    expect(explanation).not.toMatch(/substituted\s+with\s+spot/);
  });
});
