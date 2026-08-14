/**
 * Safe-diagnostic redaction — Phase 0.8E.
 *
 * WHY THIS EXISTS
 * ---------------
 * The Phase 0.8E proof serializer used a substring rule: blank any key matching
 * /token/i. That rule was WRONG in both directions.
 *
 *   - It was too greedy. The SAFE domain field "tokenReconciliation" (a coded
 *     reconciliation STATE with no credential in it) was destroyed, hiding a
 *     legitimate operator signal.
 *   - It was too weak. A substring match on the KEY does nothing about a
 *     credential that arrives in a VALUE ("Bearer eyJ…", "https://u:p@host",
 *     "?access_token=…"), which is where leaks actually happen.
 *
 * The owner requires a STRUCTURED replacement that lives in durable source, not
 * a throwaway harness. This module is that replacement. It is:
 *
 *   - PURE. No IO, no module-scope side effects, no clock, no network, no DB.
 *   - KEY-AWARE. An explicit DENY set of credential-bearing key names, matched
 *     after normalisation (case / underscore / hyphen / camelCase folded away),
 *     so `apiKey`, `api_key`, `API-KEY` all hit the same rule.
 *   - ALLOW-AWARE. An explicit ALLOW set of SAFE domain keys that must survive
 *     verbatim even though their NAME resembles a denied substring
 *     (`tokenReconciliation` contains "token"). The allow set beats substring
 *     resemblance but NEVER beats an exact deny-set hit — a key that is BOTH an
 *     exact deny match and an allow match is redacted, fail-closed.
 *   - VALUE-AWARE. Independently of the key name, string values that look like a
 *     credential are redacted: bearer/authorization header values, URLs with
 *     userinfo credentials, and URLs carrying an obvious credential query
 *     parameter (the parameter VALUE is redacted; the rest of the URL survives
 *     so the source identity stays reportable).
 *   - DEFENSIVE. Recursion depth and array length are bounded because the input
 *     can be adversarial (cyclic, deeply nested, million-element arrays), and
 *     the walk never throws — the whole point is to make a payload safe to emit,
 *     so a hostile input must degrade to a marker, not to an exception.
 *
 * The output is DETERMINISTIC and uses stable markers so proofs are stable
 * across runs.
 */

// ── stable markers ────────────────────────────────────────────────────────────

/** Replaces a redacted VALUE (a credential-shaped value, or a denied key's value). */
export const REDACTED_VALUE_MARKER = "[REDACTED]";
/** Replaces the value at a DENIED KEY so the reader can tell key-deny from value-deny. */
export const REDACTED_KEY_MARKER = "[REDACTED_KEY]";

// ── defensive bounds ──────────────────────────────────────────────────────────
//
// These are deliberately generous for real diagnostics but finite so a hostile
// or accidentally-huge payload cannot make the walk run away. Exceeding a bound
// is not an error: it collapses to a marker, because a safe-but-truncated proof
// is strictly better than an unbounded walk or a thrown serializer.

/** Deepest object/array nesting we will descend before collapsing to a marker. */
export const MAX_DEPTH = 24;
/** Longest array we will walk element-by-element before collapsing to a marker. */
export const MAX_ARRAY_LENGTH = 5_000;
/** Marker emitted when a bound is exceeded. Distinct so the reader knows WHY. */
export const TRUNCATED_MARKER = "[REDACTED_TRUNCATED]";

// ── key normalisation ─────────────────────────────────────────────────────────

/**
 * Fold a key to a comparison form: lowercase with separators removed, so
 * `access_token`, `accessToken`, `Access-Token` and `ACCESSTOKEN` all normalise
 * to `accesstoken`. This is what makes the DENY/ALLOW tables case /
 * underscore / hyphen / camelCase insensitive without a per-variant list.
 */
function normalizeKey(key: string): string {
  return key.replace(/[_\-\s]/g, "").toLowerCase();
}

// ── DENY set: credential-bearing key names (EXACT, after normalisation) ────────
//
// An exact normalised hit here is redacted unconditionally — the allow set can
// never rescue it. These are names whose VALUE is, by definition, a credential.
const DENY_KEYS: ReadonlySet<string> = new Set(
  [
    "apiKey",
    "api_key",
    "accessToken",
    "access_token",
    "requestToken",
    "request_token",
    "refreshToken",
    "publicToken",
    "secret",
    "apiSecret",
    "password",
    "cookie",
    "setCookie",
    "authorization",
    "authHeader",
    "bearer",
    "credential",
    "credentials",
    "privateKey",
    "sessionToken",
    "encryptionKey",
  ].map(normalizeKey),
);

