/**
 * AUTHORITATIVE REGISTRY REFRESH AUTHORIZATION — PHASE 0.8D
 *
 * A refresh downloads six official exchange sources, rebuilds the Schema-5
 * instrument universe and commits a new generation to PostgreSQL. That is a
 * real-world, externally-visible, database-mutating operation, so it gets its
 * own compile-time authorization rather than borrowing anyone else's.
 *
 * WHY THIS IS A SEPARATE LOCK.
 *
 * It would be convenient to hang this off `FEED_RUNTIME_ACTIVATION_AUTHORIZED`
 * or one of the four trading locks. That would be wrong in both directions:
 *
 *  - Refreshing reference data does not activate a feed, place an order or
 *    evaluate a strategy. Requiring the feed lock to refresh the registry would
 *    mean the only way to update instrument reference data is to also authorize
 *    live market data — coupling two decisions that have different risk and
 *    different timing.
 *  - Conversely, authorizing a refresh must never imply that anything may
 *    trade. Sharing a constant makes that implication structural, and a future
 *    edit that flips one lock silently flips the other.
 *
 * So authorization is one decision per real-world consequence. This constant
 * governs exactly one thing: whether the refresh orchestrator is permitted to
 * touch a source, a clock-sensitive authority or the database at all.
 *
 * DEFAULT IS FALSE AND MUST STAY FALSE until the owner authorizes a real
 * refresh. While it is false, the orchestrator refuses BEFORE any port is
 * called — not after fetching and then discarding, which would still hit the
 * exchanges.
 *
 * NO HTTP ROUTE MAY FLIP THIS. It is a compile-time constant, not
 * configuration, not an environment variable and not a database row, because
 * an operation that rebuilds the authoritative universe should require a code
 * change and a review, not a request.
 */
export const AUTHORITATIVE_REGISTRY_REFRESH_AUTHORIZED = false as boolean;

/**
 * Stable identifier for the authorization decision, used in audit records and
 * owner diagnostics so a refusal names the gate that produced it.
 */
export const REGISTRY_REFRESH_AUTHORIZATION_ID =
  "AUTHORITATIVE_REGISTRY_REFRESH_AUTHORIZED" as const;
