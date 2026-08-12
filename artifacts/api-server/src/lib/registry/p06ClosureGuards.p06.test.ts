/**
 * PHASE 0.6 CLOSURE — matrix items 12-16.
 *
 * Boundary guards: what the manifest MAY authorize (the coverage denominator),
 * what it must NEVER imply (subscriptions / tick completeness), that the live
 * subscription scope is untouched by this phase, and that the four safety
 * locks are still false.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { makeBuildResult, makeCurrentAuthoritativeBse, makeLiveRecords, GEN_ID, GENERATED_AT, EFFECTIVE_DATE } from "./p06TestFixtures";
import {
  MANIFEST_SCHEMA_VERSION,
  REQUIRED_SOURCE_IDS,
  buildUniverseManifest,
  computeManifestChecksum,
} from "./universeManifest";
import { makeAcceptedSources, makeCalendarCommitment } from "./p06TestFixtures";
import { toAuthoritativeCoverageManifest } from "./coverageBridge";
import { evaluateBseReferenceAuthority, UNKNOWN_TRADING_CALENDAR } from "./bseReferencePolicy";
import type { RegistryGeneration } from "./manifestStore";

/** The fixture calendar's own evaluation instant: 15:00 IST on 2026-08-12. */
const FIXTURE_NOW_MS = Date.parse("2026-08-12T09:30:00.000Z");

function acceptedGeneration(): RegistryGeneration {
  const records = makeLiveRecords(3);
  const manifest = buildUniverseManifest({
    build: makeBuildResult(records),
    sources: makeAcceptedSources(),
    manifestVersion: 1,
    registryGenerationId: GEN_ID,
    generatedAt: GENERATED_AT,
    effectiveDate: EFFECTIVE_DATE,
    requiredSourceIds: REQUIRED_SOURCE_IDS,
    tradingCalendar: makeCalendarCommitment(),
    bseAuthority: makeCurrentAuthoritativeBse(),
  });
  return { manifest, records } as RegistryGeneration;
}

describe("matrix 12 — an accepted manifest may supply the coverage denominator", () => {
  it("yields AUTHORITATIVE_RECONCILED_UNIVERSE with every required identity", () => {
    const g = acceptedGeneration();
    expect(g.manifest.acceptanceStatus).toBe("ACCEPTED");
    const cov = toAuthoritativeCoverageManifest(g, FIXTURE_NOW_MS);
    expect(cov.coverageAuthority).toBe("AUTHORITATIVE_RECONCILED_UNIVERSE");
    expect(cov.requiredInstrumentIds).toHaveLength(3);
    expect(cov.universeReconciliationValid).toBe(true);
  });

  it("carries the BSE authority evidence inside the checksummed manifest", () => {
    const g = acceptedGeneration();
    expect(g.manifest.bseReferenceAuthority.state).toBe("CURRENT_AUTHORITATIVE");
    expect(g.manifest.bseReferenceAuthority.effectiveTradingDate).toBe("2026-08-11");
    // Tampering with the authority block must break the manifest checksum.
    const tampered = {
      ...g.manifest,
      bseReferenceAuthority: { ...g.manifest.bseReferenceAuthority, state: "LAST_KNOWN" as const },
    };
    expect(computeManifestChecksum(tampered)).not.toBe(g.manifest.manifestChecksum);
  });
});

