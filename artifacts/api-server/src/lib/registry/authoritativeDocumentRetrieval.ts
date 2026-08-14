/**
 * PHASE 0.8E — AUTHORITATIVE DOCUMENT RETRIEVAL
 *
 * Sits between the bounded transport (`boundedSourceRetrieval`) and the
 * accepted parsers (`exchangeCalendarSources`). Its single job is to answer:
 *
 *     "are these bytes the authoritative artefact, or an application shell
 *      that merely POINTS at the authoritative artefact?"
 *
 * WHY THIS EXISTS
 *
 * The Phase 0.8E controlled proof refused at `EXCHANGE_CALENDAR_INVALID`. The
 * cause was not a network fault and not a parser bug: the composition asked
 * BSE for `listholi.aspx` and `tra_trading.aspx` and handed the response
 * straight to parsers that — correctly, and by accepted Phase 0.6A contract —
 * require BSE's own application bundle (>= 1 MiB, carrying the published
 * equity trading-holidays caption). Those two URLs serve an application SHELL:
 * a small HTML page whose real content is loaded later by script. The parsers
 * refused exactly as designed. Nothing was wired to fetch the artefact the
 * parsers were written against.
 *
 * THE RULE THIS MODULE ENFORCES
 *
 * A page shell is never accepted as authoritative bytes. When a source is
 * declared as possibly-shell-served, the authoritative asset is DISCOVERED by
 * parsing the served HTML — never by guessing a filename and never by pinning
 * a build fingerprint, both of which would silently rot at the next deploy and
 * are indistinguishable from fabrication when they happen to still resolve.
 *
 * Discovery is deterministic and refuses ambiguity: zero candidates and two-
 * or-more candidates are both coded refusals, because "we picked the first
 * one" is a guess wearing a parser's clothes.
 *
 * Every request issued here — the shell AND the discovered asset — is charged
 * against the caller's `TransportBudget` before it is sent.
 */

import { createHash } from "node:crypto";

import {
  APPROVED_SOURCE_HOSTS,
  type BoundedRetrievalRequest,
  type BoundedRetrievalResult,
  type TransportBudget,
  exchangeRequestHeaders,
} from "./boundedSourceRetrieval";

export type AuthoritativeRetrievalFailureCode =
  /** The shell/document request itself failed; carries the transport code. */
  | "DOCUMENT_RETRIEVAL_FAILED"
  /** Served bytes are an application shell and no discovery was permitted. */
  | "PAGE_SHELL_DETECTED"
  /** Shell parsed, but it references no candidate authoritative asset. */
  | "ASSET_REFERENCE_ABSENT"
  /** Shell references more than one candidate; choosing would be a guess. */
  | "ASSET_REFERENCE_AMBIGUOUS"
  /** A candidate was found but is not a usable URL on an approved host. */
  | "ASSET_REFERENCE_MALFORMED"
  /** The discovered asset request failed; carries the transport code. */
  | "ASSET_RETRIEVAL_FAILED"
  /** The asset arrived but is below its declared floor — truncated. */
  | "ASSET_BELOW_SIZE_FLOOR"
  /** The asset arrived intact but is not the artefact we were promised. */
  | "ASSET_IDENTITY_ANCHOR_ABSENT";

/**
 * How a source proves the bytes in hand are the real artefact.
 *
 * Both checks are floors, never ceilings that could be relaxed to obtain a
 * pass: `minBytes` comes from the accepted Phase 0.6A source contract and
 * `identityAnchor` is the published caption that names the artefact.
 */
export interface AuthoritativeArtefactContract {
  readonly minBytes: number;
  /** Published text proving artefact identity. Optional; never inferred. */
  readonly identityAnchor?: RegExp;
}

export interface AssetDiscoveryContract {
  /**
   * Anchored basename rule, e.g. `/^main[.-][A-Za-z0-9_-]*\.js$/i`.
   *
   * Anchored on the ROLE of the asset (the application's main chunk), not on a
   * build hash. The hash portion stays a wildcard precisely so a rebuild does
   * not turn a correct rule into a stale one.
   */
  readonly basenamePattern: RegExp;
  readonly contentTypePrefixes: readonly string[];
  readonly maxBytes?: number;
}

export interface AuthoritativeDocumentSpec {
  readonly sourceId: string;
  readonly url: string;
  readonly documentContentTypePrefixes: readonly string[];
  /** Null when the served document IS the artefact (a CSV or JSON API). */
  readonly artefact: AuthoritativeArtefactContract | null;
  /** Null when the source must never be satisfied by a discovered asset. */
  readonly discovery: AssetDiscoveryContract | null;
}

