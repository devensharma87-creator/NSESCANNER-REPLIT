/**
 * PHASE 0.8A — SIDE-EFFECT AND SAFETY GATES (8 targeted tests)
 *
 * The admission layer is allowed to DESCRIBE a live feed and nothing more. These
 * tests read the shipped source of the Phase 0.8A files and the diagnostic route
 * and hold them to that: no WebSocket, no ticker, no provider call, no database
 * write, no timer, no secret in the payload, no public contract change.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildSubscriptionAdmissionManifest,
  type SubscriptionAdmissionManifest,
} from "./subscriptionManifest";
import { planFeedShards } from "./feedShardPlan";
import { evaluateFeedOwnershipAdmission } from "./feedOwnershipAdmission";
import { evaluateActivationGates, KITE_SESSION_GATE_STATE } from "./feedActivationGates";
import { buildUniverseManifest, REQUIRED_SOURCE_IDS } from "./universeManifest";
import { MIN_RECORDS_FOR_COMMIT } from "./manifestStore";
import {
  makeLiveRecords,
  makeBuildResult,
  makeAcceptedSources,
  makeCurrentAuthoritativeBse,
  makeCalendarCommitment,
  GEN_ID,
  GENERATED_AT,
  EFFECTIVE_DATE,
} from "./p06TestFixtures";

const HERE = resolve(process.cwd(), "src/lib/registry");
const PHASE_FILES = [
  "subscriptionManifest.ts",
  "feedShardPlan.ts",
  "feedOwnershipAdmission.ts",
  "feedActivationGates.ts",
] as const;

function sourceOf(file: string): string {
  return readFileSync(resolve(HERE, file), "utf8");
}

/** Import statements only — comments explain WHY these are absent. */
function importLines(src: string): string[] {
  return src.split(/\r?\n/).filter((l) => /^\s*import\s|require\(/.test(l));
}

const BUILD_MS = Date.parse(GENERATED_AT);
const SAME_DAY_MS = BUILD_MS + 600_000;

function admissionManifest(nowMs = SAME_DAY_MS): SubscriptionAdmissionManifest {
  const records = makeLiveRecords(MIN_RECORDS_FOR_COMMIT);
  const manifest = buildUniverseManifest({
    build: makeBuildResult(records),
    sources: makeAcceptedSources(),
    manifestVersion: 1,
    registryGenerationId: GEN_ID,
    generatedAt: GENERATED_AT,
    effectiveDate: EFFECTIVE_DATE,
    requiredSourceIds: REQUIRED_SOURCE_IDS,
    bseAuthority: makeCurrentAuthoritativeBse(),
    tradingCalendar: makeCalendarCommitment(),
  });
  return buildSubscriptionAdmissionManifest({
    generation: { manifest, records },
    nowMs,
    restorationSettled: true,
  });
}

describe("P08A P1-P4 — no feed, no provider, no store, no inference", () => {
  it("P1 no Phase 0.8A module reaches a WebSocket, a ticker or the provider SDK", () => {
    for (const file of PHASE_FILES) {
      const imports = importLines(sourceOf(file)).join("\n");
      for (const forbidden of ["kiteconnect", "KiteTicker", '"ws"', "websocket", "socket.io", "axios"]) {
        expect(imports.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
      // And no call sites either, comments aside.
      const code = sourceOf(file)
        .split(/\r?\n/)
        .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
        .join("\n");
      for (const forbidden of ["new KiteTicker", ".subscribe(", ".unsubscribe(", "new WebSocket"]) {
        expect(code).not.toContain(forbidden);
      }
    }
  });

  it("P2 no Phase 0.8A module touches the database or issues DDL/DML", () => {
    for (const file of PHASE_FILES) {
      const src = sourceOf(file);
      const imports = importLines(src).join("\n");
      for (const forbidden of ["drizzle", '"pg"', "/db", "postgres"]) {
        expect(imports.toLowerCase()).not.toContain(forbidden.toLowerCase());
      }
      const code = src
        .split(/\r?\n/)
        .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
        .join("\n")
        .toUpperCase();
      for (const forbidden of ["INSERT INTO", "UPDATE ", "DELETE FROM", "CREATE TABLE", "ALTER TABLE"]) {
        expect(code).not.toContain(forbidden);
      }
    }
  });

  it("P3 importing these modules schedules no timer and starts no background work", () => {
    for (const file of PHASE_FILES) {
      const code = sourceOf(file)
        .split(/\r?\n/)
        .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
        .join("\n");
      for (const forbidden of ["setInterval(", "setTimeout(", "fetch(", "setImmediate("]) {
        expect(code).not.toContain(forbidden);
      }
    }
  });

  it("P4 classification reads accepted registry fields, never a symbol pattern or instrument_type", () => {
    const src = sourceOf("subscriptionManifest.ts");
    const code = src
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join("\n");
    expect(code).not.toContain("instrument_type");
    expect(code).not.toContain("instrumentType");
    // No regex or substring probing of a trading symbol to infer a class.
    expect(code).not.toMatch(/tradingSymbol\s*\.\s*(match|includes|startsWith|endsWith|test)/);
    expect(code).not.toMatch(/normalizedTradingSymbol\s*\.\s*(match|includes|startsWith|endsWith)/);
    expect(code).not.toContain("-SG");
    expect(code).not.toContain("INF0");
  });
});

describe("P08A P5-P8 — locks, route safety, gate honesty, purity", () => {
  it("P5 the four owner safety locks are still false", () => {
    const candle = readFileSync(resolve(process.cwd(), "src/lib/candleEvaluationControl.ts"), "utf8");
    const v2 = readFileSync(resolve(process.cwd(), "src/lib/v2PaperLocks.ts"), "utf8");
    expect(candle).toContain("export const FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED = false as boolean;");
    expect(candle).toContain("export const SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED = false as boolean;");
    expect(v2).toContain("export const FNO_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean;");
    expect(v2).toContain("export const SWING_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean;");
    expect(`${candle}${v2}`).not.toContain("= true as boolean");
  });

  it("P6 the diagnostic surface is owner-only and adds no public contract", () => {
    const route = readFileSync(resolve(process.cwd(), "src/routes/dataHealth.ts"), "utf8");
    const line = route
      .split(/\r?\n/)
      .find((l) => l.includes('"/data-health/subscription-admission"'));
    expect(line).toBeDefined();
    expect(line).toContain("requireOwnerStrict");
    // Only the two pre-existing surfaces are public; nothing new was added to them.
    const publicRoutes = route
      .split(/\r?\n/)
      .filter((l) => l.includes("router.get(") && !l.includes("requireOwnerStrict"));
    expect(publicRoutes).toHaveLength(2);
    expect(publicRoutes.join("\n")).toContain("/data-health/market");
    expect(publicRoutes.join("\n")).toContain("/data-health/global");
  });

  it("P7 the diagnostic payload carries counts and hashes, never payloads or credentials", () => {
    const route = readFileSync(resolve(process.cwd(), "src/routes/dataHealth.ts"), "utf8");
    const section = route.slice(route.indexOf("subscription-admission"));
    // Metadata only: the admitted identity/token list is never serialized.
    expect(section).toContain("admittedCount: manifest.admitted.length");
    expect(section).not.toMatch(/admitted:\s*manifest\.admitted/);
    expect(section).not.toMatch(/identities:\s*s\.identities/);
    expect(section).not.toMatch(/tokens:\s*s\.tokens/);
    for (const forbidden of ["process.env.KITE", "accessToken", "apiKey", "api_secret", "SESSION_SECRET"]) {
      expect(section).not.toContain(forbidden);
    }
  });

  it("P8 the whole admission chain is pure, and the Kite session is NOT_EVALUATED by name", () => {
    const first = admissionManifest();
    const second = admissionManifest();
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));

    const plan = planFeedShards(first);
    const ownership = evaluateFeedOwnershipAdmission({
      declaredDeploymentTarget: "autoscale",
      isDeployment: true,
      declaredReplicaCount: null,
    });
    const gates = evaluateActivationGates({ manifest: first, plan, ownership });

    // Every gate is named; NOT_EVALUATED never counts as PASS.
    const kite = gates.gates.find((g) => g.id === "KITE_SESSION_VALID");
    expect(kite?.state).toBe("NOT_EVALUATED");
    expect(kite?.detail).toBe(KITE_SESSION_GATE_STATE);
    expect(gates.allGatesPass).toBe(false);
    expect(gates.activationAuthorized).toBe(false);
    expect(gates.blockingGateIds).toEqual(
      expect.arrayContaining([
        "FEED_OWNERSHIP_SINGLE_WRITER_ADMITTED",
        "KITE_SESSION_VALID",
        "OWNER_ACTIVATION_AUTHORIZATION",
      ]),
    );
    // Even with a perfectly current universe, activation stays closed.
    expect(first.state).toBe("ACTIVATABLE_CURRENT");
    expect(gates.gates.filter((g) => g.state === "PASS").length).toBeGreaterThanOrEqual(7);

    // The manifest is frozen: a consumer cannot mutate the admission verdict.
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => {
      (first as unknown as { activationAuthorized: boolean }).activationAuthorized = true;
    }).toThrow();
  });
});
