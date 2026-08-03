/**
 * Pure, side-effect-free production configuration validator.
 *
 * ZERO imports from routes, schedulers, providers, DB, or any module that
 * has side-effects. Safe to import in complete isolation from the application.
 *
 * This is the single source of truth for production startup requirements.
 * Called by:
 *   - The real server bootstrap (index.ts) before app.ts is imported.
 *   - app.ts module body as a secondary defence (catches dev-server restarts).
 *   - Test probes via src/probe/configBootstrapProbe.ts.
 *
 * Error ordering is deterministic: SESSION_SECRET is checked first, then CORS.
 * All subsequent checks (if any are added) must be appended after those two.
 */

// ---------------------------------------------------------------------------
// Stable error codes
// ---------------------------------------------------------------------------

export const PROD_CONFIG_CODES = {
  SESSION_SECRET_MISSING: "PROD_CONFIG_INVALID:SESSION_SECRET_MISSING",
  SESSION_SECRET_WEAK:    "PROD_CONFIG_INVALID:SESSION_SECRET_WEAK",
  CORS_WILDCARD:          "PROD_CONFIG_INVALID:CORS_WILDCARD",
} as const;

export type ProdConfigCode = (typeof PROD_CONFIG_CODES)[keyof typeof PROD_CONFIG_CODES];

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface ProdConfigError {
  /** Stable machine-readable code. Never contains secret values. */
  code: ProdConfigCode;
  /**
   * Human-readable description of the requirement that failed.
   * MUST NOT include secret values or anything derived from secret values.
   * May name the environment variable (its NAME, not its value).
   */
  message: string;
}

export interface ProdConfigResult {
  valid: boolean;
  /** Empty array when valid === true. Ordered: SESSION_SECRET first, CORS second. */
  errors: ProdConfigError[];
}

// ---------------------------------------------------------------------------
// Policy constants
// ---------------------------------------------------------------------------

/** Minimum length enforced on SESSION_SECRET when NODE_ENV=production. */
const MIN_SESSION_SECRET_LEN = 20;

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validate production-critical environment configuration.
 *
 * Pure function: accepts an explicit env object, performs no I/O, starts no
 * servers, opens no DB connections, logs nothing, and has no other side
 * effects.  Returns a structured result with stable codes and safe messages.
 *
 * Called once at server bootstrap (index.ts) BEFORE app.ts is imported, so
 * that routes, schedulers, and providers are never initialized on invalid
 * configuration.
 *
 * @param env   Explicit environment record (pass `process.env` in production).
 *              Tests pass a strict allowlist of fake values.
 */
export function validateProductionConfig(env: NodeJS.ProcessEnv): ProdConfigResult {
  const errors: ProdConfigError[] = [];
  const isProd = env["NODE_ENV"] === "production";

  // ------------------------------------------------------------------
  // 1. SESSION_SECRET — required in EVERY environment (not just prod).
  //    Without it the cookie-parser cannot sign/verify session cookies.
  // ------------------------------------------------------------------
  const sessionSecret = env["SESSION_SECRET"];
  if (!sessionSecret) {
    errors.push({
      code:    PROD_CONFIG_CODES.SESSION_SECRET_MISSING,
      message: "SESSION_SECRET env var is absent or empty. " +
               "It is required to sign session cookies. Set a strong random value.",
    });
  } else if (isProd && sessionSecret.length < MIN_SESSION_SECRET_LEN) {
    errors.push({
      code:    PROD_CONFIG_CODES.SESSION_SECRET_WEAK,
      message: `SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LEN} characters ` +
               "in production. The current value is too short.",
    });
  }

  // ------------------------------------------------------------------
  // 2. CORS wildcard — forbidden in production.
  //    CORS_ORIGINS=* with credentials is the broad-CORS antipattern.
  //    A malicious site can trick browsers into reading authenticated data.
  // ------------------------------------------------------------------
  const corsOriginsRaw = (env["CORS_ORIGINS"] ?? "").trim();
  if (isProd && corsOriginsRaw === "*") {
    errors.push({
      code:    PROD_CONFIG_CODES.CORS_WILDCARD,
      message: 'CORS_ORIGINS="*" is not allowed in production (NODE_ENV=production). ' +
               "Set a comma-separated list of explicit allowed origins, or unset for same-origin only.",
    });
  }

  return { valid: errors.length === 0, errors };
}
