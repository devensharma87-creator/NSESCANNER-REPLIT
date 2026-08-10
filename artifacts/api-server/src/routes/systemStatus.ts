/**
 * System status routes (fix-file BUG-28 + BUG-29 + BUG-89).
 *
 *   GET  /system/mode             — requireOwner: safe operational snapshot (no DB diagnostics).
 *                                   Compatible with anonymous/public-access/subscriber sessions.
 *   GET  /system/mode/diagnostics — requireOwnerStrict: full DB measurement breakdown,
 *                                   pool counters, backend PID, instance fingerprint.
 *                                   Never exposed to anonymous or public-access sessions.
 *   POST /system/mode-override    — requireOwnerStrict: set/clear manual mode override.
 *   GET  /metrics                 — Auth: `Authorization: Bearer $METRICS_TOKEN` (for external
 *                                   scrapers) OR an owner session cookie. Never public.
 */
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { requireOwner, requireOwnerStrict } from "../lib/userAuth";
import {
  getSystemModeSnapshot,
  runSystemModeTick,
  setSystemModeOverride,
  isValidSystemMode,
  SYSTEM_MODES,
} from "../lib/systemMode";
import { getClockDriftSnapshot, runClockDriftCheck } from "../lib/clockDrift";
import { getStalenessSnapshot } from "../lib/marketData/stalenessWatchdog";
import { getInstrumentsIntegrityStatus } from "../lib/marketData/instrumentsIntegrity";
import { listReconReports, runEodReconciliation } from "../lib/eodReconciliation";
import { SYSTEM_MODE_RANK } from "../lib/systemModeCache";
import { getKiteReadiness } from "../lib/kiteReadiness";
import { buildGlobalDataHealth } from "../lib/globalDataHealth";
import { getProviderCapabilities } from "../lib/marketData/providerCapability";
import { getBuildInfo } from "../lib/buildInfo";
import { RUNTIME_PROCESS_ID, RUNTIME_BOOT_ID, RUNTIME_STARTED_AT } from "../lib/runtimeIdentity";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * Extract the safe, public-safe operational fields from a SystemModeSnapshot.
 * Explicitly selected — never spread — so that future additions to
 * SystemModeSnapshot (e.g. dbDiagnostics, dbInstanceFingerprint) cannot
 * accidentally leak through this route.
 */
function safeSnapshotFields(snapshot: ReturnType<typeof getSystemModeSnapshot> & object) {
  return {
    derived: snapshot.derived,
    override: snapshot.override,
    effective: snapshot.effective,
    drivers: snapshot.drivers,
    dbLatencyMs: snapshot.dbLatencyMs,
    checkedAt: snapshot.checkedAt,
    autoOpensAllowed: snapshot.autoOpensAllowed,
  };
}

// ---------------------------------------------------------------------------
// GET /system/mode — requireOwner (public-access compatible)
// Returns safe operational fields ONLY. Never exposes DB diagnostics,
// fingerprint, backend PID, pool counters or acquisition timing.
// ---------------------------------------------------------------------------
router.get("/system/mode", requireOwner, async (_req, res) => {
  const snapshot = getSystemModeSnapshot() ?? (await runSystemModeTick());
  res.json({
    mode: safeSnapshotFields(snapshot),
    clockDrift: getClockDriftSnapshot(),
    tokenStaleness: getStalenessSnapshot(),
    instrumentsIntegrity: getInstrumentsIntegrityStatus(),
    // B1.1 — Machine-readable provider capability snapshot.
    // Contains no credentials — only state names and safe reason strings.
    providerCapabilities: getProviderCapabilities(),
  });
});

// ---------------------------------------------------------------------------
// GET /system/mode/diagnostics — requireOwnerStrict
// Full DB measurement breakdown. Never exposed to anonymous/public-access
// sessions. Reads the cached tick only — zero DB queries in request path.
// ---------------------------------------------------------------------------
router.get("/system/mode/diagnostics", requireOwnerStrict, (_req, res) => {
  const snapshot = getSystemModeSnapshot();
  if (!snapshot) {
    res.status(503).json({
      error: "system_mode_not_yet_initialized",
      hint: "The system-mode tick has not completed yet. Retry in a few seconds.",
    });
    return;
  }

  const diag = snapshot.dbDiagnostics;

  // comparisonResetReason: explains why backendPidChanged is null on this response.
  // "FIRST_MEASUREMENT"  — this process has not yet completed a second tick; no
  //                         prior PID to compare against.
  // null                 — a prior PID was available for comparison.
  //
  // Across autoscale instances: callers should compare runtimeBootId between
  // consecutive samples. Different runtimeBootId → backend PID from the previous
  // sample belongs to a different process; treat as if backendPidChanged = null
  // (RUNTIME_INSTANCE_CHANGED semantics).
  const comparisonResetReason =
    diag?.backendPidChanged === null && diag?.dbMeasurementStatus === "ok"
      ? "FIRST_MEASUREMENT"
      : null;

  const buildInfo = getBuildInfo();

  res.json({
    // Safe operational snapshot — same fields as /system/mode
    systemMode: safeSnapshotFields(snapshot),
    // Full DB measurement breakdown
    dbDiagnostics: diag ?? null,
    dbInstanceFingerprint: snapshot.dbInstanceFingerprint ?? null,
    comparisonResetReason,
    // Autoscale instance identity
    // PID comparison is valid ONLY within the same runtimeBootId + runtimeProcessId.
    runtimeProcessId: RUNTIME_PROCESS_ID,
    runtimeBootId: RUNTIME_BOOT_ID,
    runtimeStartedAt: RUNTIME_STARTED_AT,
    deploymentCommit: buildInfo.commitShort,
  });
});