describe("matrix 13 — a missing or invalid manifest keeps coverage non-authoritative", () => {
  it("refuses a null generation", () => {
    expect(toAuthoritativeCoverageManifest(null, FIXTURE_NOW_MS).coverageAuthority).toBe("UNIVERSE_NOT_CONFIGURED");
  });

  it("refuses a manifest REJECTED by the BSE policy", () => {
    // The ONLY difference from the accepted case is BSE authority.
    const records = makeLiveRecords(3);
    const denied = evaluateBseReferenceAuthority({
      nowMs: Date.parse(GENERATED_AT),
      list: { outcome: "RETRIEVAL_FAILED", failureReason: "HTTP 503" },
      udiff: null,
      calendar: UNKNOWN_TRADING_CALENDAR,
      hasPriorAcceptedGeneration: true,
      reconciliationClosed: true,
    });
    const manifest = buildUniverseManifest({
      build: makeBuildResult(records),
      sources: makeAcceptedSources(),
      manifestVersion: 1,
      registryGenerationId: GEN_ID,
      generatedAt: GENERATED_AT,
      effectiveDate: EFFECTIVE_DATE,
      requiredSourceIds: REQUIRED_SOURCE_IDS,
    tradingCalendar: makeCalendarCommitment(),
      bseAuthority: denied,
    });
    expect(manifest.acceptanceStatus).toBe("REJECTED");
    expect(manifest.blockers.join(" ")).toContain("LAST_KNOWN");
    expect(toAuthoritativeCoverageManifest({ manifest, records } as RegistryGeneration, FIXTURE_NOW_MS).coverageAuthority).toBe(
      "UNIVERSE_NOT_CONFIGURED",
    );
  });

  it("refuses a hand-forged authority verdict that was never evaluated", () => {
    // The dangerous case: a structurally perfect object asserting authority.
    const forged = {
      state: "CURRENT_AUTHORITATIVE" as const,
      mayAuthorizeNewGeneration: true,
      effectiveTradingDate: "2026-08-11",
      listRetrievedAt: GENERATED_AT,
      listContentHash: "anything",
      udiffTradingDate: "2026-08-11",
      udiffContentHash: "anything",
      evaluatedIstDate: "2026-08-12",
      calendarKnown: true,
      dayKind: "TRADING_DAY" as const,
      reasons: [],
    };
    const records = makeLiveRecords(3);
    const manifest = buildUniverseManifest({
      build: makeBuildResult(records),
      sources: makeAcceptedSources(),
      manifestVersion: 1,
      registryGenerationId: GEN_ID,
      generatedAt: GENERATED_AT,
      effectiveDate: EFFECTIVE_DATE,
      requiredSourceIds: REQUIRED_SOURCE_IDS,
    tradingCalendar: makeCalendarCommitment(),
      bseAuthority: forged,
    });
    expect(manifest.acceptanceStatus).toBe("REJECTED");
    expect(manifest.blockers.join(" ")).toContain("not produced by evaluateBseReferenceAuthority");
  });

  it("refuses a genuine verdict computed over a DIFFERENT BSE List body", () => {
    // Real policy output, but transplanted from another generation.
    const transplanted = evaluateBseReferenceAuthority({
      nowMs: Date.parse(GENERATED_AT),
      list: {
        outcome: "RETRIEVED",
        retrievedAtMs: Date.parse(GENERATED_AT),
        validationResult: "ACCEPTED",
        contentHash: "hash-of-some-other-list-body",
      },
      udiff: {
        tradingDate: "2026-08-11",
        sessionCompleted: true,
        validationResult: "ACCEPTED",
        contentHash: "udiff",
        retrievedAtMs: Date.parse(GENERATED_AT),
      },
      calendar: { known: true, dayKind: "TRADING_DAY", latestCompletedSessionDate: "2026-08-11" },
      hasPriorAcceptedGeneration: false,
      reconciliationClosed: true,
    });
    expect(transplanted.state).toBe("CURRENT_AUTHORITATIVE");

    const records = makeLiveRecords(3);
    const manifest = buildUniverseManifest({
      build: makeBuildResult(records),
      sources: makeAcceptedSources(),
      manifestVersion: 1,
      registryGenerationId: GEN_ID,
      generatedAt: GENERATED_AT,
      effectiveDate: EFFECTIVE_DATE,
      requiredSourceIds: REQUIRED_SOURCE_IDS,
    tradingCalendar: makeCalendarCommitment(),
      bseAuthority: transplanted,
    });
    expect(manifest.acceptanceStatus).toBe("REJECTED");
    expect(manifest.blockers.join(" ")).toContain("different BSE List of Scrips body");
  });

  it("refuses a STORED manifest whose authority hash no longer binds its provenance", () => {
    // Re-signed so the checksum passes: only the hash binding can catch this.
    const g = acceptedGeneration();
    const edited = {
      ...g.manifest,
      bseReferenceAuthority: { ...g.manifest.bseReferenceAuthority, listContentHash: "swapped" },
    };
    const resigned = { ...edited, manifestChecksum: computeManifestChecksum(edited) };
    expect(
      toAuthoritativeCoverageManifest({ manifest: resigned, records: g.records } as RegistryGeneration, FIXTURE_NOW_MS)
        .coverageAuthority,
    ).toBe("UNIVERSE_NOT_CONFIGURED");
  });

  it("refuses a STORED manifest whose authority was edited to claim authorization", () => {
    const g = acceptedGeneration();
    const denied = evaluateBseReferenceAuthority({
      nowMs: Date.parse(GENERATED_AT),
      list: { outcome: "RETRIEVAL_FAILED", failureReason: "HTTP 503" },
      udiff: null,
      calendar: UNKNOWN_TRADING_CALENDAR,
      hasPriorAcceptedGeneration: true,
      reconciliationClosed: true,
    });
    const edited = { ...g.manifest, bseReferenceAuthority: denied };
    const resigned = { ...edited, manifestChecksum: computeManifestChecksum(edited) };
    expect(
      toAuthoritativeCoverageManifest({ manifest: resigned, records: g.records } as RegistryGeneration, FIXTURE_NOW_MS)
        .coverageAuthority,
    ).toBe("UNIVERSE_NOT_CONFIGURED");
  });

  it("refuses a manifest written under an older schema version", () => {
    const g = acceptedGeneration();
    const old = { ...g.manifest, schemaVersion: MANIFEST_SCHEMA_VERSION - 1 };
    const resigned = { ...old, manifestChecksum: computeManifestChecksum(old) };
    expect(
      toAuthoritativeCoverageManifest({ manifest: resigned, records: g.records } as RegistryGeneration, FIXTURE_NOW_MS)
        .coverageAuthority,
    ).toBe("UNIVERSE_NOT_CONFIGURED");
  });
});

