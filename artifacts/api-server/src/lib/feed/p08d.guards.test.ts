/**
 * PHASE 0.8D — STRUCTURAL GUARDS
 *
 * These tests assert facts about the SOURCE TREE, not about runtime behaviour.
 * Everything here is a claim the phase makes in prose ("disabled", "no route",
 * "no scheduler", "test-only") that would otherwise be enforced by nothing but
 * reviewer attention. A behavioural test cannot catch a future edit that adds
 * an execution route; a grep can.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/** This guard file, excluded from scans that would otherwise be self-satisfying. */
const SELF = __filename;

const SRC = join(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

const ALL_TS = walk(SRC);
const isTestFile = (p: string) => /\.test\.ts$/.test(p) || p.includes("/test-infra/");
const PRODUCTION_TS = ALL_TS.filter((p) => !isTestFile(p));

const read = (p: string) => readFileSync(p, "utf8");
const rel = (p: string) => relative(SRC, p);

/**
 * Strip comments and string literals so a scan sees EXECUTABLE CODE only.
 *
 * Without this, these guards would fail on their own documentation: the Kite
 * adapter's header explains why `KiteConnect.getProfile()` is the approved
 * operation, and a naive substring scan reads that sentence as an SDK usage.
 * Weakening the assertion to accommodate the prose would have been the wrong
 * repair — it would also stop catching a real `new KiteConnect(...)`. Removing
 * the non-code text keeps the check strict where it matters.
 */
function codeOnly(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    // String literals are PRESERVED, not blanked: a hardcoded URL or an SDK
    // import specifier lives inside a string, and those are exactly the
    // findings these guards exist to catch. We only walk them so that a `//`
    // inside a string cannot be mistaken for the start of a comment.
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      out += c;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\") {
          out += src[i]!;
          i++;
        }
        if (i < n) {
          out += src[i]!;
          i++;
        }
      }
      out += quote;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

describe("Phase 0.8D — G1: both authorization constants are declared false", () => {
  it("declares AUTHORITATIVE_REGISTRY_REFRESH_AUTHORIZED = false", () => {
    const src = read(join(SRC, "lib", "registry", "registryRefreshControl.ts"));
    expect(src).toMatch(
      /export const AUTHORITATIVE_REGISTRY_REFRESH_AUTHORIZED = false as boolean;/,
    );
    expect(src).not.toMatch(/AUTHORITATIVE_REGISTRY_REFRESH_AUTHORIZED\s*=\s*true/);
  });

  it("declares KITE_SESSION_VALIDATION_AUTHORIZED = false", () => {
    const src = read(join(SRC, "lib", "feed", "kiteSessionValidationControl.ts"));
    expect(src).toMatch(/export const KITE_SESSION_VALIDATION_AUTHORIZED = false as boolean;/);
    expect(src).not.toMatch(/KITE_SESSION_VALIDATION_AUTHORIZED\s*=\s*true/);
  });

  it("leaves the five pre-existing runtime locks untouched at false", async () => {
    const { FEED_RUNTIME_ACTIVATION_AUTHORIZED } = await import("./feedManager");
    const {
      FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED,
      SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED,
    } = await import("../candleEvaluationControl");
    const { FNO_PAPER_V2_RUNTIME_AUTHORIZED, SWING_PAPER_V2_RUNTIME_AUTHORIZED } = await import(
      "../v2PaperLocks"
    );
    expect(FEED_RUNTIME_ACTIVATION_AUTHORIZED).toBe(false);
    expect(FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED).toBe(false);
    expect(SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED).toBe(false);
    expect(FNO_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false);
    expect(SWING_PAPER_V2_RUNTIME_AUTHORIZED).toBe(false);
  });
});

