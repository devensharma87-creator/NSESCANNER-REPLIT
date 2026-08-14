/**
 * PHASE 0.8D — BOUNDED OFFICIAL-SOURCE RETRIEVAL
 *
 * The transport half of the registry production composition: it turns an
 * approved exchange URL into raw bytes, and refuses everything else.
 *
 * WHY THIS MODULE EXISTS SEPARATELY
 *
 * The project had no general-purpose bounded HTTP helper. The two existing
 * exchange callers (`optionChain.ts`, `fnoBanList.ts`) each hand-roll headers
 * and an `AbortSignal.timeout`, and neither bounds the response SIZE or checks
 * where a redirect landed. Reference-data retrieval cannot inherit that: a
 * truncated or redirected body is precisely the failure that produces a
 * coherent, smaller, WRONG universe. So the limits below are declared
 * explicitly rather than left to the runtime's defaults.
 *
 * DISCLOSED CONSERVATIVE LIMITS (no prior project policy existed)
 *
 *   - timeout            20s per request, whole-response, via AbortSignal
 *   - max response size  32 MiB, enforced while streaming, not after
 *   - status             exactly 200; every other status is a failure
 *   - content type       per-request allowlist, prefix-matched
 *   - redirects          NOT followed by the runtime. Each hop is taken
 *                        explicitly, at most one per document, and every hop
 *                        target is re-validated (https, approved host, no
 *                        userinfo, no loop) before it is requested
 *   - body               must be non-empty
 *
 * PHASE 0.8E CORRECTION — A REDIRECT HOP IS A TRANSPORT REQUEST
 *
 * The previous revision used `redirect: "follow"`. That is not merely a style
 * choice: it makes the hop chain INVISIBLE. The runtime issues the extra
 * requests, so an aggregate ceiling expressed in "logical retrievals" silently
 * undercounts the real traffic sent to an exchange, and only the FINAL host is
 * ever checked — an approved host reached via an unapproved intermediary, or a
 * downgrade to http on an intermediate hop, both pass unnoticed.
 *
 * So hops are now taken by hand. Every request that leaves this process —
 * base document, redirect hop, or a discovered asset — is charged against a
 * caller-supplied `TransportBudget`, and the budget is checked BEFORE the
 * request is issued, never after.
 *
 * The size cap is enforced incrementally against the accumulated byte count.
 * Trusting `content-length` alone would let a server understate the body and
 * stream past the cap anyway.
 *
 * WHAT THIS MODULE DOES NOT DO
 *
 * It does not parse, classify, cache or persist. It returns bytes plus the
 * evidence needed to name them (final URL, retrieval instant, SHA-256 over the
 * RAW bytes). Parsing stays in the accepted `officialSources` /
 * `exchangeCalendarSources` modules.
 *
 * It performs NO module-scope IO. Nothing here runs until a caller invokes it,
 * and the only caller is the registry production composition, which is itself
 * gated behind `AUTHORITATIVE_REGISTRY_REFRESH_AUTHORIZED`.
 */

import { createHash } from "node:crypto";

// ── disclosed policy ─────────────────────────────────────────────────────────

export const RETRIEVAL_TIMEOUT_MS = 20_000;
export const RETRIEVAL_MAX_BYTES = 32 * 1024 * 1024;

/**
 * Hosts the registry composition is permitted to retrieve reference data from.
 *
 * A redirect that leaves this set is treated as a failure rather than followed
 * silently: an official-source hash is only meaningful if the bytes came from
 * the exchange, and "the URL we asked for" is not the same claim as "the host
 * that answered".
 */
export const APPROVED_SOURCE_HOSTS = Object.freeze([
  "nsearchives.nseindia.com",
  "www.nseindia.com",
  "api.bseindia.com",
  "www.bseindia.com",
  "api.kite.trade",
]);

export type BoundedRetrievalFailureCode =
  | "HOST_NOT_APPROVED"
  | "REDIRECTED_OFF_APPROVED_HOST"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "HTTP_STATUS_NOT_OK"
  | "CONTENT_TYPE_REJECTED"
  | "RESPONSE_TOO_LARGE"
  | "EMPTY_BODY"
  // ── Phase 0.8E redirect-policy and budget failures ────────────────────────
  | "MALFORMED_URL"
  | "INSECURE_TRANSPORT"
  | "CREDENTIALS_IN_URL"
  | "REDIRECT_WITHOUT_LOCATION"
  | "REDIRECT_LIMIT_EXCEEDED"
  | "REDIRECT_LOOP"
  | "TRANSPORT_BUDGET_EXCEEDED";

/**
 * One request that actually leaves this process.
 *
 * Kept distinct so the plan-versus-actual report can say WHICH kind of traffic
 * consumed the ceiling. "We made 13 requests" is not an answer to "why"; "10
 * base documents and 3 redirect hops" is.
 */
export type TransportHopKind = "BASE_DOCUMENT" | "REDIRECT_HOP" | "DISCOVERED_ASSET";

