/**
 * PHASE 0.8D — EXPECTED KITE ACCOUNT IDENTITY
 *
 * The one input the Kite validation production composition could not find an
 * existing home for.
 *
 * WHY THIS IS NOT READ FROM THE STORED SESSION
 *
 * `kite_session.userId` exists, and using it would make this file unnecessary.
 * It is also worthless as an expectation, because it is written from the
 * provider's own login response. Comparing `getProfile().user_id` against a
 * value the same provider supplied at login is a tautology: it agrees with
 * itself by construction. The account-identity gate exists to catch the one
 * genuinely dangerous success — a 200 that resolves to an account the owner
 * did not intend — and a self-referential comparison cannot catch it.
 *
 * So the expectation must come from OUTSIDE the provider: the owner states
 * which account this deployment is allowed to trade, and the provider is
 * checked against that statement.
 *
 * FAIL-CLOSED WHEN UNCONFIGURED
 *
 * No such owner configuration exists in this project yet. Rather than invent a
 * fallback, this reader refuses. With the value unset the validator cannot
 * reach the provider at all, so the missing configuration can never be mistaken
 * for a passing identity check. Setting it is an owner action, listed in the
 * Phase 0.8D report as a prerequisite for ever authorizing the operation.
 *
 * The value is an account identifier, so it is never logged, never serialized
 * into diagnostics and never placed in an evidence record — only the boolean
 * "configured" is observable.
 */

/** Owner-supplied expected Kite account. Absent by default. */
export const KITE_EXPECTED_ACCOUNT_ENV_VAR = "KITE_EXPECTED_USER_ID";

export const KITE_EXPECTED_ACCOUNT_REASON = Object.freeze({
  NOT_CONFIGURED: "EXPECTED_KITE_ACCOUNT_NOT_CONFIGURED",
  MALFORMED: "EXPECTED_KITE_ACCOUNT_MALFORMED",
} as const);

export type ExpectedKiteAccountResolution =
  | { readonly ok: true; readonly expectedUserId: string }
  | { readonly ok: false; readonly reasonCode: string };

/**
 * Kite client ids are short uppercase alphanumeric codes. The shape check is
 * deliberately strict: a stray quote, whitespace or a shell-expanded empty
 * string must fail loudly here rather than silently never matching a real
 * profile later.
 */
const CLIENT_ID_PATTERN = /^[A-Z0-9]{3,24}$/;

export function resolveExpectedKiteAccountId(
  env: NodeJS.ProcessEnv = process.env,
): ExpectedKiteAccountResolution {
  const raw = env[KITE_EXPECTED_ACCOUNT_ENV_VAR];
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, reasonCode: KITE_EXPECTED_ACCOUNT_REASON.NOT_CONFIGURED };
  }
  const value = raw.trim();
  if (!CLIENT_ID_PATTERN.test(value)) {
    return { ok: false, reasonCode: KITE_EXPECTED_ACCOUNT_REASON.MALFORMED };
  }
  return { ok: true, expectedUserId: value };
}

/** Safe for diagnostics: reports presence, never the identifier itself. */
export function isExpectedKiteAccountConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveExpectedKiteAccountId(env).ok;
}