// ── ALLOW set: SAFE domain key names that must SURVIVE verbatim ────────────────
//
// These names contain a denied SUBSTRING ("token") but are coded domain state,
// not credentials. The allow set beats the substring heuristic below. It does
// NOT — and must not — beat an EXACT deny hit; see the ordering in redactKey().
const ALLOW_KEYS: ReadonlySet<string> = new Set(
  [
    "tokenReconciliation",
    "providerInstrumentTokenCount",
    "tokenReconciliationState",
    "instrumentTokenCount",
    "tokenCount",
  ].map(normalizeKey),
);

// ── substring heuristic: names that merely LOOK credential-shaped ─────────────
//
// A key that is not an exact deny hit and not an allow entry, but whose
// normalised form CONTAINS one of these fragments, is treated as suspect and
// redacted. This catches `xApiKeyHeader`, `userAccessTokenV2` and friends that
// no finite exact list would enumerate. `token` is intentionally here — that is
// exactly why the ALLOW set exists, to carve `tokenReconciliation` back out.
const SUSPECT_KEY_FRAGMENTS: readonly string[] = [
  "token",
  "secret",
  "password",
  "passwd",
  "apikey",
  "credential",
  "authorization",
  "cookie",
  "privatekey",
  "bearer",
  "encryptionkey",
];

type KeyVerdict = "DENY_KEY" | "REDACT_VALUE" | "KEEP";

/**
 * Decide how a key is treated. Ordering is the whole safety argument:
 *
 *   1. EXACT deny hit  → DENY_KEY. Nothing overrides this (fail-closed).
 *   2. ALLOW hit       → KEEP. Wins over the substring heuristic below.
 *   3. suspect fragment → REDACT_VALUE. Looks credential-shaped, redact value.
 *   4. otherwise       → KEEP.
 */
function redactKey(rawKey: string): KeyVerdict {
  const norm = normalizeKey(rawKey);
  // (1) An exact deny hit is redacted no matter what — even if it is ALSO in the
  // allow set. A conflicting name is a mistake that must resolve to "redact".
  if (DENY_KEYS.has(norm)) return "DENY_KEY";
  // (2) Explicit safe domain key: survive verbatim regardless of resemblance.
  if (ALLOW_KEYS.has(norm)) return "KEEP";
  // (3) Not exact, not allow-listed, but looks like a credential holder.
  for (const fragment of SUSPECT_KEY_FRAGMENTS) {
    if (norm.includes(fragment)) return "REDACT_VALUE";
  }
  return "KEEP";
}

// ── value scanning: credential-shaped STRING values ───────────────────────────

/**
 * A bearer / authorization header value: `Bearer <opaque>` or `Basic <opaque>`
 * (also plain `Authorization: Bearer …` forms). The whole value is a credential
 * once it carries such a scheme, so the whole value is redacted.
 */
const BEARER_VALUE_RE = /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{4,}/i;

/**
 * A URL with userinfo credentials: `scheme://user:pass@host…`. Only the
 * userinfo component is a credential; the host/path/query are identity we WANT
 * to keep reportable, so we surgically replace just the `user:pass` part.
 */