export interface TransportLedgerEntry {
  readonly sourceId: string;
  readonly hopKind: TransportHopKind;
  /** Host only. The full URL can carry query material; the host cannot. */
  readonly host: string;
}

/**
 * A hard, pre-charged ceiling on requests sent to the exchanges in one run.
 *
 * `charge()` returns false when the request WOULD exceed the ceiling — the
 * caller must then refuse without issuing it. Deliberately not a counter the
 * caller increments afterwards: a ceiling checked after the fact has already
 * been breached.
 */
export interface TransportBudget {
  readonly maxRequests: number;
  charge(sourceId: string, hopKind: TransportHopKind, url: string): boolean;
  readonly spent: number;
  ledger(): readonly TransportLedgerEntry[];
}

export function createTransportBudget(maxRequests: number): TransportBudget {
  const entries: TransportLedgerEntry[] = [];
  return {
    maxRequests,
    charge(sourceId, hopKind, url) {
      if (entries.length + 1 > maxRequests) return false;
      entries.push({ sourceId, hopKind, host: hostOf(url) ?? "UNPARSEABLE_HOST" });
      return true;
    },
    get spent() {
      return entries.length;
    },
    ledger() {
      return entries.slice();
    },
  };
}

/**
 * At most one hop per document.
 *
 * An exchange page legitimately redirects once (canonical host, trailing
 * slash). A chain longer than that is a captive portal, a bot-check bounce or
 * a loop — none of which serve authoritative bytes.
 */
export const MAX_REDIRECT_HOPS_PER_DOCUMENT = 1;

const REDIRECT_STATUSES = Object.freeze([301, 302, 303, 307, 308]);

export interface BoundedRetrievalRequest {
  readonly url: string;
  /** Prefix-matched against the response `content-type`, lowercased. */
  readonly allowedContentTypePrefixes: readonly string[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
  /**
   * When supplied, EVERY request (base document and each redirect hop) is
   * charged before it is issued. Optional only so the accepted Phase 0.8D
   * call sites keep compiling; the registry composition always supplies one.
   */
  readonly budget?: TransportBudget;
  /** Ledger label. Defaults to the host so an uncharged call is still named. */
  readonly sourceId?: string;
  /** Charged kind for the FIRST request. Hops are always REDIRECT_HOP. */
  readonly hopKind?: TransportHopKind;
  readonly maxRedirectHops?: number;
}

export type BoundedRetrievalResult =
  | {
      readonly ok: true;
      readonly requestedUrl: string;
      readonly finalUrl: string;
      readonly bytes: Buffer;
      readonly byteLength: number;
      /** SHA-256 over the raw bytes exactly as served, before any decoding. */
      readonly rawByteSha256: string;
      readonly contentType: string;
      readonly retrievedAtMs: number;
      /** Hops actually taken. 0 means the first request answered with 200. */
      readonly redirectHops: number;
      /** Requests this call sent, including hops. Always `redirectHops + 1`. */
      readonly transportRequests: number;
    }
  | {
      readonly ok: false;
      readonly requestedUrl: string;
      readonly reasonCode: BoundedRetrievalFailureCode;
      readonly retrievedAtMs: number;
      readonly redirectHops: number;
      readonly transportRequests: number;
    };

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Classify a thrown fetch error WITHOUT surfacing its message.
 *
 * Error text from a transport layer can carry the full request URL and, on
 * some runtimes, request headers. Since these codes travel into owner
 * diagnostics, only the classification escapes.
 */
function classifyThrown(err: unknown): "TIMEOUT" | "NETWORK_ERROR" {
  const name = typeof err === "object" && err !== null ? String((err as { name?: unknown }).name) : "";
  return name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR";
}

/**
 * Validate a URL we are ABOUT to request.
 *
 * Applied identically to the first URL and to every redirect target, because
 * "the exchange told us to go there" is not evidence that going there is safe.
 */
function validateTarget(
  url: string,
  isHop: boolean,
): { readonly ok: true; readonly parsed: URL } | { readonly ok: false; readonly code: BoundedRetrievalFailureCode } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, code: "MALFORMED_URL" };
  }
  // No downgrade, ever — not even on an intermediate hop whose body we discard.
  if (parsed.protocol !== "https:") return { ok: false, code: "INSECURE_TRANSPORT" };
  // Userinfo in a redirect target is a credential-injection shape, and it would
  // also travel into any URL we recorded as provenance.
  if (parsed.username !== "" || parsed.password !== "") {
    return { ok: false, code: "CREDENTIALS_IN_URL" };
  }
  if (!APPROVED_SOURCE_HOSTS.includes(parsed.host.toLowerCase())) {
    return { ok: false, code: isHop ? "REDIRECTED_OFF_APPROVED_HOST" : "HOST_NOT_APPROVED" };
  }
  return { ok: true, parsed };
}

/**
 * Retrieve one approved URL under the disclosed limits.
 *
 * Never throws for a transport or protocol failure — those are returned as
 * coded results so the caller cannot accidentally leak an error message into
 * diagnostics by re-throwing it.
 */