export interface AuthoritativeDocumentDeps {
  readonly fetchBytes: (request: BoundedRetrievalRequest) => Promise<BoundedRetrievalResult>;
  readonly budget: TransportBudget;
  /** Byte-to-text decoding, matching the accepted source encoding. */
  readonly encoding: BufferEncoding;
}

export type AuthoritativeDocumentResult =
  | {
      readonly ok: true;
      readonly sourceId: string;
      /** The authoritative text: the document itself, or the discovered asset. */
      readonly text: string;
      readonly byteLength: number;
      readonly sha256: string;
      /** Safe metadata only: the URL the authoritative bytes came from. */
      readonly authoritativeUrl: string;
      readonly usedDiscoveredAsset: boolean;
      readonly documentRedirectHops: number;
      readonly transportRequests: number;
    }
  | {
      readonly ok: false;
      readonly sourceId: string;
      readonly reasonCode: AuthoritativeRetrievalFailureCode;
      /** The underlying transport code, when there was one. Never a body. */
      readonly transportReasonCode: string | null;
      readonly observedBytes: number | null;
      readonly requiredBytes: number | null;
      readonly documentRedirectHops: number;
      readonly transportRequests: number;
    };

/**
 * Every `src`/`href` a browser would load as script from this document.
 *
 * A regex rather than a DOM parser on purpose: the input is an untrusted,
 * possibly-truncated shell, and we need a bounded, dependency-free scan that
 * cannot execute anything. Over-collection is safe here because the anchored
 * basename rule and the approved-host check both run afterwards.
 */
