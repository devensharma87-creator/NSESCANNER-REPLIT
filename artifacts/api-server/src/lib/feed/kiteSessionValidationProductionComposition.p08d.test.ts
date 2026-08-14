/**
 * PHASE 0.8D — KITE SESSION VALIDATION PRODUCTION COMPOSITION
 *
 * The SDK is mocked at its module boundary (`vi.mock("kiteconnect")`), so the
 * real dynamic import, the real client construction and the real `getProfile()`
 * call path all execute — against a fake broker. No network, no credential, no
 * database.
 *
 * What these tests are actually protecting:
 *   - a refusal must cost nothing (no secret read, no SDK load, no probe),
 *   - exactly ONE provider operation is reachable, and it is `getProfile()`,
 *   - the access token never leaves the provider port,
 *   - an unresolvable expected account fails CLOSED rather than falling back to
 *     the session's own user id, which would make the check tautological.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger } from "../logger";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// ── SDK boundary mock ────────────────────────────────────────────────────────

const sdkCalls: string[] = [];
let profileResponse: unknown = { user_id: "AB1234", email: "owner@example.com" };
let profileError: unknown = null;
const constructedWith: Array<Record<string, unknown>> = [];
const tokensSeen: string[] = [];

vi.mock("kiteconnect", () => ({
  KiteConnect: class {
    constructor(opts: Record<string, unknown>) {
      constructedWith.push(opts);
      sdkCalls.push("construct");
    }
    setAccessToken(token: string) {
      tokensSeen.push(token);
      sdkCalls.push("setAccessToken");
    }
    async getProfile() {
      sdkCalls.push("getProfile");
      if (profileError !== null) throw profileError;
      return profileResponse;
    }
    // Present so a test can prove they are never reached.
    async getPositions() {
      sdkCalls.push("getPositions");
      return [];
    }
    async getOrders() {
      sdkCalls.push("getOrders");
      return [];
    }
    async placeOrder() {
      sdkCalls.push("placeOrder");
      return {};
    }
  },
}));

import * as compositionExports from "./kiteSessionValidationProductionComposition";
import {
  KITE_VALIDATION_COMPOSITION_ID,
  KITE_VALIDATION_HTTP_TIMEOUT_MS,
  PRODUCTION_KITE_VALIDATION_DEPS,
  buildProductionKiteValidationPorts,
  classifyKiteProbeError,
  createProductionKiteSessionValidator,
  describeProductionKiteValidationReadiness,
  type ProductionKiteValidationDeps,
} from "./kiteSessionValidationProductionComposition";
import {
  KITE_SESSION_VALIDATION_AUTHORIZED,
  APPROVED_KITE_VALIDATION_OPERATION,
} from "./kiteSessionValidationControl";
import {
  KITE_VALIDATION_REASON,
  __TEST_ONLY_createAuthorizedKiteSessionValidator,
} from "./kiteSessionValidationAdapter";
import { resolveExpectedKiteAccountId } from "./kiteExpectedAccount";
import { getActiveSession } from "../kiteAuth";

const SRC_ROOT = resolve(__dirname, "../..");
const COMPOSITION_FILE = resolve(__dirname, "kiteSessionValidationProductionComposition.ts");

const NOW_MS = Date.UTC(2026, 7, 14, 6, 0, 0);
const EXPIRES_MS = Date.UTC(2026, 7, 15, 0, 30, 0); // next 06:00 IST

const SECRET_TOKEN = "tok_SECRET_MUST_NOT_ESCAPE";

function fakeSession(over: Record<string, unknown> = {}) {
  return {
    apiKey: "key_ABC",
    accessToken: SECRET_TOKEN,
    userId: "AB1234",
    userName: "Owner",
    loginTime: new Date(NOW_MS),
    expiresAt: new Date(EXPIRES_MS),
    ...over,
  };
}

function makeDeps(over: Partial<ProductionKiteValidationDeps> = {}): ProductionKiteValidationDeps {
  return {
    loadSessionModule: (async () => ({ getActiveSession: async () => fakeSession() })) as any,
    resolveExpectedAccount: (() => ({ ok: true, expectedUserId: "AB1234" })) as any,
    loadSdk: PRODUCTION_KITE_VALIDATION_DEPS.loadSdk,
    ...over,
  };
}

/**
 * Authorized composition, assembled HERE rather than in the production module:
 * the REAL production ports over a mocked SDK, handed to the adapter's own
 * test-only authorized factory.
 *
 * Doing the last step in the test file is what lets the production module hold
 * no reference to an authorization bypass at all — see K3.
 */