const URL_USERINFO_RE = /^([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/i;

/**
 * Credential-bearing query parameters. We redact the VALUE and keep the key and
 * the rest of the URL, so the source identity (host + path) stays reportable.
 * Matched loosely on `key=value` fragments anywhere in the string, so it works
 * on bare query strings as well as full URLs.
 */
const QUERY_CREDENTIAL_RE =
  /((?:api[_-]?key|access[_-]?token|request[_-]?token|refresh[_-]?token|session[_-]?token|auth|token|password|secret)=)([^&\s#]+)/gi;

/**
 * Redact credential-shaped content out of a STRING value, independent of its
 * key. Returns the (possibly rewritten) string, or the full-value marker when
 * the entire value is a credential. Never throws.
 */
function redactStringValue(value: string): string {
  // Whole-value credential: a bearer/basic header value carries nothing else
  // worth keeping, so collapse the entire string.
  if (BEARER_VALUE_RE.test(value)) return REDACTED_VALUE_MARKER;

  let out = value;

  // Surgically strip userinfo credentials from a URL, keeping scheme + host.
  out = out.replace(URL_USERINFO_RE, (_m, scheme: string) => `${scheme}${REDACTED_VALUE_MARKER}@`);

  // Redact credential query-parameter VALUES, keeping the parameter name and the
  // surrounding URL so the source identity remains visible.
  out = out.replace(QUERY_CREDENTIAL_RE, (_m, keyEq: string) => `${keyEq}${REDACTED_VALUE_MARKER}`);

  return out;
}

// ── the deep walk ─────────────────────────────────────────────────────────────

/**
 * Deep-walk a JSON-ish value and return a redacted COPY. Pure; never mutates the
 * input; never throws. `seen` breaks cycles; `depth` bounds recursion.
 *
 * `keyRedactsValueWholesale` means the CURRENT value sits under a denied key —
 * so an array here is replaced WHOLESALE (not element-by-element), which is how
 * we guarantee a denied key holding a token/identity LIST never leaks a single
 * element.
 */
function walk(
  value: unknown,
  depth: number,
  seen: WeakSet<object>,
  keyRedactsValueWholesale: boolean,
): unknown {
  // A denied key's value is never inspected — it is replaced wholesale. This is
  // what stops element-by-element leakage out of a denied array or object.
  if (keyRedactsValueWholesale) return REDACTED_VALUE_MARKER;

  // Depth bound: collapse rather than recurse into an adversarial nest.
  if (depth > MAX_DEPTH) return TRUNCATED_MARKER;

  // Primitives.
  if (value === null) return null;
  const t = typeof value;
  if (t === "string") return redactStringValue(value as string);
  if (t === "number" || t === "boolean") return value;
  if (t === "bigint") return `${(value as bigint).toString()}n`;
  // Functions, symbols and undefined are not JSON; drop to a marker rather than
  // emitting something a serializer would choke on or silently omit.
  if (t === "function" || t === "symbol" || t === "undefined") return REDACTED_VALUE_MARKER;

  // From here `value` is an object or array. Break cycles.
  const obj = value as object;
  if (seen.has(obj)) return TRUNCATED_MARKER;
  seen.add(obj);

  try {
    if (Array.isArray(value)) {
      // Array-length bound: a hostile million-element array is collapsed.
      if (value.length > MAX_ARRAY_LENGTH) return TRUNCATED_MARKER;
      return value.map((el) => walk(el, depth + 1, seen, false));
    }

    // Some exotic objects (Date, Map, Set, class instances) are not plain
    // JSON. Normalise the ones that have a natural safe scalar form; treat the
    // rest as opaque containers we do not descend into.
    if (value instanceof Date) {
      return Number.isFinite(value.getTime()) ? value.toISOString() : REDACTED_VALUE_MARKER;
    }
    if (value instanceof Map || value instanceof Set) {
      // Maps/Sets can hold anything, including credential values keyed by
      // non-string keys the deny table cannot reason about — treat as opaque.
      return TRUNCATED_MARKER;
    }

    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    // Deterministic key order so proofs are byte-stable.
    const keys = Object.keys(source).sort();
    for (const key of keys) {
      const verdict = redactKey(key);
      if (verdict === "DENY_KEY") {
        // Denied key: mark the KEY's value and never look at what it held.
        result[key] = REDACTED_KEY_MARKER;
        continue;
      }
      // Read the property inside its own guard: a hostile/throwing GETTER must
      // collapse that ONE key to a marker, not abort the whole object walk.
      let child: unknown;
      try {
        child = source[key];
      } catch {
        result[key] = REDACTED_VALUE_MARKER;
        continue;
      }
      // For a suspect (but not exact-deny) key, redact its value wholesale via
      // the flag so an array/object underneath cannot leak element-by-element.
      result[key] = walk(child, depth + 1, seen, verdict === "REDACT_VALUE");
    }
    return result;
  } catch {
    // The contract is "make it safe to emit"; a thrown getter or an exotic
    // accessor must degrade to a marker, not blow up the serializer.
    return REDACTED_VALUE_MARKER;
  } finally {
    // Allow the same object to appear on sibling branches (shared, not cyclic).
    seen.delete(obj);
  }
}

/**
 * PURE. Deep-walk a JSON-ish value and return a redacted copy suitable for
 * owner-facing diagnostics/proof payloads. Never mutates its argument, never
 * performs IO, and never throws — a hostile input degrades to stable markers.
 */
export function redactForOwnerDiagnostics(value: unknown): unknown {
  return walk(value, 0, new WeakSet<object>(), false);
}
