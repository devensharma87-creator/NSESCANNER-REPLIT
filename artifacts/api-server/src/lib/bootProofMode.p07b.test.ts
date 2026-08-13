/**
 * PHASE 0.7B — DEVELOPMENT-ONLY PROVIDER-FREE BOOT MODE
 *
 * These tests exercise the REAL capability contract and the REAL boot-job
 * scheduler that every staggered subsystem goes through, and they assert the
 * wiring at the REAL call sites by reading the shipped source files. Nothing
 * here re-implements the gate logic: a test that copies the rule it is checking
 * proves only that the copy agrees with itself.
 *
 * Production refusal is proven by spawning the actual server entry point, not
 * by reasoning about it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import {
  BOOT_PROOF_ENV_VAR,
  BOOT_PROOF_FORBIDDEN_CODE,
  BootProofModeForbiddenError,
  assertBootProofModeAllowed,
  getBootCapabilities,
  getSuppressedBootSideEffects,
  isDataFoundationBootProofMode,
  runIfCapable,
  _resetSuppressedBootSideEffectsForTest,
} from "./bootCapabilities";
import { scheduleBootJob, scheduleDbPoolStatsLog } from "./bootScheduler";

const SRC = path.resolve(__dirname, "..");
const read = (rel: string): string => readFileSync(path.join(SRC, rel), "utf8");

/** Strip line and block comments so a gate can never be "proven" by prose. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const PROOF_ON = { [BOOT_PROOF_ENV_VAR]: "1", NODE_ENV: "development" };
const PROOF_OFF = { NODE_ENV: "development" };

describe("P07B mode contract", () => {
  it("T1 the mode is OFF when the variable is unset", () => {
    expect(isDataFoundationBootProofMode(PROOF_OFF)).toBe(false);
    expect(getBootCapabilities(PROOF_OFF)).toEqual({
      providerNetwork: true,
      webSockets: true,
      subscriptions: true,
      marketSchedulers: true,
      ingestors: true,
      outboundNotifications: true,
      registryRestore: true,
      httpListener: true,
    });
  });

  it("T2 the mode is ON only for the exact approved value", () => {
    expect(isDataFoundationBootProofMode({ ...PROOF_OFF, [BOOT_PROOF_ENV_VAR]: "1" })).toBe(true);
    for (const near of ["true", "TRUE", "yes", "on", "0", "", " 1", "1 ", "01", "enabled"]) {
      expect(isDataFoundationBootProofMode({ ...PROOF_OFF, [BOOT_PROOF_ENV_VAR]: near })).toBe(false);
    }
  });

  it("T3 the mode is refused under NODE_ENV=production", () => {
    const prodEnv = { [BOOT_PROOF_ENV_VAR]: "1", NODE_ENV: "production" };
    expect(() => assertBootProofModeAllowed(prodEnv)).toThrow(BootProofModeForbiddenError);
    // Even if the assertion were somehow skipped, no suppression branch can be
    // taken in production: the capability set stays fully permitted.
    expect(isDataFoundationBootProofMode(prodEnv)).toBe(false);
    expect(getBootCapabilities(prodEnv).providerNetwork).toBe(true);
    expect(getBootCapabilities(prodEnv).webSockets).toBe(true);
  });

  it("T3b a production boot WITHOUT the flag is never refused", () => {
    expect(() => assertBootProofModeAllowed({ NODE_ENV: "production" })).not.toThrow();
    expect(() =>
      assertBootProofModeAllowed({ NODE_ENV: "production", [BOOT_PROOF_ENV_VAR]: "0" }),
    ).not.toThrow();
  });

  it("T4 the production refusal happens in the real entry point, before app import", () => {
    const entry = read("index.ts");
    const assertAt = entry.indexOf("assertBootProofModeAllowed(process.env)");
    const appImportAt = entry.indexOf('await import("./app.js")');
    const listenAt = entry.indexOf("app.listen(");
    expect(assertAt).toBeGreaterThan(-1);
    expect(appImportAt).toBeGreaterThan(-1);
    expect(assertAt).toBeLessThan(appImportAt);
    expect(assertAt).toBeLessThan(listenAt);
    // index.ts must not import provider or scheduler modules itself — the
    // ordering above only means something because nothing heavier is loaded.
    const staticImports = [...stripComments(entry).matchAll(/^} from "(.*)";$|^import [^\n]* from "(.*)";$/gm)]
      .map(m => m[1] ?? m[2]);
    expect(staticImports.sort()).toEqual([
      "./lib/bootCapabilities.js",
      "./lib/productionConfigValidator.js",
    ]);
  });

  it("T4b spawning the REAL entry point in production with the flag exits 1 before listening", () => {
    const tsx = path.resolve(SRC, "../node_modules/.bin/tsx");
    const run = spawnSync(tsx, [path.join(SRC, "index.ts")], {
      cwd: path.resolve(SRC, ".."),
      env: {
        PATH: process.env["PATH"] ?? "",
        HOME: process.env["HOME"] ?? "",
        NODE_ENV: "production",
        [BOOT_PROOF_ENV_VAR]: "1",
        // Deliberately no PORT, no SESSION_SECRET, no DATABASE_URL: the refusal
        // must fire before any of those are even looked at.
      },
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(BOOT_PROOF_FORBIDDEN_CODE);
    // Nothing downstream may have run: no config codes, no listener, no logs.
    expect(run.stdout).not.toContain("DATA_FOUNDATION_BOOT_PROOF=1 active");
    expect(run.stderr).not.toContain("PROD_CONFIG_INVALID");
  }, 70_000);
});

describe("P07B capability gate behaviour", () => {
  beforeEach(() => _resetSuppressedBootSideEffectsForTest());
  afterEach(() => _resetSuppressedBootSideEffectsForTest());

  it("T5 runIfCapable runs the side effect when permitted and records nothing", () => {
    const fn = vi.fn(() => "started");
    expect(runIfCapable("subsystem", "providerNetwork", fn, PROOF_OFF)).toBe("started");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(getSuppressedBootSideEffects()).toHaveLength(0);
  });

  it("T5b runIfCapable does not run the side effect in proof mode and records it by name", () => {
    const fn = vi.fn(() => "started");
    expect(runIfCapable("kiteFeedBootstrap", "providerNetwork", fn, PROOF_ON)).toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
    const suppressed = getSuppressedBootSideEffects();
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]?.subsystem).toBe("kiteFeedBootstrap");
    expect(suppressed[0]?.capability).toBe("providerNetwork");
  });

  it("T5c retained capabilities are NOT suppressed in proof mode", () => {
    const caps = getBootCapabilities(PROOF_ON);
    expect(caps.registryRestore).toBe(true);
    expect(caps.httpListener).toBe(true);
    expect(caps.providerNetwork).toBe(false);
    expect(caps.webSockets).toBe(false);
    expect(caps.subscriptions).toBe(false);
    expect(caps.marketSchedulers).toBe(false);
    expect(caps.ingestors).toBe(false);
    expect(caps.outboundNotifications).toBe(false);
  });
});

describe("P07B the real boot-job scheduler", () => {
  const original = process.env[BOOT_PROOF_ENV_VAR];
  beforeEach(() => {
    vi.useFakeTimers();
    _resetSuppressedBootSideEffectsForTest();
  });
  afterEach(() => {
    vi.useRealTimers();
    if (original === undefined) delete process.env[BOOT_PROOF_ENV_VAR];
    else process.env[BOOT_PROOF_ENV_VAR] = original;
  });

  it("T16 default behaviour is unchanged when the flag is absent", async () => {
    delete process.env[BOOT_PROOF_ENV_VAR];
    const fn = vi.fn();
    scheduleBootJob("unit-test-job", 1_000, fn);
    expect(fn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(getSuppressedBootSideEffects()).toHaveLength(0);
  });

  it("T8/T9/T10/T11 no boot job is scheduled or run in proof mode", async () => {
    process.env[BOOT_PROOF_ENV_VAR] = "1";
    const jobs = [
      "global-data-pump",
      "telegram-bot-commands",
      "kite-warmup",
      "kite-candle-store",
      "paper-trade-writer-version-column",
    ].map(label => {
      const fn = vi.fn();
      scheduleBootJob(label, 1_000, fn);
      return fn;
    });
    await vi.advanceTimersByTimeAsync(600_000);
    for (const fn of jobs) expect(fn).not.toHaveBeenCalled();
    expect(getSuppressedBootSideEffects().map(s => s.subsystem)).toEqual([
      "bootJob:global-data-pump",
      "bootJob:telegram-bot-commands",
      "bootJob:kite-warmup",
      "bootJob:kite-candle-store",
      "bootJob:paper-trade-writer-version-column",
    ]);
  });

  it("T8b no timer is CREATED at all when a boot job is suppressed", async () => {
    process.env[BOOT_PROOF_ENV_VAR] = "1";
    const spy = vi.spyOn(globalThis, "setTimeout");
    const before = spy.mock.calls.length;
    const handle = scheduleBootJob("suppressed-job", 1_000, vi.fn());
    const poolHandle = scheduleDbPoolStatsLog("suppressed-pool", 1_000, vi.fn(() => null));
    expect(spy.mock.calls.length).toBe(before);
    // A suppressed job returns nothing — not a pre-cleared handle, which would
    // still have cost a real timer allocation.
    expect(handle).toBeUndefined();
    expect(poolHandle).toBeUndefined();
    spy.mockRestore();
  });

  it("T9b even the read-only pool-stats timer is not scheduled in proof mode", async () => {
    process.env[BOOT_PROOF_ENV_VAR] = "1";
    const getStats = vi.fn(() => null);
    scheduleDbPoolStatsLog("unit", 1_000, getStats);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(getStats).not.toHaveBeenCalled();
  });
});

/**
 * Wiring assertions. Every enumerated side effect must pass through the shared
 * gate at its real call site; a gate that exists but is not wired suppresses
 * nothing. Comments are stripped first so a mention in prose cannot satisfy a
 * check.
 */