describe("Phase 0.8D — G2: neither operation is reachable over HTTP", () => {
  const ROUTES = ALL_TS.filter((p) => p.includes("/routes/") && !isTestFile(p));

  it("has route files to inspect (guard is not vacuous)", () => {
    expect(ROUTES.length).toBeGreaterThan(10);
  });

  it("no route imports or invokes either service factory", () => {
    const forbidden = [
      "createRegistryRefreshService",
      "runRefreshNow",
      "createKiteSessionValidator",
      "validateNow",
      "registryRefreshOrchestrator",
      "kiteSessionValidationAdapter",
    ];
    const offenders: string[] = [];
    for (const file of ROUTES) {
      const src = read(file);
      for (const token of forbidden) {
        if (src.includes(token)) offenders.push(`${rel(file)} :: ${token}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no route writes either authorization constant", () => {
    const offenders: string[] = [];
    for (const file of ROUTES) {
      const src = read(file);
      if (
        src.includes("AUTHORITATIVE_REGISTRY_REFRESH_AUTHORIZED") ||
        src.includes("KITE_SESSION_VALIDATION_AUTHORIZED")
      ) {
        offenders.push(rel(file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no route accepts a caller-supplied validation record", () => {
    const offenders: string[] = [];
    for (const file of ROUTES) {
      if (read(file).includes("acceptKiteSessionValidationRecord")) offenders.push(rel(file));
    }
    expect(offenders).toEqual([]);
  });
});

describe("Phase 0.8D — G3: no scheduler, timer or boot wiring", () => {
  const NEW_MODULES = [
    join(SRC, "lib", "registry", "registryRefreshOrchestrator.ts"),
    join(SRC, "lib", "registry", "registryRefreshControl.ts"),
    join(SRC, "lib", "feed", "kiteSessionValidationAdapter.ts"),
    join(SRC, "lib", "feed", "kiteSessionValidationControl.ts"),
    join(SRC, "lib", "operationalSingleFlight.ts"),
  ];

  it("the new modules allocate no timer and register no scheduler", () => {
    const offenders: string[] = [];
    for (const file of NEW_MODULES) {
      const src = codeOnly(read(file));
      for (const token of ["setInterval", "setTimeout", "cron", "node-schedule", "setImmediate"]) {
        if (src.includes(token)) offenders.push(`${rel(file)} :: ${token}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no production module calls either operation at import time or from boot", () => {
    const offenders: string[] = [];
    for (const file of PRODUCTION_TS) {
      const src = read(file);
      if (src.includes(".runRefreshNow()") || src.includes(".validateNow()")) {
        offenders.push(rel(file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("index.ts and app.ts do not reference either operation", () => {
    for (const name of ["index.ts", "app.ts"]) {
      const src = read(join(SRC, name));
      expect(src).not.toContain("registryRefreshOrchestrator");
      expect(src).not.toContain("kiteSessionValidationAdapter");
    }
  });
});

describe("Phase 0.8D — G4: test-only overrides have zero production callers", () => {
  const OVERRIDES = [
    "__TEST_ONLY_createAuthorizedRegistryRefreshService",
    "__TEST_ONLY_createAuthorizedKiteSessionValidator",
  ];

  it("each override is referenced only by its defining module and test files", () => {
    const definingModules = new Set([
      join(SRC, "lib", "registry", "registryRefreshOrchestrator.ts"),
      join(SRC, "lib", "feed", "kiteSessionValidationAdapter.ts"),
    ]);
    const offenders: string[] = [];
    for (const file of PRODUCTION_TS) {
      if (definingModules.has(file)) continue;
      const src = read(file);
      for (const token of OVERRIDES) {
        if (src.includes(token)) offenders.push(`${rel(file)} :: ${token}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * This file lists both factory names in OVERRIDES above, so a scan that
   * includes THIS file proves only that this file exists. Excluding it is what
   * makes the structural check mean "some behavioral suite uses them".
   */
  it("the overrides are exercised by a behavioral suite, not merely named here", () => {
    const testFiles = ALL_TS.filter(
      (p) => /\.test\.ts$/.test(p) && resolve(p) !== resolve(SELF),
    );
    expect(testFiles.length).toBeGreaterThan(0);
    for (const token of OVERRIDES) {
      const users = testFiles.filter((f) => read(f).includes(token));
      expect(users.length, `${token} is never exercised by a behavioral suite`).toBeGreaterThan(0);
    }
  });

  /**
   * The structural check above can still only see text. These two cases run the
   * factories, because the property that actually matters is that the override
   * CHANGES the authorization outcome — a factory that returned the same
   * disabled service would satisfy every grep in this file.
   */
  it("the registry override really bypasses the authorization gate, and the default really does not", async () => {
    const mod = await import("../registry/registryRefreshOrchestrator");
    // Ports that fail immediately: the only thing under test is which gate is
    // reached first, so nothing here needs to succeed.
    const ports = {
      clock: { nowMs: () => 1 },
      sourceFetch: {
        fetchSource: async () => {
          throw new Error("inert");
        },
      },
      sourceValidation: {
        validate: () => ({ sourceId: "X", accepted: false, rowCount: 0, rejectionCode: "INERT" }),
      },
      calendar: { buildAndResolveLatestCompletedSession: async () => ({ ok: false }) },
      bseAuthority: { evaluate: async () => ({ authorized: false }) },
      generationBuilder: { buildAndReconcile: async () => ({ ok: false }) },
      persistence: { save: async () => ({ ok: false }) },
      coldLoadVerifier: { loadAndVerify: async () => ({ ok: false }) },
      authorityPromotion: { promote: async () => ({ promoted: false }) },
      audit: { record: () => {} },
    } as never;

    const disabled = await mod.createRegistryRefreshService(ports).runRefreshNow();
    expect(disabled.stage).toBe("AUTHORIZATION");

    const overridden = await mod
      .__TEST_ONLY_createAuthorizedRegistryRefreshService(ports)
      .runRefreshNow();
    // Past AUTHORIZATION and stopped by the inert port instead.
    expect(overridden.stage).not.toBe("AUTHORIZATION");
    expect(overridden.stage).toBe("SOURCE_RETRIEVAL");
  });

  it("the Kite override really bypasses the authorization gate, and the default really does not", async () => {
    const mod = await import("./kiteSessionValidationAdapter");
    const ports = {
      clock: { nowMs: () => 1 },
      material: { readSessionDescriptor: async () => null },
      provider: {
        probeProfile: async () => {
          throw new Error("must not be reached");
        },
      },
      audit: { record: () => {} },
    } as never;

    const disabled = await mod.createKiteSessionValidator(ports).validateNow();
    expect(disabled.reasonCode).toBe(mod.KITE_VALIDATION_REASON.NOT_AUTHORIZED);

    const overridden = await mod
      .__TEST_ONLY_createAuthorizedKiteSessionValidator(ports)
      .validateNow();
    expect(overridden.reasonCode).toBe(mod.KITE_VALIDATION_REASON.CREDENTIALS_UNAVAILABLE);
    expect(overridden.reasonCode).not.toBe(mod.KITE_VALIDATION_REASON.NOT_AUTHORIZED);
    // Reaching the credential gate without contacting the provider is the
    // whole point: the override changes authorization, nothing else.
    expect(overridden.providerCalled).toBe(false);
  });
});

describe("Phase 0.8D — G5: no real provider, download or DB path was introduced", () => {
  it("the new modules contain no network client, fetch or SDK import", () => {
    const files = [
      join(SRC, "lib", "registry", "registryRefreshOrchestrator.ts"),
      join(SRC, "lib", "feed", "kiteSessionValidationAdapter.ts"),
      join(SRC, "lib", "operationalSingleFlight.ts"),
    ];
    const offenders: string[] = [];
    for (const file of files) {
      const src = codeOnly(read(file));
      for (const token of [
        "fetch(",
        "axios",
        "https://",
        "http://",
        "kiteconnect",
        "KiteConnect",
        "drizzle",
        "WebSocket",
        "KiteTicker",
        "pg_advisory",
      ]) {
        if (src.includes(token)) offenders.push(`${rel(file)} :: ${token}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the orchestrator reaches the database only through the injected persistence port", () => {
    const src = read(join(SRC, "lib", "registry", "registryRefreshOrchestrator.ts"));
    // It may import the persistence RESULT TYPE, but must not import the
    // executing function: a type import cannot write to a table.
    expect(src).toMatch(
      /import type \{ RegistryGeneration, RegistryPersistenceResult \} from "\.\/manifestStore";/,
    );
    expect(src).not.toMatch(/^import \{[^}]*saveRegistryGeneration/m);
    expect(src).toContain("ports.persistence.save(");
  });

  it("the Kite adapter never names a credential field", () => {
    const src = codeOnly(read(join(SRC, "lib", "feed", "kiteSessionValidationAdapter.ts")));
    for (const token of [
      "access_token",
      "accessToken",
      "api_secret",
      "apiSecret",
      "request_token",
      "requestToken",
      "public_token",
      "KITE_API_KEY",
      "KITE_API_SECRET",
      "KITE_TOKEN_ENC_KEY",
    ]) {
      expect(src).not.toContain(token);
    }
  });
});
