/**
 * Clock-drift DETECTION (fix-file BUG-29).
 *
 * IMPORTANT: this is drift *detection*, NOT time synchronization. The host /
 * production infrastructure must run real NTP; this module only measures how
 * far the local clock has drifted from a trusted HTTP time source and alerts
 * the owner when the drift exceeds thresholds.
 *
 * Method: request an external UTC time source, take the local send/receive
 * midpoint as the comparison instant (halves RTT error), and compute
 * drift = serverUtcMs − localMidpointMs. Sources (in order):
 *   1. worldtimeapi.org (millisecond-precision JSON)
 *   2. HTTP `Date` response header from google.com (1s resolution fallback)
 *
 * Business/market logic elsewhere uses Asia/Kolkata; timestamps here are UTC.
 */
import { alertOwner } from "./alerting";
import { logger } from "./logger";

export const DRIFT_WARN_MS = 500;
export const DRIFT_ALERT_MS = 1000;
export const CHECK_INTERVAL_MS = 60 * 60_000; // hourly, per fix file
const FETCH_TIMEOUT_MS = 8_000;

export type ClockDriftStatus = "OK" | "WARN" | "ALERT" | "CHECK_FAILED" | "UNKNOWN";

export interface ClockDriftSnapshot {
  status: ClockDriftStatus;
  driftMs: number | null;
  rttMs: number | null;
  source: string | null;
  checkedAt: string | null;
  lastSuccessAt: string | null;
  failureReason: string | null;
  thresholdWarnMs: number;
  thresholdAlertMs: number;
  note: string;
}

const NOTE =
  "Drift detection only — actual clock synchronization must be handled by host-level NTP.";

/** PURE — classify a measured drift. */
export function classifyDrift(absDriftMs: number): ClockDriftStatus {
  if (absDriftMs > DRIFT_ALERT_MS) return "ALERT";
  if (absDriftMs > DRIFT_WARN_MS) return "WARN";
  return "OK";
}

let snapshot: ClockDriftSnapshot = {
  status: "UNKNOWN",
  driftMs: null,
  rttMs: null,
  source: null,
  checkedAt: null,
  lastSuccessAt: null,
  failureReason: null,
  thresholdWarnMs: DRIFT_WARN_MS,
  thresholdAlertMs: DRIFT_ALERT_MS,
  note: NOTE,
};
let timer: NodeJS.Timeout | null = null;

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

interface TimeProbe {
  serverUtcMs: number;
  rttMs: number;
  source: string;
}

async function probeWorldTimeApi(): Promise<TimeProbe> {
  const t0 = Date.now();
  const r = await fetchWithTimeout("https://worldtimeapi.org/api/timezone/Etc/UTC");
  const t1 = Date.now();
  if (!r.ok) throw new Error(`worldtimeapi HTTP ${r.status}`);
  const j = (await r.json()) as { utc_datetime?: string; unixtime?: number };
  const serverUtcMs = j.utc_datetime ? Date.parse(j.utc_datetime) : (j.unixtime ?? 0) * 1000;
  if (!Number.isFinite(serverUtcMs) || serverUtcMs <= 0) throw new Error("worldtimeapi bad payload");
  return { serverUtcMs, rttMs: t1 - t0, source: "worldtimeapi.org" };
}

async function probeHttpDateHeader(): Promise<TimeProbe> {
  const t0 = Date.now();
  const r = await fetchWithTimeout("https://www.google.com/generate_204", { method: "HEAD" });
  const t1 = Date.now();
  const dateHeader = r.headers.get("date");
  if (!dateHeader) throw new Error("no Date header");
  const serverUtcMs = Date.parse(dateHeader);
  if (!Number.isFinite(serverUtcMs)) throw new Error("unparseable Date header");
  // Date header has 1s resolution — add 500ms to align to the second's midpoint.
  return { serverUtcMs: serverUtcMs + 500, rttMs: t1 - t0, source: "http-date:google.com" };
}

export async function runClockDriftCheck(): Promise<ClockDriftSnapshot> {
  const checkedAt = new Date().toISOString();
  let probe: TimeProbe | null = null;
  let failureReason: string | null = null;
  const t0 = Date.now();
  try {
    probe = await probeWorldTimeApi();
  } catch (e1) {
    try {
      probe = await probeHttpDateHeader();
    } catch (e2) {
      failureReason = `worldtimeapi: ${(e1 as Error).message}; http-date: ${(e2 as Error).message}`;
    }
  }
  if (!probe) {
    snapshot = { ...snapshot, status: "CHECK_FAILED", checkedAt, failureReason };
    logger.warn({ failureReason }, "clock-drift check failed (BUG-29)");
    return snapshot;
  }
  const localMidMs = t0 + probe.rttMs / 2;
  const driftMs = Math.round(probe.serverUtcMs - localMidMs);
  const status = classifyDrift(Math.abs(driftMs));
  snapshot = {
    status,
    driftMs,
    rttMs: probe.rttMs,
    source: probe.source,
    checkedAt,
    lastSuccessAt: checkedAt,
    failureReason: null,
    thresholdWarnMs: DRIFT_WARN_MS,
    thresholdAlertMs: DRIFT_ALERT_MS,
    note: NOTE,
  };
  logger.info({ driftMs, rttMs: probe.rttMs, source: probe.source, status }, "clock-drift check (BUG-29)");
  if (status === "ALERT") {
    alertOwner(
      "CLOCK_DRIFT_EXCEEDED",
      `Server clock drift ${driftMs}ms vs ${probe.source} (threshold ${DRIFT_ALERT_MS}ms). ` +
        `Signal timestamps may be unreliable — fix host NTP.`,
      undefined,
      30 * 60_000,
    );
  }
  return snapshot;
}

export function getClockDriftSnapshot(): ClockDriftSnapshot {
  return snapshot;
}

export function startClockDriftMonitor(): void {
  if (timer) return;
  void runClockDriftCheck().catch(() => {});
  timer = setInterval(() => void runClockDriftCheck().catch(() => {}), CHECK_INTERVAL_MS);
  timer.unref?.();
  logger.info({ intervalMs: CHECK_INTERVAL_MS }, "clock-drift monitor started (BUG-29, detection only)");
}