export async function boundedFetchBytes(
  request: BoundedRetrievalRequest,
): Promise<BoundedRetrievalResult> {
  const timeoutMs = request.timeoutMs ?? RETRIEVAL_TIMEOUT_MS;
  const maxBytes = request.maxBytes ?? RETRIEVAL_MAX_BYTES;
  const maxHops = request.maxRedirectHops ?? MAX_REDIRECT_HOPS_PER_DOCUMENT;
  const sourceId = request.sourceId ?? hostOf(request.url) ?? "UNKNOWN_SOURCE";

  let hops = 0;
  let sent = 0;
  const fail = (reasonCode: BoundedRetrievalFailureCode): BoundedRetrievalResult => ({
    ok: false,
    requestedUrl: request.url,
    reasonCode,
    retrievedAtMs: Date.now(),
    redirectHops: hops,
    transportRequests: sent,
  });

  let currentUrl = request.url;
  const visited = new Set<string>();
  let response: Response;

  for (;;) {
    const target = validateTarget(currentUrl, hops > 0);
    if (!target.ok) return fail(target.code);

    // Charged BEFORE the request is issued. A ceiling verified afterwards has
    // already been exceeded by the traffic it was meant to prevent.
    if (request.budget !== undefined) {
      const kind: TransportHopKind =
        hops === 0 ? (request.hopKind ?? "BASE_DOCUMENT") : "REDIRECT_HOP";
      if (!request.budget.charge(sourceId, kind, currentUrl)) {
        return fail("TRANSPORT_BUDGET_EXCEEDED");
      }
    }

    visited.add(currentUrl);
    sent += 1;
    try {
      response = await fetch(currentUrl, {
        method: "GET",
        // Hops are ours to take, count and validate — not the runtime's.
        redirect: "manual",
        headers: { ...(request.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      return fail(classifyThrown(err));
    }

    if (!REDIRECT_STATUSES.includes(response.status)) break;

    // A redirect body is never evidence; release the socket before hopping.
    await response.body?.cancel().catch(() => undefined);

    if (hops >= maxHops) return fail("REDIRECT_LIMIT_EXCEEDED");
    const location = response.headers.get("location");
    if (location === null || location.trim() === "") return fail("REDIRECT_WITHOUT_LOCATION");

    let next: string;
    try {
      next = new URL(location, currentUrl).toString();
    } catch {
      return fail("MALFORMED_URL");
    }
    if (visited.has(next)) return fail("REDIRECT_LOOP");

    currentUrl = next;
    hops += 1;
  }

  if (response.status !== 200) return fail("HTTP_STATUS_NOT_OK");

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  const typeOk = request.allowedContentTypePrefixes.some((prefix) =>
    contentType.startsWith(prefix.toLowerCase()),
  );
  if (!typeOk) return fail("CONTENT_TYPE_REJECTED");

  // Declared length is only an early reject; the real cap is enforced below
  // against bytes actually received.
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > maxBytes) return fail("RESPONSE_TOO_LARGE");

  const chunks: Buffer[] = [];
  let total = 0;
  const body = response.body;
  if (body === null) return fail("EMPTY_BODY");

  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return fail("RESPONSE_TOO_LARGE");
      }
      chunks.push(Buffer.from(value));
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    return fail(classifyThrown(err));
  }

  if (total === 0) return fail("EMPTY_BODY");

  const bytes = Buffer.concat(chunks, total);
  return {
    ok: true,
    requestedUrl: request.url,
    // With manual redirects `response.url` can be empty; `currentUrl` is the
    // URL we actually validated and requested, so it is the honest final URL.
    finalUrl: currentUrl,
    bytes,
    byteLength: total,
    rawByteSha256: createHash("sha256").update(bytes).digest("hex"),
    contentType,
    retrievedAtMs: Date.now(),
    redirectHops: hops,
    transportRequests: sent,
  };
}

/**
 * Browser-shaped headers for the exchange hosts that reject plain clients.
 *
 * This mirrors the approach already accepted in `fnoBanList.ts` for NSE
 * archives. It is presentation, not authentication: no credential, cookie or
 * token is involved, and nothing here is read from a secret.
 */
export function exchangeRequestHeaders(url: string): Readonly<Record<string, string>> {
  const host = hostOf(url) ?? "";
  const common = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  };
  if (host.endsWith("nseindia.com")) {
    return Object.freeze({
      ...common,
      Accept: "text/csv,application/json,text/html;q=0.9,*/*;q=0.8",
      Referer: "https://www.nseindia.com/",
    });
  }
  if (host.endsWith("bseindia.com")) {
    return Object.freeze({
      ...common,
      Accept: "application/json,text/csv,text/html;q=0.9,*/*;q=0.8",
      Referer: "https://www.bseindia.com/",
      Origin: "https://www.bseindia.com",
    });
  }
  return Object.freeze({ ...common, Accept: "text/csv,*/*;q=0.8" });
}
