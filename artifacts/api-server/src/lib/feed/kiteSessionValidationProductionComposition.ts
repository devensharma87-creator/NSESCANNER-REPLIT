/**
 * PHASE 0.8D — KITE SESSION VALIDATION: PRODUCTION COMPOSITION
 *
 * Binds the abstract Phase 0.8D validator to the real secret boundary, the
 * really-installed SDK and the one approved operation. Nothing here decides
 * whether a session is valid — that judgment, including the account-identity
 * comparison, stays in `kiteSessionValidationAdapter`.
 *
 * ORDER OF REFUSAL
 *
 *   1. `createKiteSessionValidator` reads `KITE_SESSION_VALIDATION_AUTHORIZED`
 *      and, when false, returns from `validateNow()` before touching a port.
 *   2. Every port here is lazy. Building the ports object performs no read: no
 *      secret, no database, no `import("kiteconnect")`.
 *   3. The SDK is imported dynamically INSIDE `probeProfile()`, so with
 *      authorization false the module is never even loaded, let alone
 *      constructed.
 *
 * That ordering is what makes the refusal free. A composition that read the
 * access token at construction time would have already moved a secret before
 * anyone asked whether it was allowed to.
 *
 * THE TOKEN NEVER LEAVES THE SECRET BOUNDARY
 *
 * `KiteSessionMaterialPort` returns a DESCRIPTOR — expiry plus expected
 * account — and no token. The token is read separately, inside the provider
 * port, used to construct one client, and discarded. It is never returned,
 * logged, hashed into diagnostics or written to the evidence record.
 */

import {
  KITE_SESSION_VALIDATION_AUTHORIZED,
  KITE_SESSION_VALIDATION_AUTHORIZATION_ID,
  APPROVED_KITE_VALIDATION_OPERATION,
} from "./kiteSessionValidationControl";
import {
  createKiteSessionValidator,
  type KiteProfileProbeOutcome,
  type KiteSessionDescriptor,
  type KiteSessionValidator,
  type KiteValidationPorts,
} from "./kiteSessionValidationAdapter";
import { resolveExpectedKiteAccountId, isExpectedKiteAccountConfigured } from "./kiteExpectedAccount";
// TYPE-ONLY, and deliberately so. `kiteAuth` statically imports `kiteconnect`
// (kiteAuth.ts) and `@workspace/db`; a value import here would drag the broker
// SDK into the process the moment this composition module is loaded — before
// any authorization check exists to stop it. Type imports are erased.
import type * as KiteAuthModule from "../kiteAuth";
import { logger } from "../logger";

/**
 * Matches the timeout every other production KiteConnect construction uses.
 * `kiteAuth` keeps its copy module-private, and the SDK has NO default
 * timeout — an unbounded client would hang this validation until the OS reset
 * the socket, which the adapter would then have to classify as a network
 * failure rather than the timeout it actually was.
 */
export const KITE_VALIDATION_HTTP_TIMEOUT_MS = 15_000;

export const KITE_VALIDATION_COMPOSITION_ID = "KITE_SESSION_VALIDATION_PRODUCTION_COMPOSITION_V1";

export const KITE_COMPOSITION_REASON = Object.freeze({
  EXPECTED_ACCOUNT_UNRESOLVED: "EXPECTED_KITE_ACCOUNT_UNRESOLVED",
  SESSION_ABSENT: "NO_STORED_KITE_SESSION",
  SESSION_VANISHED: "STORED_SESSION_DISAPPEARED_BEFORE_PROBE",
} as const);

// ── SDK seam ─────────────────────────────────────────────────────────────────

/** The narrow slice of the installed SDK this composition is allowed to use. */
export interface KiteProfileClient {
  setAccessToken(token: string): void;
  getProfile(): Promise<unknown>;
}

export interface KiteSdkModule {
  new (options: { api_key: string; timeout?: number }): KiteProfileClient;
}

/**
 * Dynamic import, deliberately not top-level.
 *
 * A static import would load and evaluate the SDK at module load — before any
 * authorization check exists to stop it, and in every test and boot path that
 * merely touches this file.
 */
async function loadInstalledKiteSdk(): Promise<KiteSdkModule> {
  const mod = (await import("kiteconnect")) as unknown as { KiteConnect: KiteSdkModule };
  return mod.KiteConnect;
}

// ── dependency seam ──────────────────────────────────────────────────────────