describe("matrix 14 — the manifest never implies subscription or tick completeness", () => {
  it("reports subscriptionRequestedCount 0 even with a full required set", () => {
    const cov = toAuthoritativeCoverageManifest(acceptedGeneration(), FIXTURE_NOW_MS);
    expect(cov.requiredInstrumentIds.length).toBeGreaterThan(0);
    // Authority over the DENOMINATOR only. Zero instruments have been requested
    // from any provider by this phase, so any other value would be an invention.
    expect(cov.subscriptionRequestedCount).toBe(0);
  });

  it("marks every record NOT_CHECKED against a provider", () => {
    for (const r of acceptedGeneration().records) {
      expect(r.validationProviderStatus).toBe("NOT_CHECKED");
    }
  });
});

describe("matrix 15 — live subscription scope is unchanged by Phase 0.6", () => {
  it("keeps the configured equity subscription list at exactly 50 symbols", async () => {
    const { NIFTY50_SYMBOLS } = await import("../watchlistLists");
    expect(NIFTY50_SYMBOLS).toHaveLength(50);
  });

  it("contains no subscribe/ticker call anywhere in the registry", () => {
    // Source-text guard across the whole Phase 0.6 module set: the registry is
    // reference data and must never reach the live feed.
    const files = [
      "bseReferencePolicy.ts",
      "coverageBridge.ts",
      "instrumentRegistry.ts",
      "manifestStore.ts",
      "officialSources.ts",
      "securityClassification.ts",
      "universeManifest.ts",
    ];
    for (const f of files) {
      const src = readFileSync(new URL(`./${f}`, import.meta.url), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(src, `${f} must not touch the live feed`).not.toMatch(
        /\bsubscribe\s*\(|setMode\s*\(|KiteTicker|startTicker/,
      );
    }
  });
});

describe("matrix 16 — the four safety locks remain false", () => {
  const LOCKS: readonly (readonly [string, string])[] = [
    ["../candleEvaluationControl.ts", "FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED"],
    ["../candleEvaluationControl.ts", "SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED"],
    ["../v2PaperLocks.ts", "FNO_PAPER_V2_RUNTIME_AUTHORIZED"],
    ["../v2PaperLocks.ts", "SWING_PAPER_V2_RUNTIME_AUTHORIZED"],
  ];

  it.each(LOCKS)("%s: %s is false", (file, lock) => {
    // readFileSync, not import: these modules have import-time side effects.
    const src = readFileSync(new URL(file, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    const m = new RegExp(`export const ${lock}\\s*=\\s*([^;]+);`).exec(src);
    expect(m, `${lock} not found in ${file}`).not.toBeNull();
    expect(m![1].trim()).toBe("false as boolean");
  });
});
