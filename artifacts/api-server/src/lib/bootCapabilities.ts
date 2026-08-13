/**
 * Boot capability contract — the single place that decides which start-up side
 * effects this process is allowed to perform.
 *
 * WHY THIS EXISTS
 * ---------------
 * The API server starts providers, WebSockets, schedulers and ingestors as
 * import-time side effects of `app.ts` and `routes/index.ts`. That makes it
 * impossible to observe one specific boot behaviour — e.g. read-only registry
 * restoration — without also firing every external integration in the process.
 * Unsetting credentials, editing sources temporarily or racing a short-lived
 * process are workarounds, not isolation, and they produce misleading evidence.
 *
 * `DATA_FOUNDATION_BOOT_PROOF=1` turns on a DEVELOPMENT-ONLY boot mode that
 * suppresses exactly the enumerated side effects below and retains everything
 * needed to observe boot-time registry restoration end to end.
 *
 * WHAT IT IS NOT
 * --------------
 * - Not a generic "disable everything" switch: each suppressed subsystem is
 *   named, and each retained subsystem is named.
 * - Not an authentication change: every guard stays exactly as it is.
 * - Not a validation bypass: registry integrity and current-authority
 *   evaluation run unchanged.
 * - Not a fixture injector: nothing fabricates provider, registry or market
 *   state. A subsystem is either started or not started.
 * - Not usable in production: `NODE_ENV=production` refuses the mode outright,
 *   and the refusal terminates start-up before any provider contact or listener.
 *
 * SUPPRESSED (development proof mode only)
 * ----------------------------------------
 *   providerNetwork        Kite bootstrap + warm-up, Yahoo, Binance, Upstox,
 *                          IndianAPI, NSE/BSE downloads, news/RSS warm-ups
 *   webSockets             Kite ticker construction (no socket is created)
 *   subscriptions          quote subscribe / unsubscribe
 *   marketSchedulers       every staggered boot job, scanner sweeps, readiness,
 *                          swing scan, EOD/report/lifecycle ticks, monitors
 *   ingestors              option-chain snapshot ingestor, candle warehouse
 *   outboundNotifications  Telegram bot long-poll and outbound delivery jobs
 *
 * RETAINED (unchanged behaviour)
 * ------------------------------
 *   normal application construction and middleware, production-config
 *   validation, the development database connection, read-only Schema-5
 *   registry restoration (`registryRestore`), integrity verification,
 *   current-time authority evaluation, the coverage bridge, market-data health,
 *   authentication, the owner-only registry health endpoint, and the HTTP
 *   listener (`httpListener`).
 *
 * Default/unset behaviour is byte-for-byte the previous behaviour: every
 * capability is permitted and no suppression branch is taken.
 */

import { logger } from "./logger.js";

export const BOOT_PROOF_ENV_VAR = "DATA_FOUNDATION_BOOT_PROOF";

/** The one value that enables the mode. Anything else — including "true",
 *  "yes", "0", "" — leaves the mode off. Vague truthiness is how a probe flag
 *  ends up on by accident. */
export const BOOT_PROOF_ENABLED_VALUE = "1";

/** Stable machine-readable code emitted when the mode is refused. */
export const BOOT_PROOF_FORBIDDEN_CODE = "BOOT_PROOF_MODE_FORBIDDEN_IN_PRODUCTION";

export type BootCapabilityName =
  | "providerNetwork"
  | "webSockets"
  | "subscriptions"
  | "marketSchedulers"
  | "ingestors"
  | "outboundNotifications"
  | "registryRestore"
  | "httpListener";

export type BootCapabilities = Record<BootCapabilityName, boolean>;

export type EnvLike = Record<string, string | undefined>;

const ALL_PERMITTED: BootCapabilities = Object.freeze({
  providerNetwork: true,
  webSockets: true,
  subscriptions: true,
  marketSchedulers: true,
  ingestors: true,
  outboundNotifications: true,
  registryRestore: true,
  httpListener: true,
});

const PROOF_MODE_CAPABILITIES: BootCapabilities = Object.freeze({
  providerNetwork: false,
  webSockets: false,
  subscriptions: false,
  marketSchedulers: false,
  ingestors: false,
  outboundNotifications: false,
  // Retained on purpose — restoring the registry IS the thing under observation.
  registryRestore: true,
  // Retained on purpose — the owner-only diagnostics endpoint must be callable.
  httpListener: true,
});

function isProductionEnv(env: EnvLike): boolean {
  return env["NODE_ENV"] === "production";
}

/**
 * True only when the exact approved value is set AND this is not production.
 *
 * The production term is deliberate: even if `assertBootProofModeAllowed()`
 * were somehow skipped, no suppression branch can be taken in production, so a
 * stray environment variable can never silently disable production providers.
 */
export function isDataFoundationBootProofMode(env: EnvLike = process.env): boolean {
  return env[BOOT_PROOF_ENV_VAR] === BOOT_PROOF_ENABLED_VALUE && !isProductionEnv(env);
}

export class BootProofModeForbiddenError extends Error {
  readonly code = BOOT_PROOF_FORBIDDEN_CODE;
  constructor() {
    super(
      `${BOOT_PROOF_FORBIDDEN_CODE}: ${BOOT_PROOF_ENV_VAR}=${BOOT_PROOF_ENABLED_VALUE} is a development-only verification mode and must never be set with NODE_ENV=production.`,
    );
    this.name = "BootProofModeForbiddenError";
  }
}

/**
 * Refuse the mode in production. Call this at the very top of start-up, before
 * the application module (and therefore before any provider import-time side
 * effect) is loaded, so the process terminates without contacting a provider
 * and without opening a listener.
 */
export function assertBootProofModeAllowed(env: EnvLike = process.env): void {
  if (env[BOOT_PROOF_ENV_VAR] === BOOT_PROOF_ENABLED_VALUE && isProductionEnv(env)) {
    throw new BootProofModeForbiddenError();
  }
}

/** The capability set this process is booting with. */
export function getBootCapabilities(env: EnvLike = process.env): BootCapabilities {
  return isDataFoundationBootProofMode(env) ? PROOF_MODE_CAPABILITIES : ALL_PERMITTED;
}

export interface SuppressedBootSideEffect {
  subsystem: string;
  capability: BootCapabilityName;
  at: string;
}

const _suppressed: SuppressedBootSideEffect[] = [];

/** Read-only view of what this process declined to start, for boot evidence. */
export function getSuppressedBootSideEffects(): readonly SuppressedBootSideEffect[] {
  return _suppressed.slice();
}

/** Test-only reset. Never called by production code. */
export function _resetSuppressedBootSideEffectsForTest(): void {
  _suppressed.length = 0;
}

/**
 * Run `fn` only when `capability` is permitted; otherwise record and log one
 * safe structured event naming the subsystem that was intentionally not
 * started. No credentials, no payloads, no provider state.
 */
export function runIfCapable<T>(
  subsystem: string,
  capability: BootCapabilityName,
  fn: () => T,
  env: EnvLike = process.env,
): T | undefined {
  if (getBootCapabilities(env)[capability]) return fn();
  const entry: SuppressedBootSideEffect = {
    subsystem,
    capability,
    at: new Date().toISOString(),
  };
  _suppressed.push(entry);
  logger.info(
    {
      subsystem,
      capability,
      bootMode: "DATA_FOUNDATION_BOOT_PROOF",
      diagnosticEvent: "BOOT_SIDE_EFFECT_SUPPRESSED",
    },
    `Boot proof mode: ${subsystem} intentionally not started (${capability} suppressed)`,
  );
  return undefined;
}