export interface ProductionKiteValidationDeps {
  /**
   * Loads the secret-owning session module ON DEMAND.
   *
   * This is a loader rather than a bound function for one reason: `kiteAuth`
   * statically imports the broker SDK, so a static binding would make importing
   * this composition equivalent to loading `kiteconnect`. Guard F16 in the 0.8B
   * suite forbids exactly that, and a TRANSITIVE static import defeats it just
   * as surely as a direct one.
   *
   * Identity is still provable: a test awaits the loader and compares the
   * resolved `getActiveSession` against the accepted export.
   */
  readonly loadSessionModule: () => Promise<typeof KiteAuthModule>;
  readonly resolveExpectedAccount: typeof resolveExpectedKiteAccountId;
  readonly loadSdk: () => Promise<KiteSdkModule>;
}

/**
 * The real bindings, by object identity, so a test can assert that production
 * points at the accepted functions rather than at look-alikes.
 */
export const PRODUCTION_KITE_VALIDATION_DEPS: ProductionKiteValidationDeps = Object.freeze({
  loadSessionModule: () => import("../kiteAuth"),
  resolveExpectedAccount: resolveExpectedKiteAccountId,
  loadSdk: loadInstalledKiteSdk,
});

// ── error classification ─────────────────────────────────────────────────────

function statusOf(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  for (const candidate of [e.status, e.statusCode, e.response?.status]) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
  }
  return null;
}

function codeOf(err: unknown): string {
  if (typeof err !== "object" || err === null) return "";
  const e = err as { error_type?: unknown; code?: unknown; name?: unknown };
  return [e.error_type, e.code, e.name].filter((v) => typeof v === "string").join("|");
}

/**
 * Map an SDK throw onto the adapter's already-defined states.
 *
 * The error object itself never escapes: Kite errors can carry the request
 * configuration, which includes the api_key and access_token query parameters.
 * Only the classification crosses this boundary.
 */
export function classifyKiteProbeError(err: unknown): KiteProfileProbeOutcome {
  const status = statusOf(err);
  const code = codeOf(err).toUpperCase();

  if (
    code.includes("TOKENEXCEPTION") ||
    code.includes("PERMISSIONEXCEPTION") ||
    status === 401 ||
    status === 403
  ) {
    return { kind: "AUTH_REJECTED" };
  }
  if (status === 429 || code.includes("TOOMANYREQUESTS") || code.includes("RATELIMIT")) {
    return { kind: "TRANSPORT_FAILURE", classification: "RATE_LIMITED" };
  }
  if (status !== null && status >= 500) {
    return { kind: "TRANSPORT_FAILURE", classification: "SERVER_ERROR" };
  }
  if (
    code.includes("ECONNABORTED") ||
    code.includes("ETIMEDOUT") ||
    code.includes("TIMEOUT") ||
    code.includes("ABORTERROR")
  ) {
    return { kind: "TRANSPORT_FAILURE", classification: "TIMEOUT" };
  }
  // Anything unrecognised is a transport failure, never an auth rejection.
  // Guessing "the token is bad" from an unclassified error would revoke valid
  // evidence on a transient fault.
  return { kind: "TRANSPORT_FAILURE", classification: "NETWORK" };
}

// ── ports ────────────────────────────────────────────────────────────────────

export function buildProductionKiteValidationPorts(
  deps: ProductionKiteValidationDeps,
): KiteValidationPorts {
  return {
    clock: { nowMs: () => Date.now() },

    material: {
      async readSessionDescriptor(): Promise<KiteSessionDescriptor | null> {
        // The owner's statement of WHICH account is checked first, because a
        // validation that cannot say what "correct" means must not proceed to
        // ask a provider anything.
        const expected = deps.resolveExpectedAccount();
        if (!expected.ok) {
          throw new Error(
            `${KITE_COMPOSITION_REASON.EXPECTED_ACCOUNT_UNRESOLVED}:${expected.reasonCode}`,
          );
        }
        const { getActiveSession } = await deps.loadSessionModule();
        const session = await getActiveSession();
        if (session === null) return null;
        return {
          expectedUserId: expected.expectedUserId,
          // Inherited from the session's own login-stamped 06:00-IST boundary.
          // Evidence must never outlive the thing it describes.
          sessionExpiresAtMs: session.expiresAt.getTime(),
        };
      },
    },

    provider: {
      async probeProfile(): Promise<KiteProfileProbeOutcome> {
        const { getActiveSession } = await deps.loadSessionModule();
        const session = await getActiveSession();
        if (session === null) {
          // Present a moment ago, gone now. Fail closed as a transport failure
          // rather than an auth rejection: nothing was rejected, so there is no
          // evidence against the token.
          return { kind: "TRANSPORT_FAILURE", classification: "NETWORK" };
        }

        const KiteConnect = await deps.loadSdk();
        const client = new KiteConnect({
          api_key: session.apiKey,
          timeout: KITE_VALIDATION_HTTP_TIMEOUT_MS,
        });
        client.setAccessToken(session.accessToken);

        try {
          const profile = await client.getProfile();
          // Read exactly one field. The profile body carries email, phone and
          // broker metadata that must not travel further.
          const userId =
            typeof profile === "object" && profile !== null
              ? (profile as { user_id?: unknown }).user_id
              : undefined;
          return { kind: "PROFILE", userId };
        } catch (err) {
          return classifyKiteProbeError(err);
        }
      },
    },

    audit: {
      record(event): void {
        try {
          logger.info(
            {
              diagnosticEvent: "KITE_SESSION_VALIDATION",
              compositionId: KITE_VALIDATION_COMPOSITION_ID,
              operation: event.operation,
              outcome: event.outcome,
              reasonCode: event.reasonCode,
              providerCalled: event.providerCalled,
              atMs: event.atMs,
            },
            "Kite session validation",
          );
        } catch {
          // The adapter calls this sink without a catch. A throwing logger must
          // never turn a completed validation into a rejected promise — the
          // outcome has already been decided by the time we get here.
        }
      },
    },
  };
}