describe("P07B every enumerated side effect is wired to the gate", () => {
  const routesIndex = () => stripComments(read("routes/index.ts"));
  const scanner = () => stripComments(read("routes/scanner.ts"));
  const appTs = () => stripComments(read("app.ts"));

  it("T5d Kite bootstrap is invoked only through the providerNetwork gate", () => {
    const s = routesIndex();
    expect(s).toContain('runIfCapable("kiteFeedBootstrap", "providerNetwork"');
    // No ungated call anywhere in the file.
    expect(s).not.toMatch(/^void bootstrapKite\(\);/m);
  });

  it("T6 the only KiteTicker construction is behind the webSockets capability", () => {
    const s = stripComments(read("lib/kiteFeed.ts"));
    const constructions = [...s.matchAll(/new KiteTicker\(/g)];
    expect(constructions).toHaveLength(1);
    const guardAt = s.indexOf("if (!getBootCapabilities().webSockets)");
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(constructions[0]!.index!);
  });

  it("T7 subscribe and unsubscribe are behind the subscriptions capability", () => {
    const s = stripComments(read("lib/kiteFeed.ts"));
    const port = s.slice(s.indexOf("const subscriptionPort"), s.indexOf("markSubscribed:"));
    expect(port.match(/getBootCapabilities\(\)\.subscriptions/g)).toHaveLength(2);
  });

  it("T9c readiness, swing-scan and scanner sweeps are gated", () => {
    const s = routesIndex();
    expect(s).toContain('runIfCapable("kiteReadinessScheduler", "marketSchedulers"');
    expect(s).toContain('runIfCapable("swingScanScheduler", "marketSchedulers"');
    expect(s).not.toMatch(/^startKiteReadinessScheduler\(\);/m);
    expect(s).not.toMatch(/^startSwingScanScheduler\(\);/m);

    const sc = scanner();
    expect(sc).toContain('runIfCapable("scannerWatchlistSweep", "providerNetwork"');
    expect(sc).toContain('runIfCapable("fullNseScannerBackground", "marketSchedulers"');
    // Column-0 = module scope: no ungated import-time side effect may remain.
    expect(sc).not.toMatch(/^startFullNseScannerBackground\(\);/m);
    expect(sc).not.toMatch(/^void scanAll\(\)/m);
    expect(sc).not.toMatch(/^setInterval\(/m);
  });

  it("T10b both ingestors are gated on the ingestors capability", () => {
    const s = routesIndex();
    expect(s).toContain('runIfCapable("optionSnapshotIngestor", "ingestors"');
    expect(s).toContain('runIfCapable("candleWarehouseIngestor", "ingestors"');
    expect(s).not.toMatch(/^startOptionSnapshotIngestor\(\);/m);
    expect(s).not.toMatch(/^startCandleWarehouse\(\);/m);
  });

  it("T11b outbound notification subsystems are gated", () => {
    expect(appTs()).toContain('}, "outboundNotifications");');
    const reports = stripComments(read("lib/dailyReports.ts"));
    expect(reports).toContain('runIfCapable("dailyReportsTick", "outboundNotifications"');
    const eod = stripComments(read("lib/paperDailySummaryFo.ts"));
    expect(eod).toContain('runIfCapable("paperDailySummaryFoEodTick", "marketSchedulers"');
  });

  it("T9d module-scope market timers and provider warm-ups are gated", () => {
    const opt = stripComments(read("lib/optionSignals.ts"));
    expect(opt).toContain('runIfCapable("optionSignalsTriggerSweep", "providerNetwork"');
    expect(opt).toContain('runIfCapable("optionSignalsLockSweep", "marketSchedulers"');
    for (const f of ["lib/deepscan.ts", "lib/marketEvents.ts", "lib/newsRss.ts", "lib/stocksToWatch.ts",
                     "lib/symbolAlias.ts"]) {
      expect(stripComments(read(f))).toContain("getBootCapabilities().providerNetwork");
    }
  });

  it("T17b module-load DDL self-initialisers are gated", () => {
    // Found by the controlled boot: these run CREATE TABLE / CREATE INDEX at
    // import time, which a zero-mutation proof boot cannot allow.
    const notif = stripComments(read("lib/tradeLifecycle/notificationLog.ts"));
    expect(notif).toContain("getBootCapabilities().marketSchedulers");
    expect(notif).toMatch(/NODE_ENV.\] !== 'test' && getBootCapabilities\(\)\.marketSchedulers/);
  });

  it("T17c no module-scope NODE_ENV!=='test' boot block is left ungated", () => {
    // Every column-0 `if (process.env['NODE_ENV'] !== 'test') {` block is an
    // unconditional import-time side effect on every non-test boot. Each one
    // must also consult the capability contract.
    const files = [
      "lib/deepscan.ts", "lib/marketEvents.ts", "lib/newsRss.ts", "lib/stocksToWatch.ts",
      "lib/symbolAlias.ts", "lib/dailyReports.ts", "lib/tradeLifecycle/notificationLog.ts",
    ];
    for (const f of files) {
      const src = stripComments(read(f));
      const blocks = [...src.matchAll(/^if \(process\.env\[.NODE_ENV.\] !== .test.([^{]*)\{/gm)];
      expect(blocks.length, f).toBeGreaterThan(0);
      for (const b of blocks) {
        const tail = b[1] ?? "";
        // Either the condition itself consults capabilities, or the body does.
        const bodyStart = b.index! + b[0].length;
        const body = src.slice(bodyStart, bodyStart + 400);
        expect(
          tail.includes("getBootCapabilities()") || body.includes("runIfCapable("),
          `${f} has an ungated import-time boot block`,
        ).toBe(true);
      }
    }
  });

  it("T9e every staggered boot job in app.ts goes through scheduleBootJob", () => {
    const s = appTs();
    // No raw setTimeout/setInterval start-up timers may bypass the gate.
    expect(s).not.toMatch(/^set(Timeout|Interval)\(/m);
  });
});

describe("P07B what proof mode must NOT change", () => {
  it("T12 registry restoration is retained and still awaited unconditionally", () => {
    expect(getBootCapabilities(PROOF_ON).registryRestore).toBe(true);
    const entry = stripComments(read("index.ts"));
    expect(entry).toMatch(/await loadLatestAcceptedGeneration\("STARTUP_L2_RESTORE"\)/);
    // The restore is not wrapped in any capability branch.
    expect(entry).not.toMatch(/runIfCapable\([^)]*loadLatestAcceptedGeneration/);
  });

  it("T13 the HTTP listener still starts, and only after restoration settles", () => {
    expect(getBootCapabilities(PROOF_ON).httpListener).toBe(true);
    const entry = stripComments(read("index.ts"));
    expect(entry.indexOf("loadLatestAcceptedGeneration")).toBeLessThan(entry.indexOf("app.listen("));
    // Ordering is observable in the proof log, not merely in the source.
    expect(entry.indexOf('proofMark("RESTORATION_SETTLED")')).toBeLessThan(entry.indexOf("app.listen("));
    expect(entry.indexOf('proofMark("RESTORATION_START")')).toBeLessThan(
      entry.indexOf("loadLatestAcceptedGeneration"),
    );
  });

  it("T14 authentication is untouched by the mode", () => {
    // No auth surface may branch on the proof flag.
    for (const f of ["lib/auth.ts", "lib/userAuth.ts", "lib/global/auth.ts"]) {
      const s = read(f);
      expect(s).not.toContain(BOOT_PROOF_ENV_VAR);
      expect(s).not.toContain("bootCapabilities");
    }
    const app = stripComments(read("app.ts"));
    expect(app).toContain("app.use(requireAuth);");
  });

  it("T15 registry diagnostics remain owner-only (strict)", () => {
    const s = stripComments(read("routes/dataHealth.ts"));
    expect(s).toContain('router.get("/data-health/registry", requireOwnerStrict,');
    // and the response carries no manifest payload or record contents
    expect(s).not.toMatch(/records\s*:/);
  });

  it("T17 the restore path contains no DDL and no write", () => {
    const store = stripComments(read("lib/registry/manifestStore.ts"));
    const loader = store.slice(store.indexOf("export async function loadLatestAcceptedGeneration"));
    expect(loader).not.toMatch(/CREATE TABLE|CREATE INDEX|INSERT INTO|UPDATE |DELETE FROM|ALTER TABLE/i);
    expect(loader).not.toContain("ensureRegistrySchema");
    expect(loader).toContain("to_regclass");
  });

  it("T18 all four safety locks remain false as boolean", () => {
    const candle = read("lib/candleEvaluationControl.ts");
    expect(candle).toContain("export const FULL_NSE_WAREHOUSE_POPULATION_AUTHORIZED = false as boolean;");
    expect(candle).toContain("export const SCANNER_KITE_CANDLE_EVALUATION_AUTHORIZED = false as boolean;");
    const v2 = read("lib/v2PaperLocks.ts");
    expect(v2).toContain("export const FNO_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean;");
    expect(v2).toContain("export const SWING_PAPER_V2_RUNTIME_AUTHORIZED = false as boolean;");
  });
});
