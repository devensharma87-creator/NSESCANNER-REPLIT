/**
 * System status routes (fix-file BUG-28 + BUG-29 + BUG-89).
 *
 *   GET  /system/mode           — owner: SystemMode snapshot + clock drift.
 *   POST /system/mode-override  — owner (strict): set/clear manual mode override.
 *   GET  /metrics               — Prometheus text exposition. Auth: `Authorization:
 *                                 Bearer $METRICS_TOKEN` (for external scrapers)
 *                                 OR an owner session cookie. Never public.
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
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/system/mode", requireOwner, async (_req, res) => {
  const snapshot = getSystemModeSnapshot() ?? (await runSystemModeTick());
  res.json({
    mode: snapshot,
    clockDrift: getClockDriftSnapshot(),
    tokenStaleness: getStalenessSnapshot(),
    instrumentsIntegrity: getInstrumentsIntegrityStatus(),
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