router.get("/system/reconciliation", requireOwner, async (req, res) => {
  const limit = Math.min(Number(req.query["limit"] ?? 14) || 14, 60);
  res.json({ reports: await listReconReports(limit) });
});

router.post("/system/reconciliation/run", requireOwnerStrict, async (_req, res) => {
  const report = await runEodReconciliation(new Date(), true);
  res.json({ ok: true, report });
});

router.post("/system/mode-override", requireOwnerStrict, async (req, res) => {
  const raw = (req.body as { mode?: unknown } | undefined)?.mode ?? null;
  if (raw !== null && !isValidSystemMode(raw)) {
    res.status(400).json({ error: "invalid_mode", allowed: [...SYSTEM_MODES, null] });
    return;
  }
  await setSystemModeOverride(raw);
  logger.warn({ override: raw }, "system-mode override changed by owner");
  res.json({ ok: true, mode: getSystemModeSnapshot() });
});

router.post("/system/clock-drift/check", requireOwnerStrict, async (_req, res) => {
  res.json(await runClockDriftCheck());
});

function metricsAuth(req: Request, res: Response, next: NextFunction): void {
  const token = process.env["METRICS_TOKEN"];
  if (token && token.length > 0 && req.headers.authorization === `Bearer ${token}`) {
    next();
    return;
  }
  requireOwnerStrict(req, res, next);
}

router.get("/metrics", metricsAuth, async (_req, res) => {
  const [mode, readiness, health] = await Promise.all([
    Promise.resolve(getSystemModeSnapshot() ?? (await runSystemModeTick())),
    getKiteReadiness(),
    buildGlobalDataHealth(),
  ]);
  const drift = getClockDriftSnapshot();
  const mem = process.memoryUsage();

  const lines: string[] = [];
  const g = (name: string, value: number | null, help?: string, labels?: string) => {
    if (help) lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`);
    if (value !== null && Number.isFinite(value)) lines.push(`${name}${labels ?? ""} ${value}`);
  };

  g("marketscanner_system_mode_code", SYSTEM_MODE_RANK[mode.effective],
    "Effective SystemMode (0=NORMAL 1=DEGRADED 2=READ_ONLY 3=HALT)");
  for (const m of SYSTEM_MODES) {
    lines.push(`marketscanner_system_mode{mode="${m}"} ${mode.effective === m ? 1 : 0}`);
  }
  g("marketscanner_auto_opens_allowed", mode.autoOpensAllowed ? 1 : 0, "1 when new auto paper-opens are allowed");
  g("marketscanner_db_latency_ms", mode.dbLatencyMs, "PostgreSQL SELECT 1 latency in ms (null check omitted)");
  g("marketscanner_clock_drift_ms", drift.driftMs, "Measured clock drift vs external UTC source (detection only)");
  g("marketscanner_clock_drift_ok", drift.status === "OK" ? 1 : drift.status === "UNKNOWN" ? 1 : 0,
    "1 when clock drift within warn threshold or not yet measured");
  g("marketscanner_kite_session_valid", readiness.sessionValid ? 1 : 0, "1 when the Kite session is valid");
  g("marketscanner_kite_ws_connected", health.kite.websocketStatus === "CONNECTED" ? 1 : 0,
    "1 when the Kite ticker websocket is connected");
  g("marketscanner_kite_live_quotes", health.kite.liveQuotesCount, "Number of instruments with a live in-memory quote");
  g("marketscanner_market_session_open", readiness.marketSession === "open" ? 1 : 0, "1 during NSE market hours");
  const stale = getStalenessSnapshot();
  g("marketscanner_tokens_tracked", stale.totalTracked, "Symbols tracked by the staleness watchdog");
  g("marketscanner_tokens_stale", stale.staleCount, "Symbols without a tick beyond the staleness threshold");
  g("marketscanner_tokens_stale_pct", stale.stalePct, "Fraction of tracked symbols currently stale");
  g("marketscanner_instruments_refresh_failed_today", getInstrumentsIntegrityStatus().failedToday ? 1 : 0,
    "1 when today's instruments dump refresh failed (auto-opens blocked)");
  g("marketscanner_process_uptime_seconds", Math.round(process.uptime()), "Node process uptime");
  g("marketscanner_process_rss_bytes", mem.rss, "Resident set size");
  g("marketscanner_process_heap_used_bytes", mem.heapUsed, "V8 heap used");

  res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(lines.join("\n") + "\n");
});

export default router;
