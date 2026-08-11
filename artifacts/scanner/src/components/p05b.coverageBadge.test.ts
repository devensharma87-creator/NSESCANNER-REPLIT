/**
 * Data Foundation Phase 0.5B — Section J, test 30 (frontend counterpart).
 *
 * The backend can be perfectly honest and the product still lies, if a badge
 * renders "live" off a partial feed. These tests pin the UI contract:
 *
 *   - No surface may present LIVE_COMPLETE (or an unqualified "Kite live")
 *     while coverage authority is LEGACY_PARTIAL_CONFIGURATION.
 *   - The counts shown must be the real ones, against BOTH denominators.
 *   - Missing coverage must degrade to the legacy label, never to a fabricated
 *     "complete" claim.
 *
 * Pure-function tests only — no DOM render, no network.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { deriveBannerView, type BannerCoverage } from "./global-status-banner";
import { coverageSummaryLine, type MarketCoverage } from "./kite-offline-banner";

const HERE = __dirname;

const READY = {
  state: "KITE_READY",
  marketSession: "open",
} as unknown as Parameters<typeof deriveBannerView>[0];

const LEGACY_PARTIAL: BannerCoverage = {
  overallState: "LIVE_PARTIAL",
  freshInstrumentCount: 58,
  requiredInstrumentCount: 58,
};

function coverage(over: Partial<MarketCoverage> = {}): MarketCoverage {
  return {
    overallState: "LIVE_PARTIAL",
    coverageAuthority: "LEGACY_PARTIAL_CONFIGURATION",
    requiredInstrumentCount: 58,
    subscribedInstrumentCount: 58,
    freshInstrumentCount: 58,
    staleInstrumentCount: 0,
    unavailableInstrumentCount: 0,
    conflictedInstrumentCount: 0,
    pendingReconciliationCount: 0,
    coveragePct: 100,
    blockers: ["AUTHORITATIVE_UNIVERSE_NOT_CONFIGURED"],
    authoritative: {
      coverageAuthority: "UNIVERSE_NOT_CONFIGURED",
      requiredInstrumentCount: 0,
      freshInstrumentCount: 0,
      coveragePct: 0,
    },
    ...over,
  };
}

describe("J30: frontend never presents partial coverage as complete", () => {
  it("does not render an unqualified 'Kite live' chip under legacy partial coverage", () => {
    const view = deriveBannerView(READY, 58, LEGACY_PARTIAL);
    expect(view.chipLabel).not.toBe("Kite live");
    expect(view.headline).not.toBe("Kite live");
    // The claim must be qualified, and it must carry the real numbers.
    expect(view.chipLabel).toContain("58/58");
    expect(view.impact).toContain("not whole-market coverage");
  });

  it("does not paint the chip green (tone 'ok') while coverage is incomplete", () => {
    // tone 'ok' is the all-clear. Reserving it for LIVE_COMPLETE is the whole
    // point of the phase: a green chip IS a completeness claim.
    for (const state of [
      "LIVE_PARTIAL",
      "RECONCILIATION_PENDING",
      "CONFLICTED",
      "STALE",
      "UNAVAILABLE",
      "INITIALIZING",
      "UNIVERSE_NOT_CONFIGURED",
      "MARKET_CLOSED_PARTIAL",
    ]) {
      const view = deriveBannerView(READY, 58, { ...LEGACY_PARTIAL, overallState: state });
      expect(view.tone).not.toBe("ok");
    }
  });

  it("allows the plain green 'Kite live' chip ONLY on LIVE_COMPLETE", () => {
    const view = deriveBannerView(READY, 58, { ...LEGACY_PARTIAL, overallState: "LIVE_COMPLETE" });
    expect(view.chipLabel).toBe("Kite live");
    expect(view.tone).toBe("ok");
  });

  it("falls back to the legacy label when coverage is absent — never invents completeness", () => {
    const view = deriveBannerView(READY, 58);
    expect(view.chipLabel).toBe("Kite live");
    // Absent coverage must not be reported as a coverage FACT anywhere.
    expect(view.impact).not.toContain("configured instruments");
  });

  it("keeps existing non-ready states untouched (no regression from the new argument)", () => {
    const expired = { state: "KITE_EXPIRED", marketSession: "open" } as unknown as Parameters<typeof deriveBannerView>[0];
    expect(deriveBannerView(expired, 58, LEGACY_PARTIAL).chipLabel).toBe("Kite session expired");
    const offline = { state: "KITE_OFFLINE_MARKET_HOURS", marketSession: "open" } as unknown as Parameters<typeof deriveBannerView>[0];
    expect(deriveBannerView(offline, 0, LEGACY_PARTIAL).tone).toBe("critical");
  });
});

describe("J30: coverage summary states both denominators honestly", () => {
  it("names the authoritative-universe gap explicitly instead of rounding it away", () => {
    const line = coverageSummaryLine(coverage());
    expect(line).toContain("58/58 configured instruments fresh");
    expect(line).toContain("full-market universe not configured");
    expect(line).toContain("NOT whole-market coverage");
    // 100% configured coverage must never be phrased as 100% market coverage.
    expect(line).not.toMatch(/100% of the market|full coverage|complete coverage/i);
  });

  it("surfaces stale, unavailable, conflicted and pending counts when non-zero", () => {
    const line = coverageSummaryLine(
      coverage({
        freshInstrumentCount: 40,
        staleInstrumentCount: 8,
        unavailableInstrumentCount: 6,
        conflictedInstrumentCount: 4,
        pendingReconciliationCount: 2,
        coveragePct: 69,
      }),
    );
    expect(line).toContain("40/58 configured instruments fresh");
    expect(line).toContain("8 stale");
    expect(line).toContain("6 unavailable");
    expect(line).toContain("4 conflicted");
    expect(line).toContain("2 pending token reconciliation");
  });

  it("omits zero-valued problem counts rather than printing reassuring zeros", () => {
    const line = coverageSummaryLine(coverage());
    expect(line).not.toContain("0 stale");
    expect(line).not.toContain("0 unavailable");
    expect(line).not.toContain("0 conflicted");
  });

  it("reports real authoritative numbers once a universe IS configured", () => {
    const line = coverageSummaryLine(
      coverage({
        authoritative: {
          coverageAuthority: "AUTHORITATIVE_RECONCILED_UNIVERSE",
          requiredInstrumentCount: 7890,
          freshInstrumentCount: 58,
          coveragePct: 1,
        },
      }),
    );
    expect(line).toContain("58/7890 of the full market universe");
    expect(line).not.toContain("not configured");
  });
});

describe("J30: no owner-only detail and no Yahoo-as-Indian-fallback in coverage UI", () => {
  const banner = readFileSync(join(HERE, "kite-offline-banner.tsx"), "utf8");
  const status = readFileSync(join(HERE, "global-status-banner.tsx"), "utf8");
  const infra = readFileSync(join(HERE, "../pages/infra-health.tsx"), "utf8");

  it("renders no provider token, canonical id, or credential in the coverage surfaces", () => {
    for (const src of [banner, status]) {
      expect(src).not.toMatch(/providerInstrumentToken|canonicalInstrumentId|accessToken|apiKey/);
    }
  });

  it("never converts an unavailable instrument into a zero-valued price", () => {
    // The coverage surfaces report counts of unavailable instruments; they must
    // not coerce a missing value into 0 anywhere in that path.
    expect(banner).not.toMatch(/coverage\.[A-Za-z]+ \?\? 0/);
    expect(status).not.toMatch(/coverage\.[A-Za-z]+ \?\? 0/);
  });

  it("does not present Yahoo as an Indian-market live fallback in the coverage block", () => {
    // Yahoo may still be named in the legacy session-expired copy, but it must
    // never appear as part of a coverage claim.
    // Anchored on the block's own testid — "market data coverage" appears in
    // unrelated prose elsewhere on this page.
    const start = infra.indexOf('data-testid="global-health-coverage"');
    expect(start).toBeGreaterThan(-1);
    const coverageBlock = infra.slice(start, infra.indexOf("Module Readiness", start));
    expect(coverageBlock.length).toBeGreaterThan(200);
    expect(coverageBlock.toLowerCase()).not.toContain("yahoo");
  });

  it("shows configured and authoritative coverage as SEPARATE rows on the diagnostics page", () => {
    expect(infra).toContain("Configured scope:");
    expect(infra).toContain("Authoritative universe:");
    expect(infra).toContain("coverage.authoritative.coveragePct");
  });
});

describe("J30: the market-closed chip is session-scoped, and still warns on integrity faults", () => {
  const CLOSED = { state: "KITE_READY", marketSession: "closed" } as unknown as Parameters<typeof deriveBannerView>[0];

  it("stays green for the expected after-hours case but names the coverage state", () => {
    const view = deriveBannerView(CLOSED, 0, { ...LEGACY_PARTIAL, overallState: "STALE" });
    expect(view.tone).toBe("ok");
    // The green label must be about the SESSION, never a data claim.
    expect(view.chipLabel).toBe("Kite — market closed");
    expect(view.impact).toContain("STALE");
    expect(view.impact).toContain("configured instruments");
  });

  it("warns when coverage reports a genuine integrity fault, even with the market shut", () => {
    for (const state of ["CONFLICTED", "RECONCILIATION_PENDING"]) {
      const view = deriveBannerView(CLOSED, 0, { ...LEGACY_PARTIAL, overallState: state });
      expect(view.tone).toBe("warn");
      expect(view.chipLabel).toBe("Kite — data integrity issue");
      expect(view.impact).toContain(state);
    }
  });

  it("does not fabricate coverage wording when coverage is unavailable", () => {
    const view = deriveBannerView(CLOSED, 0);
    expect(view.tone).toBe("ok");
    expect(view.impact).not.toContain("Coverage state");
  });
});