const SCRIPT_REF = /<script\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
const PRELOAD_SCRIPT_REF =
  /<link\b[^>]*?\bas\s*=\s*["']script["'][^>]*?\bhref\s*=\s*["']([^"']+)["']/gi;

/** Bound the scan: a shell is small, and an adversarial page must not be. */
const MAX_SHELL_SCAN_BYTES = 2 * 1024 * 1024;
const MAX_CANDIDATE_REFERENCES = 500;

export function discoverAuthoritativeAssetUrls(
  shellHtml: string,
  baseUrl: string,
  contract: AssetDiscoveryContract,
): readonly string[] {
  const scanned = shellHtml.length > MAX_SHELL_SCAN_BYTES
    ? shellHtml.slice(0, MAX_SHELL_SCAN_BYTES)
    : shellHtml;

  const raw: string[] = [];
  for (const pattern of [SCRIPT_REF, PRELOAD_SCRIPT_REF]) {
    pattern.lastIndex = 0;
    for (const m of scanned.matchAll(pattern)) {
      if (raw.length >= MAX_CANDIDATE_REFERENCES) break;
      raw.push(m[1]);
    }
  }

  const selected = new Set<string>();
  for (const ref of raw) {
    let resolved: URL;
    try {
      resolved = new URL(ref, baseUrl);
    } catch {
      continue;
    }
    if (resolved.protocol !== "https:") continue;
    if (resolved.username !== "" || resolved.password !== "") continue;
    if (!APPROVED_SOURCE_HOSTS.includes(resolved.host.toLowerCase())) continue;

    const basename = resolved.pathname.split("/").pop() ?? "";
    contract.basenamePattern.lastIndex = 0;
    if (!contract.basenamePattern.test(basename)) continue;

    // Query strings are cache-busters, not identity. Normalising here stops
    // one asset referenced twice with different `?v=` from reading as two.
    resolved.hash = "";
    selected.add(resolved.toString());
  }
  return [...selected].sort();
}

export async function retrieveAuthoritativeDocument(
  spec: AuthoritativeDocumentSpec,
  deps: AuthoritativeDocumentDeps,
): Promise<AuthoritativeDocumentResult> {
  const doc = await deps.fetchBytes({
    url: spec.url,
    allowedContentTypePrefixes: spec.documentContentTypePrefixes,
    headers: exchangeRequestHeaders(spec.url),
    budget: deps.budget,
    sourceId: spec.sourceId,
    hopKind: "BASE_DOCUMENT",
  });

  if (!doc.ok) {
    return {
      ok: false,
      sourceId: spec.sourceId,
      reasonCode: "DOCUMENT_RETRIEVAL_FAILED",
      transportReasonCode: doc.reasonCode,
      observedBytes: null,
      requiredBytes: spec.artefact?.minBytes ?? null,
      documentRedirectHops: doc.redirectHops,
      transportRequests: doc.transportRequests,
    };
  }

  const documentText = doc.bytes.toString(deps.encoding);
  const contract = spec.artefact;

  // No artefact contract: the served document IS the source (CSV, JSON API).
  if (contract === null) {
    return {
      ok: true,
      sourceId: spec.sourceId,
      text: documentText,
      byteLength: doc.byteLength,
      sha256: doc.rawByteSha256,
      authoritativeUrl: doc.finalUrl,
      usedDiscoveredAsset: false,
      documentRedirectHops: doc.redirectHops,
      transportRequests: doc.transportRequests,
    };
  }

  const anchorSatisfied =
    contract.identityAnchor === undefined || contract.identityAnchor.test(documentText);
  const isAuthoritativeAsServed = doc.byteLength >= contract.minBytes && anchorSatisfied;

  if (isAuthoritativeAsServed) {
    return {
      ok: true,
      sourceId: spec.sourceId,
      text: documentText,
      byteLength: doc.byteLength,
      sha256: doc.rawByteSha256,
      authoritativeUrl: doc.finalUrl,
      usedDiscoveredAsset: false,
      documentRedirectHops: doc.redirectHops,
      transportRequests: doc.transportRequests,
    };
  }

  // Served bytes are not the artefact. Either discover the real one, or refuse
  // — silently accepting a shell is the failure this whole module prevents.
  if (spec.discovery === null) {
    return {
      ok: false,
      sourceId: spec.sourceId,
      reasonCode: "PAGE_SHELL_DETECTED",
      transportReasonCode: null,
      observedBytes: doc.byteLength,
      requiredBytes: contract.minBytes,
      documentRedirectHops: doc.redirectHops,
      transportRequests: doc.transportRequests,
    };
  }

  const candidates = discoverAuthoritativeAssetUrls(documentText, doc.finalUrl, spec.discovery);
  if (candidates.length === 0) {
    return {
      ok: false,
      sourceId: spec.sourceId,
      reasonCode: "ASSET_REFERENCE_ABSENT",
      transportReasonCode: null,
      observedBytes: doc.byteLength,
      requiredBytes: contract.minBytes,
      documentRedirectHops: doc.redirectHops,
      transportRequests: doc.transportRequests,
    };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      sourceId: spec.sourceId,
      reasonCode: "ASSET_REFERENCE_AMBIGUOUS",
      transportReasonCode: null,
      observedBytes: doc.byteLength,
      requiredBytes: contract.minBytes,
      documentRedirectHops: doc.redirectHops,
      transportRequests: doc.transportRequests,
    };
  }

  const assetUrl = candidates[0];
  const asset = await deps.fetchBytes({
    url: assetUrl,
    allowedContentTypePrefixes: spec.discovery.contentTypePrefixes,
    headers: exchangeRequestHeaders(assetUrl),
    maxBytes: spec.discovery.maxBytes,
    budget: deps.budget,
    sourceId: spec.sourceId,
    hopKind: "DISCOVERED_ASSET",
  });

  const spent = doc.transportRequests + asset.transportRequests;
  if (!asset.ok) {
    return {
      ok: false,
      sourceId: spec.sourceId,
      reasonCode: "ASSET_RETRIEVAL_FAILED",
      transportReasonCode: asset.reasonCode,
      observedBytes: null,
      requiredBytes: contract.minBytes,
      documentRedirectHops: doc.redirectHops,
      transportRequests: spent,
    };
  }

  // The floors that applied to the artefact still apply once it is discovered.
  // Discovery changes WHERE the bytes came from, never WHAT they must satisfy.
  if (asset.byteLength < contract.minBytes) {
    return {
      ok: false,
      sourceId: spec.sourceId,
      reasonCode: "ASSET_BELOW_SIZE_FLOOR",
      transportReasonCode: null,
      observedBytes: asset.byteLength,
      requiredBytes: contract.minBytes,
      documentRedirectHops: doc.redirectHops,
      transportRequests: spent,
    };
  }

  const assetText = asset.bytes.toString(deps.encoding);
  if (contract.identityAnchor !== undefined && !contract.identityAnchor.test(assetText)) {
    return {
      ok: false,
      sourceId: spec.sourceId,
      reasonCode: "ASSET_IDENTITY_ANCHOR_ABSENT",
      transportReasonCode: null,
      observedBytes: asset.byteLength,
      requiredBytes: contract.minBytes,
      documentRedirectHops: doc.redirectHops,
      transportRequests: spent,
    };
  }

  return {
    ok: true,
    sourceId: spec.sourceId,
    text: assetText,
    byteLength: asset.byteLength,
    sha256: createHash("sha256").update(asset.bytes).digest("hex"),
    // The URL that actually SUPPLIED the bytes, which after a redirect is not
    // the URL we asked for. Provenance must name the artefact that was read,
    // otherwise a successful run persists evidence pointing at a document it
    // never parsed.
    authoritativeUrl: asset.finalUrl,
    usedDiscoveredAsset: true,
    documentRedirectHops: doc.redirectHops,
    transportRequests: spent,
  };
}
