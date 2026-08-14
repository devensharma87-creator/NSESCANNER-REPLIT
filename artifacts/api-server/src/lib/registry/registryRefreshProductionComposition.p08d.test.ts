/**
 * PHASE 0.8D — REGISTRY REFRESH PRODUCTION COMPOSITION
 *
 * Proves the composition is bound to the ACCEPTED pipeline and that it stays
 * inert while unauthorized.
 *
 * The dependency seam is injected, never the ports: every test drives the real
 * `buildProductionRegistryRefreshPorts` wiring, so the ordering, data threading
 * and failure mapping under test are the ones production uses. The six official
 * source parsers are NOT injected — they run for real against synthetic bodies
 * sized to their accepted row floors.
 *
 * No network, no database, no SDK, no timer.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import * as compositionExports from "./registryRefreshProductionComposition";
import {
  PRODUCTION_REGISTRY_REFRESH_DEPS,
  REGISTRY_REFRESH_COMPOSITION_ID,
  buildProductionRegistryRefreshPorts,
  createProductionRegistryRefreshService,
  describeProductionRegistryRefreshReadiness,
  nextIstMidnightMs,
  type ProductionRegistryRefreshDeps,
} from "./registryRefreshProductionComposition";
import {
  REGISTRY_REFRESH_REASON,
  REQUIRED_REFRESH_SOURCE_IDS,
  __TEST_ONLY_createAuthorizedRegistryRefreshService,
  __resetRegistryRefreshDiagnosticsForTests,
  createRegistryRefreshService,
  getRegistryRefreshOperationDiagnostics,
} from "./registryRefreshOrchestrator";
import { AUTHORITATIVE_REGISTRY_REFRESH_AUTHORIZED } from "./registryRefreshControl";
import { SOURCE_ROW_FLOORS, SOURCE_URLS, type OfficialSourceId } from "./officialSources";
import { boundedFetchBytes } from "./boundedSourceRetrieval";
import { buildRegistry } from "./instrumentRegistry";
import { buildUniverseManifest } from "./universeManifest";
import {
  getActiveGeneration,
  loadLatestAcceptedGeneration,
  saveRegistryGeneration,
} from "./manifestStore";
import { toAuthoritativeCoverageManifest } from "./coverageBridge";
import { evaluateBseReferenceAuthority } from "./bseReferencePolicy";
import {
  buildExchangeCalendar,
  evaluateCalendarAuthorityNow,
  getLatestCompletedTradingSession,
  toCalendarCommitment,
  toTradingCalendarVerdict,
  validateBhavcopySession,
} from "./exchangeCalendar";
import {
  BSE_EQUITY_SESSION_TIMINGS_PAGE,
  BSE_TRADING_HOLIDAYS_URL,
  NSE_HOLIDAY_MASTER_URL,
  NSE_MARKET_TIMINGS_URL,
  bseUdiffUrlFor,
  parseBseSessionTimings,
  parseBseTradingHolidayPage,
  parseBseUdiff,
  parseNseHolidayMaster,
  parseNseMarketTimings,
} from "./exchangeCalendarSources";

const SRC_ROOT = resolve(__dirname, "../..");
const COMPOSITION_FILE = resolve(__dirname, "registryRefreshProductionComposition.ts");

const NOW_MS = Date.UTC(2026, 7, 14, 6, 0, 0); // 2026-08-14 11:30 IST
const SESSION_DATE = "2026-08-13";

// ── synthetic official-source bodies ────────────────────────────────────────
// Sized to the ACCEPTED row floors so the real parsers return ACCEPTED
// provenance. Below a floor they would be REJECTED_BELOW_FLOOR, which is a
// different test.

function nseEquityCsv(n: number, prefix: string): string {
  const out = ["SYMBOL,NAME OF COMPANY,SERIES,DATE OF LISTING,ISIN NUMBER,FACE VALUE"];
  for (let i = 0; i < n; i++) {
    out.push(`${prefix}${i},${prefix} Ltd ${i},EQ,01-JAN-2020,INE${String(i).padStart(6, "0")}1,10`);
  }
  return `${out.join("\n")}\n`;
}

function nseEtfCsv(n: number): string {
  const out = ["SYMBOL,UNDERLYING,SECURITY NAME,ISIN NUMBER"];
  for (let i = 0; i < n; i++) {
    out.push(`ETF${i},NIFTY 50,ETF Scheme ${i},INF${String(i).padStart(6, "0")}1`);
  }
  return `${out.join("\n")}\n`;
}

function bseScripsJson(n: number, status: "Active" | "Suspended"): string {
  const rows = [];
  for (let i = 0; i < n; i++) {
    rows.push({
      SCRIP_CD: String(500000 + i),
      scrip_id: `BSESYM${i}`,
      Scrip_Name: `BSE Company ${i}`,
      GROUP: "A",
      Segment: "Equity",
      ISIN_NUMBER: `INE${String(i).padStart(6, "0")}1`,
      Status: status,
    });
  }
  return JSON.stringify(rows);
}

function kiteInstrumentCsv(n: number): string {
  const out = [
    "instrument_token,exchange_token,tradingsymbol,name,last_price,expiry,strike,tick_size,lot_size,instrument_type,segment,exchange",
  ];
  for (let i = 0; i < n; i++) {
    out.push(`${100000 + i},${i + 1},SYM${i},Name ${i},0,,0,0.05,1,EQ,NSE,NSE`);
  }
  return `${out.join("\n")}\n`;
}

const SOURCE_BODIES: Readonly<Record<OfficialSourceId, string>> = {
  NSE_EQUITY_L: nseEquityCsv(SOURCE_ROW_FLOORS.NSE_EQUITY_L, "NSEEQ"),
  NSE_SME_EQUITY_L: nseEquityCsv(SOURCE_ROW_FLOORS.NSE_SME_EQUITY_L, "SME"),
  NSE_ETF_LIST: nseEtfCsv(SOURCE_ROW_FLOORS.NSE_ETF_LIST),
  BSE_LIST_OF_SCRIPS_ACTIVE: bseScripsJson(SOURCE_ROW_FLOORS.BSE_LIST_OF_SCRIPS_ACTIVE, "Active"),
  BSE_LIST_OF_SCRIPS_SUSPENDED: bseScripsJson(
    SOURCE_ROW_FLOORS.BSE_LIST_OF_SCRIPS_SUSPENDED,
    "Suspended",
  ),
  KITE_INSTRUMENT_MASTER: kiteInstrumentCsv(SOURCE_ROW_FLOORS.KITE_INSTRUMENT_MASTER),
};

const URL_BODIES = new Map<string, string>([
  ...REQUIRED_REFRESH_SOURCE_IDS.map(
    (id) => [SOURCE_URLS[id], SOURCE_BODIES[id]] as [string, string],
  ),
  [NSE_HOLIDAY_MASTER_URL, "{}"],
  // PHASE 0.8E: BSE serves an application SHELL; the authoritative artefact is
  // the bundle it references. These fakes satisfy the retrieval contract so
  // this test keeps exercising ORDERING rather than re-testing retrieval.
  [BSE_TRADING_HOLIDAYS_URL, `<html><script src="/static/main.abc.js"></script></html>`],
  [
    "https://www.bseindia.com/static/main.abc.js",
    `/* Display table for Trading Holidays for 2026 - Equity Segment */${"a".repeat(1024 * 1024)}`,
  ],
  [NSE_MARKET_TIMINGS_URL, `<html><body>${"t".repeat(32 * 1024)}</body></html>`],
  [BSE_EQUITY_SESSION_TIMINGS_PAGE, "<html></html>"],
  [bseUdiffUrlFor(SESSION_DATE), "udiff"],
]);

// ── fake dependency seam ─────────────────────────────────────────────────────

function fakeGeneration(id: string): any {
  return {
    manifest: { registryGenerationId: id, acceptanceStatus: "ACCEPTED", generatedAt: "2026-08-14" },
    records: [{ authoritativeSecurityId: "NSE:EQ:AAA", firstSeenAt: "2026-01-01" }],
  };
}

function makeFakeDeps(
  log: string[],
  over: Partial<ProductionRegistryRefreshDeps> = {},
): ProductionRegistryRefreshDeps {
  const calendar: any = { calendarGenerationId: "CAL-FAKE-1", valid: true };
  let committedId = "";

  const base: ProductionRegistryRefreshDeps = {
    fetchBytes: (async (req: { url: string }) => {
      const body = URL_BODIES.get(req.url);
      log.push(`FETCH:${req.url}`);
      if (body === undefined) {
        return { ok: false, requestedUrl: req.url, reasonCode: "HOST_NOT_APPROVED" };
      }
      const bytes = Buffer.from(body, "latin1");
      return {
        ok: true,
        requestedUrl: req.url,
        finalUrl: req.url,
        bytes,
        byteLength: bytes.length,
        rawByteSha256: "raw",
        contentType: "text/csv",
        retrievedAtMs: NOW_MS,
      };
    }) as any,

    parseNseHolidayMaster: ((..._a: unknown[]) => {
      log.push("PARSE_NSE_HOLIDAYS");
      return {} as any;
    }) as any,
    parseBseTradingHolidayPage: ((..._a: unknown[]) => {
      log.push("PARSE_BSE_HOLIDAYS");
      return {} as any;
    }) as any,
    parseNseMarketTimings: ((..._a: unknown[]) => {
      log.push("PARSE_NSE_TIMINGS");
      return {} as any;
    }) as any,
    parseBseSessionTimings: ((..._a: unknown[]) => {
      log.push("PARSE_BSE_TIMINGS");
      return {} as any;
    }) as any,
    parseBseUdiff: ((..._a: unknown[]) => {
      log.push("PARSE_UDIFF");
      return { descriptor: { tradingDate: SESSION_DATE } } as any;
    }) as any,

    buildExchangeCalendar: ((..._a: unknown[]) => {
      log.push("BUILD_CALENDAR");
      return calendar;
    }) as any,
    getLatestCompletedTradingSession: ((..._a: unknown[]) => {
      log.push("LATEST_COMPLETED_SESSION");
      return { ok: true, session: { tradingDate: SESSION_DATE } } as any;
    }) as any,
    toCalendarCommitment: ((..._a: unknown[]) => ({ commitment: true }) as any) as any,
    evaluateCalendarAuthorityNow: ((..._a: unknown[]) =>
      ({ validUntilMs: NOW_MS + 86_400_000 }) as any) as any,
    toTradingCalendarVerdict: ((..._a: unknown[]) => ({ verdict: true }) as any) as any,
    validateBhavcopySession: ((..._a: unknown[]) => {
      log.push("VALIDATE_BHAVCOPY_SESSION");
      return { ok: true } as any;
    }) as any,

    evaluateBseReferenceAuthority: ((..._a: unknown[]) => {
      log.push("BSE_AUTHORITY");
      return { mayAuthorizeNewGeneration: true, state: "CURRENT_AUTHORITATIVE" } as any;
    }) as any,

    buildRegistry: ((input: any) => {
      log.push("BUILD_REGISTRY");
      committedId = input.registryGenerationId;
      return {
        ok: true,
        nse: { ok: true, remainder: 0 },
        bse: { ok: true, remainder: 0 },
        records: [{ authoritativeSecurityId: "NSE:EQ:AAA", firstSeenAt: "2026-01-01" }],
        indexRecords: [],
      } as any;
    }) as any,

    buildUniverseManifest: ((input: any) => {
      log.push("BUILD_MANIFEST");
      return { registryGenerationId: input.registryGenerationId, acceptanceStatus: "ACCEPTED" } as any;
    }) as any,

    saveRegistryGeneration: (async (gen: any) => {
      log.push("SAVE");
      return {
        ok: true,
        durablyCommitted: true,
        durableStore: "POSTGRESQL",
        snapshotId: gen.manifest.registryGenerationId,
        committedAt: "2026-08-14T06:00:00.000Z",
      } as any;
    }) as any,

    loadLatestAcceptedGeneration: (async (reason: string) => {
      log.push(`LOAD:${reason}`);
      if (reason === "PRIOR_FIRST_SEEN_CARRY_FORWARD") return null;
      return fakeGeneration(committedId);
    }) as any,

    getActiveGeneration: (() => {
      log.push("GET_ACTIVE");
      return fakeGeneration(committedId);
    }) as any,

    toAuthoritativeCoverageManifest: ((..._a: unknown[]) => {
      log.push("COVERAGE");
      return { coverageAuthority: "AUTHORITATIVE_RECONCILED_UNIVERSE" } as any;
    }) as any,
  };

  return { ...base, ...over };
}

/**
 * Authorized composition, assembled HERE rather than in the production module:
 * the REAL production ports over fake deps, handed to the orchestrator's own
 * test-only authorized factory.
 *
 * Doing the last step in the test file is what lets the production module hold
 * no reference to an authorization bypass at all — see C3.
 */
function authorizedService(deps: ProductionRegistryRefreshDeps) {
  return __TEST_ONLY_createAuthorizedRegistryRefreshService(
    buildProductionRegistryRefreshPorts(deps),
  );
}

/** Every dep replaced by a spy that fails the test if it is ever reached. */
function makeForbiddenDeps(): { deps: ProductionRegistryRefreshDeps; touched: string[] } {
  const touched: string[] = [];
  const trap = (name: string) =>
    ((..._a: unknown[]) => {
      touched.push(name);
      throw new Error(`FORBIDDEN_DEPENDENCY_CALLED:${name}`);
    }) as any;
  const deps = Object.fromEntries(
    Object.keys(PRODUCTION_REGISTRY_REFRESH_DEPS).map((k) => [k, trap(k)]),
  ) as unknown as ProductionRegistryRefreshDeps;
  return { deps, touched };
}

// ── source-scan helper ───────────────────────────────────────────────────────

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

describe("P08D registry refresh production composition", () => {
  beforeEach(() => {
    __resetRegistryRefreshDiagnosticsForTests();
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // ── 1. inert while unauthorized ────────────────────────────────────────
  describe("C1 unauthorized refusal reaches no dependency", () => {
    it("C1.1 the production service refuses at the authorization stage", async () => {
      const result = await createProductionRegistryRefreshService().runRefreshNow();
      expect(result.ok).toBe(false);
      expect(result.outcome).toBe("REFUSED");
      expect(result.stage).toBe("AUTHORIZATION");
      expect(result.reasonCode).toBe(REGISTRY_REFRESH_REASON.NOT_AUTHORIZED);
      expect(result.sourcesFetched).toBe(0);
      expect(result.durablyCommitted).toBe(false);
      expect(result.promotedToActiveAuthority).toBe(false);
      expect(result.registryGenerationId).toBeNull();
    });

    it("C1.2 refusal calls ZERO dependencies — no fetch, no store, no build", async () => {
      const { deps, touched } = makeForbiddenDeps();
      const ports = buildProductionRegistryRefreshPorts(deps);
      // Building the ports object must itself be inert.
      expect(touched).toEqual([]);

      const result = await createRegistryRefreshService(ports).runRefreshNow();
      expect(result.outcome).toBe("REFUSED");
      expect(touched).toEqual([]);
    });

    it("C1.3 no global fetch is issued while unauthorized", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      await createProductionRegistryRefreshService().runRefreshNow();
      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it("C1.4 readiness is DISABLED and pure — describing does not run anything", async () => {
      const r = describeProductionRegistryRefreshReadiness();
      expect(r.state).toBe("DISABLED");
      expect(r.authorized).toBe(false);
      expect(r.executionRouteExposed).toBe(false);
      expect(r.schedulerRegistered).toBe(false);
      expect(r.blockers).toContain("AUTHORITATIVE_REGISTRY_REFRESH_NOT_AUTHORIZED");
      expect(r.compositionId).toBe(REGISTRY_REFRESH_COMPOSITION_ID);
      expect(Object.isFrozen(r)).toBe(true);

      const diag = getRegistryRefreshOperationDiagnostics();
      expect(diag.state).toBe("DISABLED");
    });
  });

  // ── 2. no override on the production factory ───────────────────────────
  it("C2 the production factory accepts no arguments", () => {
    expect(createProductionRegistryRefreshService.length).toBe(0);
    // A caller passing ports anyway cannot influence the composition.
    const forced = (createProductionRegistryRefreshService as unknown as (p: unknown) => unknown)({
      clock: { nowMs: () => 0 },
    });
    expect(forced).toBeDefined();
  });

  // ── 3. no production module can reach an authorization bypass ──────────
  it("C3 the composition module holds NO reference to any authorized factory", () => {
    // Stronger than 'the test-only export has no production callers': the
    // export does not exist, so there is nothing in production to call.
    // Comments are stripped: the module DOCUMENTS why it holds no bypass, and
    // that prose must not be what satisfies the check.
    const src = stripComments(readFileSync(COMPOSITION_FILE, "utf8"));
    expect(src).not.toContain("__TEST_ONLY_createAuthorizedRegistryRefreshService");
    expect(src).not.toContain("__TEST_ONLY_");
    expect(Object.keys(compositionExports)).not.toContain(
      "__TEST_ONLY_createAuthorizedProductionRegistryRefreshService",
    );

    // And the invariant holds across every production file, not just this one.
    const offenders = allSourceFiles(SRC_ROOT)
      .filter((f) => !f.endsWith(".test.ts"))
      .filter((f) => f !== resolve(__dirname, "registryRefreshOrchestrator.ts"))
      .filter((f) =>
        readFileSync(f, "utf8").includes("__TEST_ONLY_createAuthorizedRegistryRefreshService"),
      );
    expect(offenders).toEqual([]);
  });

  // ── 4. identity binding to the accepted pipeline ───────────────────────
  it("C4 every dependency is the ACCEPTED function, by identity", () => {
    const d = PRODUCTION_REGISTRY_REFRESH_DEPS;
    expect(d.fetchBytes).toBe(boundedFetchBytes);
    expect(d.buildRegistry).toBe(buildRegistry);
    expect(d.buildUniverseManifest).toBe(buildUniverseManifest);
    expect(d.evaluateBseReferenceAuthority).toBe(evaluateBseReferenceAuthority);
    expect(d.parseNseHolidayMaster).toBe(parseNseHolidayMaster);
    expect(d.parseBseTradingHolidayPage).toBe(parseBseTradingHolidayPage);
    expect(d.parseNseMarketTimings).toBe(parseNseMarketTimings);
    expect(d.parseBseSessionTimings).toBe(parseBseSessionTimings);
    expect(d.parseBseUdiff).toBe(parseBseUdiff);
    expect(d.buildExchangeCalendar).toBe(buildExchangeCalendar);
    expect(d.getLatestCompletedTradingSession).toBe(getLatestCompletedTradingSession);
    expect(d.toCalendarCommitment).toBe(toCalendarCommitment);
    expect(d.evaluateCalendarAuthorityNow).toBe(evaluateCalendarAuthorityNow);
    expect(d.toTradingCalendarVerdict).toBe(toTradingCalendarVerdict);
    expect(d.validateBhavcopySession).toBe(validateBhavcopySession);
    expect(d.saveRegistryGeneration).toBe(saveRegistryGeneration);
    expect(d.loadLatestAcceptedGeneration).toBe(loadLatestAcceptedGeneration);
    expect(d.getActiveGeneration).toBe(getActiveGeneration);
    expect(d.toAuthoritativeCoverageManifest).toBe(toAuthoritativeCoverageManifest);
    expect(Object.isFrozen(d)).toBe(true);
  });

  it("C4b the commit path is the accepted transactional store and nothing else", () => {
    const src = stripComments(readFileSync(COMPOSITION_FILE, "utf8"));
    // No hand-rolled SQL, no second pool, no direct table write.
    for (const forbidden of ["INSERT INTO", "UPDATE ", "DELETE FROM", "new Pool", "DATABASE_URL"]) {
      expect(src).not.toContain(forbidden);
    }
    expect(src).toContain("deps.saveRegistryGeneration(generation)");
  });

  // ── 6. authorized happy path, exact order ──────────────────────────────
  it("C6 the authorized composition drives the accepted pipeline in order", async () => {
    const log: string[] = [];
    const svc = authorizedService(makeFakeDeps(log));
    const result = await svc.runRefreshNow();

    expect(result.reasonCode).toBe(REGISTRY_REFRESH_REASON.COMMITTED);
    expect(result.ok).toBe(true);
    expect(result.outcome).toBe("COMMITTED");
    expect(result.durablyCommitted).toBe(true);
    expect(result.promotedToActiveAuthority).toBe(true);
    expect(result.sourcesFetched).toBe(REQUIRED_REFRESH_SOURCE_IDS.length);

    // All six official sources were retrieved from their ACCEPTED URLs.
    for (const id of REQUIRED_REFRESH_SOURCE_IDS) {
      expect(log).toContain(`FETCH:${SOURCE_URLS[id]}`);
    }

    const stages = log.filter((l) => !l.startsWith("FETCH:") && !l.startsWith("PARSE_"));
    expect(stages).toEqual([
      "BUILD_CALENDAR",
      "LATEST_COMPLETED_SESSION",
      "VALIDATE_BHAVCOPY_SESSION",
      "LOAD:PRIOR_FIRST_SEEN_CARRY_FORWARD",
      "BSE_AUTHORITY",
      "BUILD_REGISTRY",
      "BSE_AUTHORITY",
      "BUILD_MANIFEST",
      "SAVE",
      "LOAD:PHASE_0_8D_REFRESH_COLD_LOAD_VERIFICATION",
      "GET_ACTIVE",
      "COVERAGE",
    ]);

    // The UDiFF is selected BY the resolved session, never independently.
    expect(log).toContain(`FETCH:${bseUdiffUrlFor(SESSION_DATE)}`);
    // Cold-load verification re-read durably before promotion.
    expect(log.indexOf("LOAD:PHASE_0_8D_REFRESH_COLD_LOAD_VERIFICATION")).toBeGreaterThan(
      log.indexOf("SAVE"),
    );
    expect(log.indexOf("COVERAGE")).toBeGreaterThan(
      log.indexOf("LOAD:PHASE_0_8D_REFRESH_COLD_LOAD_VERIFICATION"),
    );
  });

  it("C6b a rejected source stops the run before any build or write", async () => {
    const log: string[] = [];
    const deps = makeFakeDeps(log, {
      fetchBytes: (async (req: { url: string }) => {
        log.push(`FETCH:${req.url}`);
        if (req.url === SOURCE_URLS.NSE_ETF_LIST) {
          // Real parser, truncated body → below the accepted floor.
          const bytes = Buffer.from(nseEtfCsv(2), "latin1");
          return {
            ok: true,
            requestedUrl: req.url,
            finalUrl: req.url,
            bytes,
            byteLength: bytes.length,
            rawByteSha256: "raw",
            contentType: "text/csv",
            retrievedAtMs: NOW_MS,
          };
        }
        const body = URL_BODIES.get(req.url)!;
        const bytes = Buffer.from(body, "latin1");
        return {
          ok: true,
          requestedUrl: req.url,
          finalUrl: req.url,
          bytes,
          byteLength: bytes.length,
          rawByteSha256: "raw",
          contentType: "text/csv",
          retrievedAtMs: NOW_MS,
        };
      }) as any,
    });

    const result = await authorizedService(
      deps,
    ).runRefreshNow();

    expect(result.ok).toBe(false);
    expect(result.reasonCode).toBe(REGISTRY_REFRESH_REASON.SOURCE_REJECTED);
    expect(result.durablyCommitted).toBe(false);
    expect(log).not.toContain("SAVE");
    expect(log).not.toContain("BUILD_REGISTRY");
    expect(log).not.toContain("COVERAGE");
  });

  it("C6c a durable write failure never promotes authority", async () => {
    const log: string[] = [];
    const deps = makeFakeDeps(log, {
      saveRegistryGeneration: (async () => {
        log.push("SAVE");
        return {
          ok: false,
          durablyCommitted: false,
          reasonCode: "VALIDATION_GATES_FAILED",
          detail: "d",
        } as any;
      }) as any,
    });

    const result = await authorizedService(
      deps,
    ).runRefreshNow();

    expect(result.ok).toBe(false);
    expect(result.durablyCommitted).toBe(false);
    expect(result.promotedToActiveAuthority).toBe(false);
    expect(log).toContain("SAVE");
    expect(log).not.toContain("COVERAGE");
  });

  // ── 7. single-flight guard released on failure ─────────────────────────
  describe("C7 the in-flight guard is released on every exit path", () => {
    it("C7.1 a synchronous throw inside a port releases the guard", async () => {
      const log: string[] = [];
      const deps = makeFakeDeps(log, {
        buildExchangeCalendar: (() => {
          throw new Error("SYNC_BOOM");
        }) as any,
      });
      const svc = authorizedService(deps);

      // The run must RESOLVE with a coded refusal, not reject: the orchestrator
      // guards only the fetch port, so a throwing port would otherwise escape
      // runRefreshNow() as an unhandled rejection.
      const first = await svc.runRefreshNow();
      expect(first.ok).toBe(false);
      expect(first.durablyCommitted).toBe(false);
      expect(log).not.toContain("SAVE");

      // If the guard leaked, this second run would coalesce with a run that
      // already finished — the classic "stuck RUNNING forever" failure.
      const second = await svc.runRefreshNow();
      expect(second.coalescedWithInFlight).toBe(false);
      expect(getRegistryRefreshOperationDiagnostics().state).not.toBe("RUNNING");
    });

    it("C7.2 an async rejection releases the guard", async () => {
      const log: string[] = [];
      const deps = makeFakeDeps(log, {
        saveRegistryGeneration: (async () => {
          throw new Error("ASYNC_BOOM");
        }) as any,
      });
      const svc = authorizedService(deps);

      const first = await svc.runRefreshNow();
      expect(first.ok).toBe(false);
      expect(first.durablyCommitted).toBe(false);
      expect(first.promotedToActiveAuthority).toBe(false);

      const second = await svc.runRefreshNow();
      expect(second.coalescedWithInFlight).toBe(false);
      expect(getRegistryRefreshOperationDiagnostics().state).not.toBe("RUNNING");
    });

    it("C7.2b every non-fetch port maps a throw to a CODED failure, never a rejection", async () => {
      const log: string[] = [];
      const boom = () => {
        throw new Error("PORT_BOOM");
      };

      // persistence
      const persistPorts = buildProductionRegistryRefreshPorts(
        makeFakeDeps(log, { saveRegistryGeneration: boom as any }),
      );
      const saved = await persistPorts.persistence.save({} as any);
      expect(saved.ok).toBe(false);
      expect(saved.durablyCommitted).toBe(false);
      expect(saved.ok === false && saved.reasonCode).toContain("PORT_IMPLEMENTATION_THREW");

      // cold load
      const coldPorts = buildProductionRegistryRefreshPorts(
        makeFakeDeps(log, { loadLatestAcceptedGeneration: boom as any }),
      );
      const cold = await coldPorts.coldLoadVerifier.loadAndVerify({
        expectedGenerationId: "X",
        nowMs: NOW_MS,
      });
      expect(cold.ok).toBe(false);
      expect(cold.reasonCode).toContain("PORT_IMPLEMENTATION_THREW");
      expect(cold.loadedGenerationId).toBeNull();

      // promotion
      const promoPorts = buildProductionRegistryRefreshPorts(
        makeFakeDeps(log, { getActiveGeneration: boom as any }),
      );
      const promo = await promoPorts.authorityPromotion.promote({
        generationId: "X",
        nowMs: NOW_MS,
      });
      expect(promo.promoted).toBe(false);
      expect(promo.reasonCode).toContain("PORT_IMPLEMENTATION_THREW");

      // BSE reference authority + generation builder are run-scoped: they
      // refuse on ORDERING before they ever reach their dep, so they have to be
      // reached through a full run rather than a bare port call.
      for (const depName of ["evaluateBseReferenceAuthority", "buildRegistry"] as const) {
        const runLog: string[] = [];
        const svc = authorizedService(makeFakeDeps(runLog, { [depName]: boom } as any));
        const run = await svc.runRefreshNow();
        expect(run.ok, `${depName} throw must not commit`).toBe(false);
        expect(run.durablyCommitted).toBe(false);
        expect(run.promotedToActiveAuthority).toBe(false);
        expect(runLog).not.toContain("SAVE");
        // The guard must have released, or the next run coalesces forever.
        expect((await svc.runRefreshNow()).coalescedWithInFlight).toBe(false);
        expect(getRegistryRefreshOperationDiagnostics().state).not.toBe("RUNNING");
      }

      // The BSE port also refuses fail-closed if called out of order, before
      // its dep is consulted at all.
      const bsePorts = buildProductionRegistryRefreshPorts(
        makeFakeDeps(log, { evaluateBseReferenceAuthority: boom as any }),
      );
      const bse = await bsePorts.bseAuthority.evaluate({
        nowMs: NOW_MS,
        latestCompletedSessionDate: "2026-08-13",
      });
      expect(bse.authorized).toBe(false);
      expect(bse.reasonCode).toBe("CALENDAR_NOT_RESOLVED_BEFORE_BSE_AUTHORITY");
      expect(bse.authorityExpiresAtMs).toBeNull();

      // source validation — real parser, unparseable body
      const validated = persistPorts.sourceValidation.validate(
        {
          sourceId: "BSE_LIST_OF_SCRIPS_ACTIVE",
          url: SOURCE_URLS.BSE_LIST_OF_SCRIPS_ACTIVE,
          body: "}{ not json at all",
          retrievedAtMs: NOW_MS,
        } as any,
        NOW_MS,
      );
      expect(validated.accepted).toBe(false);
      expect(validated.rejectionCode).not.toBeNull();
    });

    it("C7.2c the coded failure carries the error CLASS only — never its message", async () => {
      const log: string[] = [];
      const ports = buildProductionRegistryRefreshPorts(
        makeFakeDeps(log, {
          saveRegistryGeneration: (() => {
            throw new Error("connect ECONNREFUSED postgres://user:hunter2@db:5432/app");
          }) as any,
        }),
      );
      const saved = await ports.persistence.save({} as any);
      expect(saved.ok).toBe(false);
      const serialized = JSON.stringify(saved);
      expect(serialized).not.toContain("hunter2");
      expect(serialized).not.toContain("postgres://");
      expect(serialized).toContain("PORT_IMPLEMENTATION_THREW:Error");
    });

    it("C7.3 a fetch rejection is mapped, not leaked as a throw", async () => {
      const log: string[] = [];
      const deps = makeFakeDeps(log, {
        fetchBytes: (async () => {
          throw new Error("NETWORK_BOOM");
        }) as any,
      });
      const result = await authorizedService(
        deps,
      ).runRefreshNow();
      expect(result.ok).toBe(false);
      expect(result.reasonCode).toBe(REGISTRY_REFRESH_REASON.FETCH_FAILED);
      expect(result.durablyCommitted).toBe(false);
    });
  });

  // ── 8. no execution surface ────────────────────────────────────────────
  it("C8 no route, scheduler, boot path or timer reaches the composition", () => {
    const importers = allSourceFiles(SRC_ROOT)
      .filter((f) => !f.endsWith(".test.ts") && f !== COMPOSITION_FILE)
      .filter((f) => readFileSync(f, "utf8").includes("registryRefreshProductionComposition"));
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
  });

  // ── 9. no module-scope IO, no credential serialization ─────────────────
  it("C9 the module performs no work at import time and serializes no credential", () => {
    const src = stripComments(readFileSync(COMPOSITION_FILE, "utf8"));

    // Module scope is declarations only: no top-level await, no IIFE.
    const moduleScopeLines = src
      .split("\n")
      .filter((l) => l.length > 0 && !/^\s/.test(l) && !l.startsWith("}"));
    for (const line of moduleScopeLines) {
      expect(line).not.toMatch(/^await\b/);
      expect(line).not.toMatch(/^\(async/);
      expect(line).not.toMatch(/^void\s/);
    }

    // No secret is read or forwarded anywhere in this file.
    for (const forbidden of [
      "process.env",
      "accessToken",
      "access_token",
      "apiKey",
      "api_key",
      "api_secret",
      "SESSION_SECRET",
    ]) {
      expect(src).not.toContain(forbidden);
    }

    // The audit sink emits coded fields only — never a body, row set or URL.
    const auditBlock = src.slice(src.indexOf("audit: {"), src.indexOf("audit: {") + 700);
    for (const forbidden of ["body", "rows", "records", "url"]) {
      expect(auditBlock).not.toContain(forbidden);
    }
  });

  // ── 10. every authorization lock is false ──────────────────────────────
  it("C10 the governing authorization lock is false in the shipped source", () => {
    expect(AUTHORITATIVE_REGISTRY_REFRESH_AUTHORIZED).toBe(false);
    const controlSrc = readFileSync(resolve(__dirname, "registryRefreshControl.ts"), "utf8");
    expect(controlSrc).toMatch(
      /AUTHORITATIVE_REGISTRY_REFRESH_AUTHORIZED\s*(?::[^=]+)?=\s*false/,
    );
  });

  // ── IST boundary ───────────────────────────────────────────────────────
  it("C11 nextIstMidnightMs is the next IST calendar-day boundary, strictly ahead", () => {
    // 2026-08-14 11:30 IST → 2026-08-15 00:00 IST == 2026-08-14 18:30 UTC
    expect(nextIstMidnightMs(NOW_MS)).toBe(Date.UTC(2026, 7, 14, 18, 30, 0));
    expect(nextIstMidnightMs(NOW_MS)).toBeGreaterThan(NOW_MS);

    // Exactly ON the boundary must roll to the NEXT one, never return itself:
    // an expiry equal to now is already expired.
    const boundary = Date.UTC(2026, 7, 14, 18, 30, 0);
    expect(nextIstMidnightMs(boundary)).toBe(boundary + 86_400_000);
  });
});