function authorizedValidator(deps: ProductionKiteValidationDeps) {
  return __TEST_ONLY_createAuthorizedKiteSessionValidator(
    buildProductionKiteValidationPorts(deps),
  );
}

function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && n === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      out += c;
      i++;
      while (i < src.length) {
        if (src[i] === "\\") {
          out += src[i]! + (src[i + 1] ?? "");
          i += 2;
          continue;
        }
        out += src[i];
        if (src[i] === q) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function allSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) allSourceFiles(p, acc);
    else if (p.endsWith(".ts")) acc.push(p);
  }
  return acc;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("P08D Kite session validation production composition", () => {
  beforeEach(() => {
    sdkCalls.length = 0;
    constructedWith.length = 0;
    tokensSeen.length = 0;
    profileResponse = { user_id: "AB1234", email: "owner@example.com" };
    profileError = null;
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 1. inert while unauthorized ────────────────────────────────────────
  describe("K1 unauthorized refusal reaches no secret and no SDK", () => {
    it("K1.1 the production validator refuses without contacting the provider", async () => {
      const result = await createProductionKiteSessionValidator().validateNow();
      expect(result.outcome).toBe("NOT_EVALUATED");
      expect(result.reasonCode).toBe(KITE_VALIDATION_REASON.NOT_AUTHORIZED);
      expect(result.providerCalled).toBe(false);
      expect(result.evidenceRecorded).toBe(false);
      expect(result.evidenceInvalidated).toBe(false);
      expect(sdkCalls).toEqual([]);
    });

    it("K1.2 refusal reads no session material and resolves no expected account", async () => {
      const touched: string[] = [];
      const ports = buildProductionKiteValidationPorts({
        loadSessionModule: (async () => {
          touched.push("loadSessionModule");
          throw new Error("FORBIDDEN");
        }) as any,
        resolveExpectedAccount: (() => {
          touched.push("resolveExpectedAccount");
          throw new Error("FORBIDDEN");
        }) as any,
        loadSdk: async () => {
          touched.push("loadSdk");
          throw new Error("FORBIDDEN");
        },
      });
      // Building the ports object must itself be inert.
      expect(touched).toEqual([]);
      expect(ports.clock).toBeDefined();
    });

    it("K1.3 readiness is DISABLED, pure, and leaks no secret value", () => {
      const r = describeProductionKiteValidationReadiness();
      expect(r.state).toBe("DISABLED");
      expect(r.authorized).toBe(false);
      expect(r.executionRouteExposed).toBe(false);
      expect(r.schedulerRegistered).toBe(false);
      expect(r.compositionId).toBe(KITE_VALIDATION_COMPOSITION_ID);
      expect(r.approvedOperation).toBe(APPROVED_KITE_VALIDATION_OPERATION);
      expect(r.blockers).toContain("KITE_SESSION_VALIDATION_NOT_AUTHORIZED");
      expect(Object.isFrozen(r)).toBe(true);

      // Presence booleans only — never a value.
      expect(typeof r.credentialsConfigured).toBe("boolean");
      expect(typeof r.expectedAccountConfigured).toBe("boolean");
      expect(JSON.stringify(r)).not.toContain(SECRET_TOKEN);
      expect(sdkCalls).toEqual([]);
    });
  });

  // ── 2. no override on the production factory ───────────────────────────
  it("K2 the production factory accepts no arguments", () => {
    expect(createProductionKiteSessionValidator.length).toBe(0);
  });

  // ── 3. no production module can reach an authorization bypass ──────────
  it("K3 the composition module holds NO reference to any authorized factory", () => {
    // Stronger than 'the test-only export has no production callers': the
    // export does not exist, so there is nothing in production to call.
    // Comments are stripped: the module DOCUMENTS why it holds no bypass, and
    // that prose must not be what satisfies the check.
    const src = stripComments(readFileSync(COMPOSITION_FILE, "utf8"));
    expect(src).not.toContain("__TEST_ONLY_createAuthorizedKiteSessionValidator");
    expect(src).not.toContain("__TEST_ONLY_");
    expect(Object.keys(compositionExports)).not.toContain(
      "__TEST_ONLY_createAuthorizedProductionKiteSessionValidator",
    );

    // And the invariant holds across every production file, not just this one.
    const offenders = allSourceFiles(SRC_ROOT)
      .filter((f) => !f.endsWith(".test.ts"))
      .filter((f) => f !== resolve(__dirname, "kiteSessionValidationAdapter.ts"))
      .filter((f) =>
        readFileSync(f, "utf8").includes("__TEST_ONLY_createAuthorizedKiteSessionValidator"),
      );
    expect(offenders).toEqual([]);
  });

  // ── 4. identity binding ────────────────────────────────────────────────
  it("K4 dependencies bind to the accepted secret-owning readers by identity", async () => {
    // The session reader is reached through a LOADER, not a static binding, so
    // identity is asserted on the resolved module (see K4b for why).
    const mod = await PRODUCTION_KITE_VALIDATION_DEPS.loadSessionModule();
    expect(mod.getActiveSession).toBe(getActiveSession);
    expect(PRODUCTION_KITE_VALIDATION_DEPS.resolveExpectedAccount).toBe(resolveExpectedKiteAccountId);
    expect(Object.isFrozen(PRODUCTION_KITE_VALIDATION_DEPS)).toBe(true);
  });

  it("K4b importing the composition does NOT pull the broker SDK into the static graph", () => {
    // `kiteAuth` statically imports `kiteconnect`. Binding it statically here
    // would make merely loading this module a broker-SDK load — before any
    // authorization check. Only a DYNAMIC import is permitted, so the SDK must
    // not appear anywhere in the transitive STATIC import graph.
    const staticImports = (src: string): string[] =>
      [...stripComments(src).matchAll(/(?:^|\n)\s*import\s+(?![^;]*\btype\b)[^;]*?from\s*["']([^"']+)["']/g)].map(
        (m) => m[1]!,
      );

    const seen = new Set<string>();
    const queue = [COMPOSITION_FILE];
    const sdkImporters: string[] = [];

    while (queue.length > 0) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const src = readFileSync(file, "utf8");
      for (const spec of staticImports(src)) {
        if (spec === "kiteconnect") {
          sdkImporters.push(file);
          continue;
        }
        if (!spec.startsWith(".")) continue;
        const base = resolve(join(file, ".."), spec.replace(/\.js$/, ""));
        for (const cand of [`${base}.ts`, join(base, "index.ts")]) {
          if (existsSync(cand)) {
            queue.push(cand);
            break;
          }
        }
      }
    }

    expect(sdkImporters).toEqual([]);
    // Non-vacuity: the walk must actually have traversed a real graph.
    expect(seen.size).toBeGreaterThan(3);
    // And the module kiteAuth (the SDK importer) must not be in it.
    expect([...seen].filter((f) => f.endsWith("kiteAuth.ts"))).toEqual([]);
  });

  // ── 5. exactly one provider operation: getProfile ──────────────────────
  describe("K5 the only reachable provider operation is getProfile()", () => {
    it("K5.1 a successful validation calls getProfile exactly once and nothing else", async () => {
      const result = await authorizedValidator(
        makeDeps(),
      ).validateNow();

      expect(result.outcome).toBe("VALID");
      expect(result.providerCalled).toBe(true);
      expect(sdkCalls).toEqual(["construct", "setAccessToken", "getProfile"]);
      expect(sdkCalls.filter((c) => c === "getProfile")).toHaveLength(1);
      for (const forbidden of ["getPositions", "getOrders", "placeOrder"]) {
        expect(sdkCalls).not.toContain(forbidden);
      }
    });

    it("K5.2 the client is constructed with the accepted bounded timeout", async () => {
      await authorizedValidator(makeDeps()).validateNow();
      expect(constructedWith).toHaveLength(1);
      expect(constructedWith[0]!.timeout).toBe(KITE_VALIDATION_HTTP_TIMEOUT_MS);
      // An unbounded client would hang until the OS reset the socket, and the
      // timeout would then be misclassified as a network failure.
      expect(constructedWith[0]!.timeout).toBeGreaterThan(0);
    });

    it("K5.3 the source imports the SDK dynamically and calls no other operation", () => {
      const src = stripComments(readFileSync(COMPOSITION_FILE, "utf8"));
      // A static import would load the SDK before any authorization check.
      expect(src).not.toMatch(/^\s*import\s.*from\s+["']kiteconnect["']/m);
      expect(src).toContain('await import("kiteconnect")');
      expect(src).toContain("client.getProfile()");
      for (const forbidden of [
        "placeOrder",
        "getPositions",
        "getOrders",
        "getHoldings",
        "getMargins",
        "cancelOrder",
        "KiteTicker",
      ]) {
        expect(src).not.toContain(forbidden);
      }
    });
  });

  // ── 6. the token never escapes the provider port ───────────────────────
  describe("K6 the access token stays inside the provider boundary", () => {
    it("K6.1 the descriptor carries expiry and expected account — never a token", async () => {
      const ports = buildProductionKiteValidationPorts(makeDeps());
      const descriptor = await ports.material.readSessionDescriptor();
      expect(descriptor).not.toBeNull();
      expect(descriptor!.expectedUserId).toBe("AB1234");
      expect(descriptor!.sessionExpiresAtMs).toBe(EXPIRES_MS);
      expect(JSON.stringify(descriptor)).not.toContain(SECRET_TOKEN);
      expect(Object.keys(descriptor!)).toEqual(["expectedUserId", "sessionExpiresAtMs"]);
      // Reading the descriptor must not contact the provider.
      expect(sdkCalls).toEqual([]);
    });

    it("K6.2 the token reaches the SDK and appears nowhere in the result", async () => {
      const result = await authorizedValidator(
        makeDeps(),
      ).validateNow();
      expect(tokensSeen).toEqual([SECRET_TOKEN]);
      expect(JSON.stringify(result)).not.toContain(SECRET_TOKEN);
      for (const detail of result.detailsSafeForOwnerDiagnostics) {
        expect(detail).not.toContain(SECRET_TOKEN);
        expect(detail).not.toContain("key_ABC");
      }
    });

    it("K6.3 the profile body is reduced to user_id — email and the rest are dropped", async () => {
      profileResponse = {
        user_id: "AB1234",
        email: "owner@example.com",
        phone: "+911234567890",
        broker: "ZERODHA",
      };
      const ports = buildProductionKiteValidationPorts(makeDeps());
      const outcome = await ports.provider.probeProfile();
      expect(outcome).toEqual({ kind: "PROFILE", userId: "AB1234" });
      expect(JSON.stringify(outcome)).not.toContain("owner@example.com");
      expect(JSON.stringify(outcome)).not.toContain("911234567890");
    });
  });

  // ── 7. expected-account gate fails closed ──────────────────────────────
  describe("K7 an unresolvable expected account fails CLOSED", () => {
    it("K7.1 no configured expectation refuses before the provider is contacted", async () => {
      const result = await authorizedValidator(
        makeDeps({
          resolveExpectedAccount: (() => ({
            ok: false,
            reasonCode: "EXPECTED_KITE_ACCOUNT_NOT_CONFIGURED",
          })) as any,
        }),
      ).validateNow();

      expect(result.outcome).not.toBe("VALID");
      expect(result.reasonCode).toBe(KITE_VALIDATION_REASON.MATERIAL_READ_FAILED);
      expect(result.providerCalled).toBe(false);
      expect(result.evidenceRecorded).toBe(false);
      expect(sdkCalls).toEqual([]);
    });

    it("K7.2 the expectation is NEVER defaulted to the session's own user id", () => {
      const src = stripComments(readFileSync(COMPOSITION_FILE, "utf8"));
      // Comparing getProfile().user_id against the id the provider itself wrote
      // at login is tautological — it cannot catch a token bound to the wrong
      // account, which is the only case worth checking.
      expect(src).not.toMatch(/expectedUserId:\s*session\./);
      expect(src).not.toMatch(/\?\?\s*session\.userId/);
      expect(src).toContain("expected.expectedUserId");
    });

    it("K7.3 a mismatched account is INVALID, not VALID", async () => {
      profileResponse = { user_id: "ZZ9999" };
      const result = await authorizedValidator(
        makeDeps(),
      ).validateNow();
      expect(result.outcome).toBe("INVALID");
      expect(result.providerCalled).toBe(true);
    });

    it("K7.4 no stored session yields a null descriptor, not a fabricated one", async () => {
      const ports = buildProductionKiteValidationPorts(
        makeDeps({ loadSessionModule: (async () => ({ getActiveSession: async () => null })) as any }),
      );
      expect(await ports.material.readSessionDescriptor()).toBeNull();
      expect(sdkCalls).toEqual([]);
    });

    it("K7.5 a session that vanishes between read and probe is a transport failure, not a rejection", async () => {
      const ports = buildProductionKiteValidationPorts(
        makeDeps({ loadSessionModule: (async () => ({ getActiveSession: async () => null })) as any }),
      );
      const outcome = await ports.provider.probeProfile();
      // Nothing was rejected, so there is no evidence against the token.
      expect(outcome).toEqual({ kind: "TRANSPORT_FAILURE", classification: "NETWORK" });
      expect(sdkCalls).toEqual([]);
    });

    it("K7.6 a throwing audit sink cannot turn a decided validation into a rejection", async () => {
      // The adapter calls `audit.record` WITHOUT a catch, so a logger that
      // throws would reject validateNow() after the outcome was already known.
      const spy = vi.spyOn(logger, "info").mockImplementation(() => {
        throw new Error("LOGGER_DOWN");
      });
      try {
        const ports = buildProductionKiteValidationPorts(makeDeps());
        expect(() =>
          ports.audit.record({
            operation: "KITE_SESSION_VALIDATION",
            outcome: "VALID",
            reasonCode: null,
            providerCalled: true,
            atMs: NOW_MS,
          } as any),
        ).not.toThrow();
        expect(spy).toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  });

  // ── 8. error classification ────────────────────────────────────────────
  describe("K8 provider errors are classified, never leaked", () => {
    it("K8.1 auth rejections are distinguished from transport failures", () => {
      expect(classifyKiteProbeError({ error_type: "TokenException" })).toEqual({
        kind: "AUTH_REJECTED",
      });
      expect(classifyKiteProbeError({ status: 403 })).toEqual({ kind: "AUTH_REJECTED" });
      expect(classifyKiteProbeError({ status: 429 })).toEqual({
        kind: "TRANSPORT_FAILURE",
        classification: "RATE_LIMITED",
      });
      expect(classifyKiteProbeError({ status: 503 })).toEqual({
        kind: "TRANSPORT_FAILURE",
        classification: "SERVER_ERROR",
      });
      expect(classifyKiteProbeError({ code: "ECONNABORTED" })).toEqual({
        kind: "TRANSPORT_FAILURE",
        classification: "TIMEOUT",
      });
    });

    it("K8.2 an UNRECOGNISED error is a transport failure, never an auth rejection", () => {
      // Guessing "the token is bad" from an unclassified fault would revoke
      // valid evidence on a transient blip.
      expect(classifyKiteProbeError(new Error("something odd"))).toEqual({
        kind: "TRANSPORT_FAILURE",
        classification: "NETWORK",
      });
      expect(classifyKiteProbeError(null)).toEqual({
        kind: "TRANSPORT_FAILURE",
        classification: "NETWORK",
      });
    });

    it("K8.3 an error carrying the request config does not leak it", async () => {
      profileError = Object.assign(new Error("Request failed"), {
        status: 500,
        config: { url: `https://api.kite.trade/user/profile?access_token=${SECRET_TOKEN}` },
      });
      const result = await authorizedValidator(
        makeDeps(),
      ).validateNow();
      expect(result.outcome).toBe("PROVIDER_UNAVAILABLE");
      expect(JSON.stringify(result)).not.toContain(SECRET_TOKEN);
    });
  });

  // ── 9. no execution surface, no module-scope work ──────────────────────
  it("K9 no route, scheduler, boot path or timer reaches the composition", () => {
    const importers = allSourceFiles(SRC_ROOT)
      .filter((f) => !f.endsWith(".test.ts") && f !== COMPOSITION_FILE)
      .filter((f) =>
        readFileSync(f, "utf8").includes("kiteSessionValidationProductionComposition"),
      );
    expect(importers).toEqual([]);

    const src = stripComments(readFileSync(COMPOSITION_FILE, "utf8"));
    for (const forbidden of [
      "setInterval",
      "setTimeout",
      "cron",
      "app.get(",
      "app.post(",
      "router.",
      ".listen(",
      "process.on(",
    ]) {
      expect(src).not.toContain(forbidden);
    }

    const moduleScopeLines = src
      .split("\n")
      .filter((l) => l.length > 0 && !/^\s/.test(l) && !l.startsWith("}"));
    for (const line of moduleScopeLines) {
      expect(line).not.toMatch(/^await\b/);
      expect(line).not.toMatch(/^\(async/);
      // A top-level `void import("kiteconnect")` would load the SDK on import
      // while still satisfying the "dynamic import" check in K5.3.
      expect(line).not.toMatch(/^void\s/);
    }
  });

  // ── 10. authorization lock false ───────────────────────────────────────
  it("K10 the governing authorization lock is false in the shipped source", () => {
    expect(KITE_SESSION_VALIDATION_AUTHORIZED).toBe(false);
    const controlSrc = readFileSync(resolve(__dirname, "kiteSessionValidationControl.ts"), "utf8");
    expect(controlSrc).toMatch(
      /KITE_SESSION_VALIDATION_AUTHORIZED\s*(?::[^=]+)?=\s*false/,
    );
  });
});
