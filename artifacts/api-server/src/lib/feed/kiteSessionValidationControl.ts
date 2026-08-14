/**
 * KITE SESSION VALIDATION AUTHORIZATION — PHASE 0.8D
 *
 * Validating a Kite session means making a real authenticated REST call to the
 * broker with the owner's live access token. It is cheap and read-only, but it
 * is still a genuine provider call against a production trading account, so it
 * gets its own compile-time authorization.
 *
 * WHY THIS IS SEPARATE FROM BOTH THE FEED LOCK AND THE REFRESH LOCK.
 *
 * Validation is the operation that PROVES a session before anything is
 * activated. If it shared `FEED_RUNTIME_ACTIVATION_AUTHORIZED`, proving the
 * session would require first authorizing the very activation the proof is
 * supposed to gate — the check would come after the decision it informs.
 * It is equally unrelated to registry refresh, which touches no provider
 * session at all.
 *
 * DEFAULT IS FALSE AND MUST STAY FALSE in this phase. While false, the adapter
 * refuses before reading credential material and before constructing any
 * client, so no token is decrypted and no request is issued.
 *
 * NO HTTP ROUTE MAY FLIP THIS, and no route may accept credentials or a
 * validation result from a caller: evidence has exactly one legitimate origin,
 * which is this adapter running against the real provider.
 */
export const KITE_SESSION_VALIDATION_AUTHORIZED = false as boolean;

/** Stable identifier used in audit records and owner diagnostics. */
export const KITE_SESSION_VALIDATION_AUTHORIZATION_ID =
  "KITE_SESSION_VALIDATION_AUTHORIZED" as const;

/**
 * The single approved authenticated REST operation used to prove a session.
 *
 * `getProfile()` is the cheapest authoritative call in the installed
 * KiteConnect v5 contract that both (a) requires a valid access token and
 * (b) returns the account identity (`user_id`) needed to prove the token
 * belongs to the EXPECTED account rather than merely being well-formed.
 *
 * Order, margin and holdings endpoints would also authenticate, but they carry
 * position and balance data this operation has no business reading, and
 * `getMargins` additionally varies by segment. Profile is the minimum that
 * answers the question.
 */
export const APPROVED_KITE_VALIDATION_OPERATION = "KITE_REST_GET_PROFILE" as const;
