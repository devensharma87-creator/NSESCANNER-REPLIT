/**
 * Clock-drift DETECTION (fix-file BUG-29).
 *
 * IMPORTANT: this is drift *detection*, NOT time synchronization. The host /
 * production infrastructure must run real NTP; this module only measures how
 * far the local clock has drifted from a trusted HTTP time source and alerts
 * the owner when the drift exceeds thresholds.
 *
 * Method: collect up to PROBE_ATTEMPTS time probes (worldtimeapi.org primary,
 * HTTP Date header fallback). Filter out high-RTT probes (> MAX_RTT_FOR_RELIABLE_PROBE_MS)
 * that are too noisy to yield a reliable offset estimate at our thresholds.
 * Require at least MIN_VALID_PROBES valid results; if insufficient, report
 * INSUFFICIENT_SAMPLES rather than fabricating a zero-drift reading.
 * Compute the median drift across valid probes — one outlier cannot dominate.
 *
 * Recovery tracking: emit exactly one CLOCK_DRIFT_RECOVERED (INFO) when drift
 * drops back below DRIFT_RECOVERY_MS after a prior ALERT. This is process-level
 * state (resets on restart), mirroring the existing alerting.ts in-memory dedup.
 *
 * Sources (in order per probe attempt):
 *   1. worldtimeapi.org (millisecond-precision JSON)
 *   2. HTTP `Date` response header from google.com (1s resolution fallback)
 *
 * Business/market logic elsewhere uses Asia/Kolkata; timestamps here are UTC.
 */
import { alertOwner } from "./alerting";
import { logger } from "./logger";

export const DRIFT_WARN_MS = 500;
export const DRIFT_ALERT_MS = 1000;
/** Drop below this to emit a recovery alert (hysteresis below DRIFT_WARN_MS). */
export const DRIFT_RECOVERY_MS = DRIFT_WARN_MS - 100; // 400 ms
export const CHECK_INTERVAL_MS = 60 * 60_000; // hourly, per fix file
export const PROBE_ATTEMPTS = 3;
/** Probes with RTT above this are too noisy for a ±500ms drift threshold. */
export const MAX_RTT_FOR_RELIABLE_PROBE_MS = 3_000;
/** Minimum valid (low-RTT) probes needed to report a drift value. */
export const MIN_VALID_PROBES = 2;

const FETCH_TIMEOUT_MS = 8_000;

export type ClockDriftStatus =
  | "OK"
  | "WARN"
  | "ALERT"
  | "CHECK_FAILED"
  | "UNKNOWN"
  | "INSUFFICIENT_SAMPLES";

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
  recoveryBoundaryMs: number;
  probeCount: number;
  validProbeCount: number;
  note: string;
}

export interface TimeProbe {
  serverUtcMs: number;
  rttMs: number;
  localT0Ms: number; // local clock at request start (for midpoint calc)
  source: string;
}

const NOTE =
  "Drift detection only — actual clock synchronization must be handled by host-level NTP.";

/** PURE — classify a measured drift. */
export function classifyDrift(absDriftMs: number): ClockDriftStatus {
  if (absDriftMs > DRIFT_ALERT_MS) return "ALERT";
  if (absDriftMs > DRIFT_WARN_MS) return "WARN";
  return "OK";
}

/** PURE — filter probes whose RTT exceeds the reliability threshold. */
export function filterReliableProbes(
  probes: TimeProbe[],
  maxRttMs: number = MAX_RTT_FOR_RELIABLE_PROBE_MS,
): TimeProbe[] {
  return probes.filter((p) => p.rttMs <= maxRttMs);
}

/** PURE — compute the drift (server - local midpoint) for each probe. */
export function computeProbeDrifts(probes: TimeProbe[]): number[] {
  return probes.map((p) => p.serverUtcMs - (p.localT0Ms + p.rttMs / 2));
}

/**
 * PURE — compute median of a non-empty number array. Returns the middle
 * value for odd-length arrays, average of the two middle values for even.
 * Caller is responsible for ensuring the array is non-empty.
 */
export function median(values: number[]): number {
  if (values.length === 0) throw new Error("median: empty array");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return Math.round(sorted[mid]!);
  return Math.round(((sorted[mid - 1]! + sorted[mid]!) / 2));
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
  recoveryBoundaryMs: DRIFT_RECOVERY_MS,
  probeCount: 0,
  validProbeCount: 0,
  note: NOTE,
};
let timer: NodeJS.Timeout | null = null;

/**
 * Process-level recovery tracking.
 * "ALERT" = we have alerted for drift; a drop below DRIFT_RECOVERY_MS triggers recovery.
 * null = initial / unknown state (no alert sent yet this process lifetime).
 */
let lastAlertedDriftStatus: "ALERT" | "WARN" | "OK" | null = null;

