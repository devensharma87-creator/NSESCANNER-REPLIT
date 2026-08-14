/**
 * PHASE 0.8E — CALENDAR DIAGNOSTICS, REDIRECT-AWARE RETRIEVAL, TRANSPORT BUDGET
 *
 * Covers the three coupled corrections:
 *   B — specific calendar blockers are preserved, not collapsed to one word
 *   C — redirects are taken explicitly and application shells are never
 *       accepted as authoritative bytes
 *   D — every request that leaves the process is charged to a declared ceiling
 *
 * No network. `globalThis.fetch` is stubbed for the transport tests, and the
 * calendar tests drive the real production composition through a fake
 * `fetchBytes` dependency, so the wiring under test is the shipped wiring.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  APPROVED_SOURCE_HOSTS,
  MAX_REDIRECT_HOPS_PER_DOCUMENT,
  boundedFetchBytes,
  createTransportBudget,
} from "./boundedSourceRetrieval";
import {
  discoverAuthoritativeAssetUrls,
  retrieveAuthoritativeDocument,
  type AuthoritativeDocumentSpec,
} from "./authoritativeDocumentRetrieval";
import {
  CALENDAR_BLOCKER_CODE,
  classifyRetrievalFailure,
  classifyTransportFailure,
  formatSubBlockers,
} from "./calendarBlockerContract";
import {
  EXCHANGE_TRANSPORT_PLAN,
  PRODUCTION_REGISTRY_REFRESH_DEPS,
  buildProductionRegistryRefreshPorts,
  getLastExchangeTransportReport,
} from "./registryRefreshProductionComposition";
import {
  BSE_TRADING_HOLIDAYS_URL,
  MIN_BSE_BUNDLE_BYTES,
  NSE_HOLIDAY_MASTER_URL,
  NSE_MARKET_TIMINGS_URL,
} from "./exchangeCalendarSources";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const OK_HEADERS = { "content-type": "application/javascript" };

function okResponse(body: string, contentType = "text/html"): Response {
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}
function redirectResponse(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

// ── C: redirect policy ───────────────────────────────────────────────────────

describe("P0.8E C — redirects are taken explicitly, validated and counted", () => {
  it("takes one hop, counts it, and reports the final URL it actually requested", async () => {
    const seen: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      seen.push(u);
      if (u === "https://www.bseindia.com/a") return redirectResponse("https://www.bseindia.com/b");
      return okResponse("payload");
    }) as unknown as typeof fetch;

    const budget = createTransportBudget(10);
    const res = await boundedFetchBytes({
      url: "https://www.bseindia.com/a",
      allowedContentTypePrefixes: ["text/html"],
      budget,
      sourceId: "T",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.redirectHops).toBe(1);
    expect(res.transportRequests).toBe(2);
    expect(res.finalUrl).toBe("https://www.bseindia.com/b");
    // D: the hop is charged, not invisible.
    expect(budget.spent).toBe(2);
    expect(budget.ledger().map((e) => e.hopKind)).toEqual(["BASE_DOCUMENT", "REDIRECT_HOP"]);
    expect(seen).toEqual(["https://www.bseindia.com/a", "https://www.bseindia.com/b"]);
  });

  it("refuses a second hop rather than following a chain", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) =>
      redirectResponse(`${String(url)}x`),
    ) as unknown as typeof fetch;

    const res = await boundedFetchBytes({
      url: "https://www.bseindia.com/a",
      allowedContentTypePrefixes: ["text/html"],
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reasonCode).toBe("REDIRECT_LIMIT_EXCEEDED");
    expect(MAX_REDIRECT_HOPS_PER_DOCUMENT).toBe(1);
  });

  it("refuses a redirect that leaves the approved host set", async () => {
    globalThis.fetch = vi.fn(async () =>
      redirectResponse("https://evil.example.com/a"),
    ) as unknown as typeof fetch;

    const res = await boundedFetchBytes({
      url: "https://www.bseindia.com/a",
      allowedContentTypePrefixes: ["text/html"],
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reasonCode).toBe("REDIRECTED_OFF_APPROVED_HOST");
    expect(APPROVED_SOURCE_HOSTS).not.toContain("evil.example.com");
  });

  it("refuses a protocol downgrade and credentials in a redirect target", async () => {
    globalThis.fetch = vi.fn(async () =>
      redirectResponse("http://www.bseindia.com/a"),
    ) as unknown as typeof fetch;
    const downgrade = await boundedFetchBytes({
      url: "https://www.bseindia.com/start",
      allowedContentTypePrefixes: ["text/html"],
    });
    expect(downgrade.ok).toBe(false);
    if (!downgrade.ok) expect(downgrade.reasonCode).toBe("INSECURE_TRANSPORT");

    globalThis.fetch = vi.fn(async () =>
      redirectResponse("https://u:p@www.bseindia.com/a"),
    ) as unknown as typeof fetch;
    const creds = await boundedFetchBytes({
      url: "https://www.bseindia.com/start",
      allowedContentTypePrefixes: ["text/html"],
    });
    expect(creds.ok).toBe(false);
    if (!creds.ok) expect(creds.reasonCode).toBe("CREDENTIALS_IN_URL");
  });

  it("detects a redirect loop back to a URL already requested", async () => {
    globalThis.fetch = vi.fn(async () =>
      redirectResponse("https://www.bseindia.com/a"),
    ) as unknown as typeof fetch;
    const res = await boundedFetchBytes({
      url: "https://www.bseindia.com/a",
      allowedContentTypePrefixes: ["text/html"],
      maxRedirectHops: 3,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reasonCode).toBe("REDIRECT_LOOP");
  });
});

// ── D: the ceiling is charged BEFORE the request ─────────────────────────────

describe("P0.8E D — declared transport budget", () => {
  it("refuses the request that would exceed the ceiling, without sending it", async () => {
    const sent: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      sent.push(String(url));
      return okResponse("body");
    }) as unknown as typeof fetch;

    const budget = createTransportBudget(1);
    const first = await boundedFetchBytes({
      url: "https://www.bseindia.com/a",
      allowedContentTypePrefixes: ["text/html"],
      budget,
      sourceId: "T",
    });
    const second = await boundedFetchBytes({
      url: "https://www.bseindia.com/b",
      allowedContentTypePrefixes: ["text/html"],
      budget,
      sourceId: "T",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reasonCode).toBe("TRANSPORT_BUDGET_EXCEEDED");
    // The refused request never left the process.
    expect(sent).toEqual(["https://www.bseindia.com/a"]);
    expect(budget.spent).toBe(1);
  });

  it("declares a plan whose parts sum to the 18-request ceiling", () => {
    const { plannedBaseDocuments, plannedDiscoveredAssets, plannedRedirectHops, maxTotalRequests } =
      EXCHANGE_TRANSPORT_PLAN;
    expect(maxTotalRequests).toBe(18);
    expect(plannedBaseDocuments + plannedDiscoveredAssets + plannedRedirectHops).toBe(
      maxTotalRequests,
    );
  });
});

// ── C: shell detection and deterministic asset discovery ─────────────────────

const BUNDLE_ANCHOR = /Display table for Trading Holidays for \d{4} - Equity Segment/i;

function bundleBody(): string {
  return `var x=1;/* Display table for Trading Holidays for 2026 - Equity Segment */${"a".repeat(
    MIN_BSE_BUNDLE_BYTES,
  )};`;
}

describe("P0.8E C — application shells are never accepted as authoritative bytes", () => {
  const shell = (scripts: string[]): string =>
    `<html><body>${scripts.map((s) => `<script src="${s}"></script>`).join("")}</body></html>`;

  it("selects exactly one main chunk, ignoring other assets and off-host references", () => {
    const html = shell([
      "/static/runtime.4f2.js",
      "/static/polyfills.9ab.js",
      "/static/main.7c1d9e.js",
      "https://cdn.example.com/static/main.evil.js",
      "http://www.bseindia.com/static/main.insecure.js",
    ]);
    const found = discoverAuthoritativeAssetUrls(html, "https://www.bseindia.com/page.aspx", {
      basenamePattern: /^main[.-][A-Za-z0-9_-]*\.js$/i,
      contentTypePrefixes: ["application/javascript"],
    });
    expect(found).toEqual(["https://www.bseindia.com/static/main.7c1d9e.js"]);
  });

  it("reports ABSENT and AMBIGUOUS rather than guessing", async () => {
    const spec = (url: string): AuthoritativeDocumentSpec => ({
      sourceId: "BSE_APPLICATION_BUNDLE",
      url,
      documentContentTypePrefixes: ["text/html"],
      artefact: { minBytes: MIN_BSE_BUNDLE_BYTES, identityAnchor: BUNDLE_ANCHOR },
      discovery: {
        basenamePattern: /^main[.-][A-Za-z0-9_-]*\.js$/i,
        contentTypePrefixes: ["application/javascript"],
      },
    });

    const makeDeps = (html: string) => ({
      budget: createTransportBudget(10),
      encoding: "latin1" as BufferEncoding,
      fetchBytes: async () => ({
        ok: true as const,
        requestedUrl: "u",
        finalUrl: "https://www.bseindia.com/page.aspx",
        bytes: Buffer.from(html, "latin1"),
        byteLength: Buffer.byteLength(html, "latin1"),
        rawByteSha256: "h",
        contentType: "text/html",
        retrievedAtMs: 0,
        redirectHops: 0,
        transportRequests: 1,
      }),
    });

    const absent = await retrieveAuthoritativeDocument(
      spec("https://www.bseindia.com/page.aspx"),
      makeDeps(shell(["/static/runtime.1.js"])),
    );
    expect(absent.ok).toBe(false);
    if (!absent.ok) expect(absent.reasonCode).toBe("ASSET_REFERENCE_ABSENT");

    const ambiguous = await retrieveAuthoritativeDocument(
      spec("https://www.bseindia.com/page.aspx"),
      makeDeps(shell(["/static/main.a1.js", "/static/main-b2.js"])),
    );
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) expect(ambiguous.reasonCode).toBe("ASSET_REFERENCE_AMBIGUOUS");
  });

  it("reports PAGE_SHELL_DETECTED when discovery is not permitted for the source", async () => {
    const html = "<html><body>tiny</body></html>";
    const res = await retrieveAuthoritativeDocument(
      {
        sourceId: "NSE_MARKET_TIMINGS",
        url: NSE_MARKET_TIMINGS_URL,
        documentContentTypePrefixes: ["text/html"],
        artefact: { minBytes: 32 * 1024 },
        discovery: null,
      },
      {
        budget: createTransportBudget(10),
        encoding: "latin1",
        fetchBytes: async () => ({
          ok: true as const,
          requestedUrl: NSE_MARKET_TIMINGS_URL,
          finalUrl: NSE_MARKET_TIMINGS_URL,
          bytes: Buffer.from(html, "latin1"),
          byteLength: html.length,
          rawByteSha256: "h",
          contentType: "text/html",
          retrievedAtMs: 0,
          redirectHops: 0,
          transportRequests: 1,
        }),
      },
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reasonCode).toBe("PAGE_SHELL_DETECTED");
    expect(res.observedBytes).toBe(html.length);
    expect(res.requiredBytes).toBe(32 * 1024);
  });

  it("keeps the artefact floor and identity anchor after discovery", async () => {
    const html = `<html><script src="/static/main.abc.js"></script></html>`;
    const makeDeps = (assetBody: string) => {
      let call = 0;
      return {
        budget: createTransportBudget(10),
        encoding: "latin1" as BufferEncoding,
        fetchBytes: async () => {
          call += 1;
          const body = call === 1 ? html : assetBody;
          return {
            ok: true as const,
            requestedUrl: "u",
            finalUrl: call === 1 ? "https://www.bseindia.com/page.aspx" : "https://www.bseindia.com/static/main.abc.js",
            bytes: Buffer.from(body, "latin1"),
            byteLength: Buffer.byteLength(body, "latin1"),
            rawByteSha256: "h",
            contentType: call === 1 ? "text/html" : OK_HEADERS["content-type"],
            retrievedAtMs: 0,
            redirectHops: 0,
            transportRequests: 1,
          };
        },
      };
    };
    const spec: AuthoritativeDocumentSpec = {
      sourceId: "BSE_APPLICATION_BUNDLE",
      url: BSE_TRADING_HOLIDAYS_URL,
      documentContentTypePrefixes: ["text/html"],
      artefact: { minBytes: MIN_BSE_BUNDLE_BYTES, identityAnchor: BUNDLE_ANCHOR },
      discovery: {
        basenamePattern: /^main[.-][A-Za-z0-9_-]*\.js$/i,
        contentTypePrefixes: ["application/javascript"],
      },
    };

    const truncated = await retrieveAuthoritativeDocument(spec, makeDeps("var x=1;"));
    expect(truncated.ok).toBe(false);
    if (!truncated.ok) expect(truncated.reasonCode).toBe("ASSET_BELOW_SIZE_FLOOR");

    const wrongArtefact = await retrieveAuthoritativeDocument(
      spec,
      makeDeps("z".repeat(MIN_BSE_BUNDLE_BYTES + 1)),
    );
    expect(wrongArtefact.ok).toBe(false);
    if (!wrongArtefact.ok) expect(wrongArtefact.reasonCode).toBe("ASSET_IDENTITY_ANCHOR_ABSENT");

    const good = await retrieveAuthoritativeDocument(spec, makeDeps(bundleBody()));
    expect(good.ok).toBe(true);
    if (!good.ok) return;
    expect(good.usedDiscoveredAsset).toBe(true);
    expect(good.authoritativeUrl).toBe("https://www.bseindia.com/static/main.abc.js");
    expect(good.byteLength).toBeGreaterThanOrEqual(MIN_BSE_BUNDLE_BYTES);
  });
});

// ── B: specific blockers, and TWO retained at once ───────────────────────────

describe("P0.8E B — calendar refusals keep every specific reason", () => {
  it("retains two simultaneous blockers from different sources, not just the first", async () => {
    const bodyFor = (url: string): string => {
      if (url.startsWith(NSE_HOLIDAY_MASTER_URL)) return JSON.stringify({ CM: [] });
      if (url.startsWith(NSE_MARKET_TIMINGS_URL)) return "<html><body>shell</body></html>";
      return "<html><body>bse shell, no script references</body></html>";
    };
    const deps = {
      ...PRODUCTION_REGISTRY_REFRESH_DEPS,
      fetchBytes: async (req: { url: string }) => {
        const body = bodyFor(req.url);
        return {
          ok: true as const,
          requestedUrl: req.url,
          finalUrl: req.url,
          bytes: Buffer.from(body, "latin1"),
          byteLength: Buffer.byteLength(body, "latin1"),
          rawByteSha256: "h",
          contentType: req.url.startsWith(NSE_HOLIDAY_MASTER_URL)
            ? "application/json"
            : "text/html",
          retrievedAtMs: 0,
          redirectHops: 0,
          transportRequests: 1,
        };
      },
    } as unknown as typeof PRODUCTION_REGISTRY_REFRESH_DEPS;

    const ports = buildProductionRegistryRefreshPorts(deps);
    const res = await ports.calendar.buildAndResolveLatestCompletedSession({
      nowMs: Date.UTC(2026, 7, 14, 6, 0, 0),
    });

    expect(res.ok).toBe(false);
    const codes = res.subBlockers.map((b) => b.code);
    // BOTH failures survive — the defect was reporting only one.
    expect(codes).toContain(CALENDAR_BLOCKER_CODE.PAGE_SHELL_DETECTED);
    expect(codes).toContain(CALENDAR_BLOCKER_CODE.BUNDLE_REFERENCE_ABSENT);
    expect(res.subBlockers.length).toBeGreaterThanOrEqual(2);
    expect(new Set(res.subBlockers.map((b) => b.sourceId)).size).toBeGreaterThanOrEqual(2);

    // Each blocker names its stage and, where relevant, the byte evidence.
    const shellBlocker = res.subBlockers.find(
      (b) => b.code === CALENDAR_BLOCKER_CODE.PAGE_SHELL_DETECTED,
    );
    expect(shellBlocker?.stage).toBe("ARTEFACT_DISCOVERY");
    expect(shellBlocker?.requiredBytes).toBeGreaterThan(0);
    expect(shellBlocker?.observedBytes).toBeGreaterThan(0);
  });

  it("emits no HTML, payload or body fragment into diagnostics", async () => {
    const secretish = "<html><script>var apiKey='SHOULD_NEVER_APPEAR';</script></html>";
    const deps = {
      ...PRODUCTION_REGISTRY_REFRESH_DEPS,
      fetchBytes: async (req: { url: string }) => ({
        ok: true as const,
        requestedUrl: req.url,
        finalUrl: req.url,
        bytes: Buffer.from(secretish, "latin1"),
        byteLength: secretish.length,
        rawByteSha256: "h",
        contentType: "text/html",
        retrievedAtMs: 0,
        redirectHops: 0,
        transportRequests: 1,
      }),
    } as unknown as typeof PRODUCTION_REGISTRY_REFRESH_DEPS;

    const ports = buildProductionRegistryRefreshPorts(deps);
    const res = await ports.calendar.buildAndResolveLatestCompletedSession({ nowMs: Date.now() });
    const rendered = [JSON.stringify(res.subBlockers), ...formatSubBlockers(res.subBlockers)].join(
      " ",
    );

    expect(rendered).not.toContain("SHOULD_NEVER_APPEAR");
    expect(rendered).not.toContain("<");
    expect(rendered).not.toContain("apiKey");
  });

  it("charges calendar retrieval against the declared plan and reports it by source", async () => {
    // The real transport is used here — a fake `fetchBytes` would bypass the
    // very layer that charges the budget, so only the network is stubbed.
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      return u.startsWith(NSE_HOLIDAY_MASTER_URL)
        ? okResponse(JSON.stringify({ CM: [] }), "application/json")
        : okResponse("<html><body>shell</body></html>");
    }) as unknown as typeof fetch;

    const ports = buildProductionRegistryRefreshPorts(PRODUCTION_REGISTRY_REFRESH_DEPS);
    await ports.calendar.buildAndResolveLatestCompletedSession({ nowMs: Date.now() });

    const report = getLastExchangeTransportReport();
    expect(report).not.toBeNull();
    expect(report?.plan.maxTotalRequests).toBe(18);
    // Three calendar documents, no redirects, no discoverable asset in a
    // shell with zero script references.
    expect(report?.actualTotal).toBe(3);
    expect(report?.actualTotal).toBeLessThanOrEqual(EXCHANGE_TRANSPORT_PLAN.maxTotalRequests);
    expect(report?.ledger.map((e) => e.hopKind)).toEqual([
      "BASE_DOCUMENT",
      "BASE_DOCUMENT",
      "BASE_DOCUMENT",
    ]);
    expect(new Set(report?.ledger.map((e) => e.sourceId))).toEqual(
      new Set(["NSE_HOLIDAY_MASTER", "NSE_MARKET_TIMINGS", "BSE_APPLICATION_BUNDLE"]),
    );
  });

  it("maps transport and discovery failures to distinct, stable codes", () => {
    expect(classifyTransportFailure("REDIRECT_LOOP")).toBe(
      CALENDAR_BLOCKER_CODE.REDIRECT_POLICY_FAILED,
    );
    expect(classifyTransportFailure("CONTENT_TYPE_REJECTED")).toBe(
      CALENDAR_BLOCKER_CODE.CONTENT_TYPE_REJECTED,
    );
    expect(classifyTransportFailure("TRANSPORT_BUDGET_EXCEEDED")).toBe(
      CALENDAR_BLOCKER_CODE.TRANSPORT_BUDGET_EXCEEDED,
    );
    expect(classifyTransportFailure("TIMEOUT")).toBe(CALENDAR_BLOCKER_CODE.RETRIEVAL_FAILED);

    expect(classifyRetrievalFailure("PAGE_SHELL_DETECTED", null)).toBe(
      CALENDAR_BLOCKER_CODE.PAGE_SHELL_DETECTED,
    );
    expect(classifyRetrievalFailure("ASSET_REFERENCE_ABSENT", null)).toBe(
      CALENDAR_BLOCKER_CODE.BUNDLE_REFERENCE_ABSENT,
    );
    expect(classifyRetrievalFailure("ASSET_RETRIEVAL_FAILED", "TIMEOUT")).toBe(
      CALENDAR_BLOCKER_CODE.BUNDLE_RETRIEVAL_FAILED,
    );
    expect(classifyRetrievalFailure("ASSET_BELOW_SIZE_FLOOR", null)).toBe(
      CALENDAR_BLOCKER_CODE.ARTEFACT_TRUNCATED_BELOW_FLOOR,
    );
    expect(classifyRetrievalFailure("ASSET_IDENTITY_ANCHOR_ABSENT", null)).toBe(
      CALENDAR_BLOCKER_CODE.ARTEFACT_IDENTITY_ANCHOR_ABSENT,
    );
  });
});