// ── factories ────────────────────────────────────────────────────────────────

/**
 * The production entry point. Takes no arguments ON PURPOSE: an override
 * parameter here would be a supported way to swap the authorization-bearing
 * adapter or the SDK seam in a running deployment.
 */
export function createProductionKiteSessionValidator(): KiteSessionValidator {
  return createKiteSessionValidator(
    buildProductionKiteValidationPorts(PRODUCTION_KITE_VALIDATION_DEPS),
  );
}

/*
 * There is deliberately NO authorized factory in this module.
 *
 * `buildProductionKiteValidationPorts` is exported so a test can wire the real
 * ports over a mocked SDK and hand them to the adapter's own test-only
 * authorized factory. Keeping that last step in the test file means no
 * production module — not even behind a `__TEST_ONLY_` name — holds a reference
 * to an authorization bypass.
 */

// ── readiness (pure) ─────────────────────────────────────────────────────────

export interface KiteValidationCompositionReadiness {
  readonly compositionId: string;
  readonly state: "DISABLED" | "READY";
  readonly governingLockId: string;
  readonly authorized: boolean;
  readonly approvedOperation: typeof APPROVED_KITE_VALIDATION_OPERATION;
  readonly credentialsConfigured: boolean;
  readonly expectedAccountConfigured: boolean;
  readonly executionRouteExposed: false;
  readonly schedulerRegistered: false;
  readonly blockers: readonly string[];
}

/**
 * Presence probe for the broker credentials.
 *
 * Deliberately NOT `getKiteCreds()` from `kiteAuth`: importing that module
 * statically would load the broker SDK (see the type-only import at the top of
 * this file). What is duplicated here is an environment PRESENCE test, not
 * policy — no credential is parsed, validated, retained or returned, and no
 * decision other than a diagnostic blocker string depends on it.
 */
function areKiteCredentialsConfigured(): boolean {
  return (
    (process.env["KITE_API_KEY"]?.trim() ?? "").length > 0 &&
    (process.env["KITE_API_SECRET"]?.trim() ?? "").length > 0
  );
}

/**
 * Pure description. Describing an operation must never be a way to start it.
 *
 * `credentialsConfigured` is a presence test only: no secret value is read into
 * the result, retained, returned or logged.
 */
export function describeProductionKiteValidationReadiness(): KiteValidationCompositionReadiness {
  const credentialsConfigured = areKiteCredentialsConfigured();
  const expectedAccountConfigured = isExpectedKiteAccountConfigured();

  const blockers: string[] = [];
  if (!KITE_SESSION_VALIDATION_AUTHORIZED) blockers.push("KITE_SESSION_VALIDATION_NOT_AUTHORIZED");
  if (!credentialsConfigured) blockers.push("KITE_CREDENTIALS_NOT_CONFIGURED");
  if (!expectedAccountConfigured) blockers.push("EXPECTED_KITE_ACCOUNT_NOT_CONFIGURED");

  return Object.freeze({
    compositionId: KITE_VALIDATION_COMPOSITION_ID,
    state: KITE_SESSION_VALIDATION_AUTHORIZED ? "READY" : "DISABLED",
    governingLockId: KITE_SESSION_VALIDATION_AUTHORIZATION_ID,
    authorized: KITE_SESSION_VALIDATION_AUTHORIZED,
    approvedOperation: APPROVED_KITE_VALIDATION_OPERATION,
    credentialsConfigured,
    expectedAccountConfigured,
    executionRouteExposed: false,
    schedulerRegistered: false,
    blockers: Object.freeze(blockers),
  });
}