/** Reset drift-alert state — test-only. */
export function resetClockDriftStateForTest(): void {
  lastAlertedDriftStatus = null;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function probeWorldTimeApi(): Promise<TimeProbe> {
  const localT0Ms = Date.now();
  const r = await fetchWithTimeout("https://worldtimeapi.org/api/timezone/Etc/UTC");
  const rttMs = Date.now() - localT0Ms;
  if (!r.ok) throw new Error(`worldtimeapi HTTP ${r.status}`);
  const j = (await r.json()) as { utc_datetime?: string; unixtime?: number };
  const serverUtcMs = j.utc_datetime ? Date.parse(j.utc_datetime) : (j.unixtime ?? 0) * 1000;
  if (!Number.isFinite(serverUtcMs) || serverUtcMs <= 0) throw new Error("worldtimeapi bad payload");
  return { serverUtcMs, rttMs, localT0Ms, source: "worldtimeapi.org" };
}

async function probeHttpDateHeader(): Promise<TimeProbe> {
  const localT0Ms = Date.now();
  const r = await fetchWithTimeout("https://www.google.com/generate_204", { method: "HEAD" });
  const rttMs = Date.now() - localT0Ms;
  const dateHeader = r.headers.get("date");
  if (!dateHeader) throw new Error("no Date header");
  const serverUtcMs = Date.parse(dateHeader);
  if (!Number.isFinite(serverUtcMs)) throw new Error("unparseable Date header");
  // Date header has 1s resolution — add 500ms to align to the second's midpoint.
  return { serverUtcMs: serverUtcMs + 500, rttMs, localT0Ms, source: "http-date:google.com" };
}

/**
 * Collect up to `count` time probes sequentially. Each attempt tries
 * worldtimeapi first, then http-date as fallback. Probe errors are logged
 * but do not stop subsequent attempts.
 */
export async function collectTimeProbes(count: number = PROBE_ATTEMPTS): Promise<{
  probes: TimeProbe[];
  errors: string[];
}> {
  const probes: TimeProbe[] = [];
  const errors: string[] = [];
  for (let i = 0; i < count; i++) {
    try {
      probes.push(await probeWorldTimeApi());
    } catch (e1) {
      try {
        probes.push(await probeHttpDateHeader());
      } catch (e2) {
        errors.push(
          `probe ${i + 1}: worldtimeapi: ${(e1 as Error).message}; http-date: ${(e2 as Error).message}`,
        );
      }
    }
  }
  return { probes, errors };
}

export async function runClockDriftCheck(): Promise<ClockDriftSnapshot> {
  const checkedAt = new Date().toISOString();

  const { probes: rawProbes, errors } = await collectTimeProbes(PROBE_ATTEMPTS);

  if (rawProbes.length === 0) {
    const failureReason = errors.join("; ");
    snapshot = { ...snapshot, status: "CHECK_FAILED", checkedAt, failureReason, probeCount: 0, validProbeCount: 0 };
    logger.warn({ failureReason }, "clock-drift check failed (BUG-29)");
    return snapshot;
  }

  const validProbes = filterReliableProbes(rawProbes);

  if (validProbes.length < MIN_VALID_PROBES) {
    const failureReason =
      `Only ${validProbes.length} of ${rawProbes.length} probe(s) had RTT ≤ ${MAX_RTT_FOR_RELIABLE_PROBE_MS}ms ` +
      `(need ≥ ${MIN_VALID_PROBES}); high-latency probes rejected as too noisy for ±${DRIFT_WARN_MS}ms threshold.` +
      (errors.length ? ` Probe errors: ${errors.join("; ")}` : "");
    snapshot = {
      ...snapshot,
      status: "INSUFFICIENT_SAMPLES",
      checkedAt,
      failureReason,
      probeCount: rawProbes.length,
      validProbeCount: validProbes.length,
    };
    logger.warn(
      { validProbes: validProbes.length, totalProbes: rawProbes.length },
      "clock-drift: insufficient reliable probes (BUG-29)",
    );
    return snapshot;
  }

  const drifts = computeProbeDrifts(validProbes);
  const driftMs = median(drifts);
  const medianRttMs = median(validProbes.map((p) => p.rttMs));
  const sources = [...new Set(validProbes.map((p) => p.source))].join(", ");
  const status = classifyDrift(Math.abs(driftMs));

  snapshot = {
    status,
    driftMs,
    rttMs: medianRttMs,
    source: sources,
    checkedAt,
    lastSuccessAt: checkedAt,
    failureReason: null,
    thresholdWarnMs: DRIFT_WARN_MS,
    thresholdAlertMs: DRIFT_ALERT_MS,
    recoveryBoundaryMs: DRIFT_RECOVERY_MS,
    probeCount: rawProbes.length,
    validProbeCount: validProbes.length,
    note: NOTE,
  };

  logger.info(
    { driftMs, medianRttMs, sources, status, validProbes: validProbes.length, totalProbes: rawProbes.length },
    "clock-drift check (BUG-29)",
  );

  // ── Alert / recovery state machine ──────────────────────────────────────────
  if (status === "ALERT" && lastAlertedDriftStatus !== "ALERT") {
    // First ALERT (or escalation from WARN/OK/null) → emit once
    lastAlertedDriftStatus = "ALERT";
    alertOwner(
      "CLOCK_DRIFT_EXCEEDED",
      `Server clock drift ${driftMs}ms vs ${sources} (threshold ${DRIFT_ALERT_MS}ms). ` +
        `Median RTT: ${medianRttMs}ms across ${validProbes.length} reliable probe(s). ` +
        `Signal timestamps may be unreliable — fix host NTP.`,
      undefined,
      30 * 60_000,
      `CLOCK_DRIFT_EXCEEDED::alert`,
    );
  } else if (
    status !== "ALERT" &&
    Math.abs(driftMs) < DRIFT_RECOVERY_MS &&
    lastAlertedDriftStatus === "ALERT"
  ) {
    // Recovered below the hysteresis boundary → emit exactly once
    lastAlertedDriftStatus = "OK";
    alertOwner(
      "CLOCK_DRIFT_RECOVERED",
      `Server clock drift recovered: ${driftMs}ms (below recovery boundary ${DRIFT_RECOVERY_MS}ms). ` +
        `Median RTT: ${medianRttMs}ms across ${validProbes.length} reliable probe(s).`,
      undefined,
      0, // bypass dedup — recovery must always fire once
      `CLOCK_DRIFT_RECOVERED::${checkedAt}`,
      "INFO",
    );
  } else if (status !== "ALERT") {
    // OK or WARN — update state without alerting
    lastAlertedDriftStatus = status === "WARN" ? "WARN" : "OK";
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
