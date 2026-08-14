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
 *   - redirects          followed, but the FINAL host must be on the
 *                        per-request host allowlist
 *   - body               must be non-empty
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
  | "EMPTY_BODY";

export interface BoundedRetrievalRequest {
  readonly url: string;
  /** Prefix-matched against the response `content-type`, lowercased. */
  readonly allowedContentTypePrefixes: readonly string[];
  readonly headers?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
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
    }
  | {
      readonly ok: false;
      readonly requestedUrl: string;
      readonly reasonCode: BoundedRetrievalFailureCode;
      readonly retrievedAtMs: number;
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
  const fail = (reasonCode: BoundedRetrievalFailureCode): BoundedRetrievalResult => ({
    ok: false,
    requestedUrl: request.url,
    reasonCode,
    retrievedAtMs: Date.now(),
  });

  const requestedHost = hostOf(request.url);
  if (requestedHost === null || !APPROVED_SOURCE_HOSTS.includes(requestedHost)) {
    return fail("HOST_NOT_APPROVED");
  }

  let response: Response;
  try {
    response = await fetch(request.url, {
      method: "GET",
      redirect: "follow",
      headers: { ...(request.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return fail(classifyThrown(err));
  }

  // Where the bytes actually came from, after any redirect chain.
  const finalHost = hostOf(response.url || request.url);
  if (finalHost === null || !APPROVED_SOURCE_HOSTS.includes(finalHost)) {
    return fail("REDIRECTED_OFF_APPROVED_HOST");
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
    finalUrl: response.url || request.url,
    bytes,
    byteLength: total,
    rawByteSha256: createHash("sha256").update(bytes).digest("hex"),
    contentType,
    retrievedAtMs: Date.now(),
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
