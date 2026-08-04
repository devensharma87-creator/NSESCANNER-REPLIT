/**
 * Pack 6 Gate I — Design system & data-state component tests.
 *
 * Uses jsdom + createRoot/act (no @testing-library/react) matching scanner convention.
 *
 * Covers:
 *   I-1  DataStatePanel renders all 10 canonical states (sm + md)
 *   I-2  DataStatePanel shows stale last-updated text when provided
 *   I-3  DataStatePanel shows retry button, calls onRetry
 *   I-4  DataStatePanel hides retry for LOADING and CLOSED
 *   I-5  DataStatePanel loading has aria-live="polite"
 *   I-6  resolveProvenanceState — 8 pure-function cases
 *   I-7  ProvenanceBadge renders DELAYED badge for Yahoo sources
 *   I-8  ProvenanceBadge renders STALE badge when stale=true
 *   I-9  ProvenanceBadge renders UNAVAILABLE when sourceHealthy=false
 *   I-10 ProvenanceBadge returns null for UNKNOWN
 *   I-11 ProvenanceBadge returns null for LIVE without showLive=true
 *   I-12 ProvenanceBadge renders LIVE badge when showLive=true
 *   I-13 PageHeader renders h1 with correct text
 *   I-14 PageHeader renders breadcrumb aria nav
 *   I-15 PageHeader renders actions slot
 *   I-16 DataStatePanel data-testid pattern is consistent
 */

import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";

import { DataStatePanel, type DataState } from "@/components/ui/data-state-panel";
import {
  ProvenanceBadge,
  resolveProvenanceState,
} from "@/components/ui/provenance-badge";
import { PageHeader } from "@/components/ui/page-header";

// wouter stub
vi.mock("wouter", () => ({
  Link: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href?: string }) =>
    React.createElement("a", { href, ...rest }, children),
  useLocation: () => ["/", vi.fn()],
}));

// ── helpers ───────────────────────────────────────────────────────────────────

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function setup() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
}

function renderInto(jsx: React.ReactNode) {
  act(() => { root!.render(jsx); });
}

function cleanup() {
  if (!root || !container) return;
  act(() => { root!.unmount(); });
  container.remove();
  root = null;
  container = null;
}

// ── I-1: all states ───────────────────────────────────────────────────────────

const ALL_STATES: DataState[] = [
  "LOADING", "READY_LIVE", "READY_DELAYED", "READY_STALE", "READY_PARTIAL",
  "EMPTY_VALID", "DEGRADED", "UNAVAILABLE", "ERROR", "CLOSED",
];

describe("DataStatePanel", () => {
  afterEach(cleanup);

  it("I-1: renders all 10 states (md size) without crash", () => {
    for (const state of ALL_STATES) {
      setup();
      renderInto(<DataStatePanel state={state} />);
      const el = container!.querySelector(`[data-testid="data-state-panel-${state.toLowerCase()}"]`);
      expect(el, `Missing testid for state ${state}`).toBeTruthy();
      cleanup();
    }
  });

  it("I-1b: renders all 10 states (sm size) without crash", () => {
    for (const state of ALL_STATES) {
      setup();
      renderInto(<DataStatePanel state={state} size="sm" />);
      const el = container!.querySelector(`[data-testid="data-state-panel-${state.toLowerCase()}"]`);
      expect(el, `Missing sm testid for state ${state}`).toBeTruthy();
      cleanup();
    }
  });

  it("I-2: shows stale last-updated text for READY_STALE", () => {
    setup();
    const past = Date.now() - 120_000;
    renderInto(<DataStatePanel state="READY_STALE" size="lg" lastUpdated={past} sourceName="Kite" />);
    const text = container!.textContent ?? "";
    expect(text).toContain("Last updated");
    expect(text).toContain("Kite");
  });

  it("I-3: retry button calls onRetry for ERROR state", () => {
    setup();
    const onRetry = vi.fn();
    renderInto(<DataStatePanel state="ERROR" onRetry={onRetry} retryLabel="Try again" />);
    const btn = container!.querySelector("button");
    expect(btn).toBeTruthy();
    act(() => { btn!.click(); });
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("I-4: no retry button for LOADING", () => {
    setup();
    renderInto(<DataStatePanel state="LOADING" onRetry={vi.fn()} />);
    expect(container!.querySelector("button")).toBeNull();
  });

  it("I-4b: no retry button for CLOSED", () => {
    setup();
    renderInto(<DataStatePanel state="CLOSED" onRetry={vi.fn()} />);
    expect(container!.querySelector("button")).toBeNull();
  });

  it("I-5: LOADING state has aria-live=polite on status element", () => {
    setup();
    renderInto(<DataStatePanel state="LOADING" />);
    const el = container!.querySelector("[role='status']");
    expect(el?.getAttribute("aria-live")).toBe("polite");
  });

  it("I-5b: non-LOADING states do NOT have aria-live", () => {
    setup();
    renderInto(<DataStatePanel state="ERROR" />);
    const el = container!.querySelector("[role='status']");
    expect(el?.getAttribute("aria-live")).toBeNull();
  });

  it("I-16: testid follows data-state-panel-<lowercase state> pattern", () => {
    setup();
    renderInto(<DataStatePanel state="EMPTY_VALID" />);
    expect(container!.querySelector("[data-testid='data-state-panel-empty_valid']")).toBeTruthy();
  });

  it("I-2b: shows delayed source for READY_DELAYED (lg)", () => {
    setup();
    renderInto(<DataStatePanel state="READY_DELAYED" size="lg" sourceName="Yahoo Finance" />);
    expect(container!.textContent).toContain("Yahoo Finance");
  });

  it("I-2c: shows missing items for READY_PARTIAL (lg)", () => {
    setup();
    renderInto(<DataStatePanel state="READY_PARTIAL" size="lg" missingItems={["OI data", "Sector heat"]} />);
    const text = container!.textContent ?? "";
    expect(text).toContain("OI data");
    expect(text).toContain("Sector heat");
  });

  it("I-3b: retry button is disabled while retrying=true", () => {
    setup();
    renderInto(<DataStatePanel state="ERROR" onRetry={vi.fn()} retrying={true} />);
    const btn = container!.querySelector("button") as HTMLButtonElement | null;
    expect(btn?.disabled).toBe(true);
  });

  it("I-1c: custom title and description override defaults", () => {
    setup();
    renderInto(<DataStatePanel state="ERROR" title="Custom Error" description="Something went wrong with X." />);
    const text = container!.textContent ?? "";
    expect(text).toContain("Custom Error");
    expect(text).toContain("Something went wrong with X.");
  });

  it("I-2d: children slot is rendered inside panel", () => {
    setup();
    renderInto(
      <DataStatePanel state="EMPTY_VALID">
        <span data-testid="child-slot">child</span>
      </DataStatePanel>,
    );
    expect(container!.querySelector("[data-testid='child-slot']")).toBeTruthy();
  });
});

// ── I-6 resolveProvenanceState ────────────────────────────────────────────────

describe("resolveProvenanceState", () => {
  it("I-6a: UNAVAILABLE wins over stale", () => {
    expect(resolveProvenanceState({ source: "kite", stale: true, sourceHealthy: false })).toBe("UNAVAILABLE");
  });

  it("I-6b: STALE wins over DELAYED", () => {
    expect(resolveProvenanceState({ source: "yahoo", stale: true, sourceHealthy: true })).toBe("STALE");
  });

  it("I-6c: SECONDARY for IndianAPI source", () => {
    expect(resolveProvenanceState({ source: "indianapi", stale: false })).toBe("SECONDARY");
  });

  it("I-6d: DELAYED for Yahoo variants", () => {
    for (const src of ["yahoo", "yahoo-fx", "yahoo-equity", "yahoo-index"]) {
      expect(resolveProvenanceState({ source: src, stale: false }), src).toBe("DELAYED");
    }
  });

  it("I-6e: LIVE for kite source", () => {
    expect(resolveProvenanceState({ source: "kite", stale: false })).toBe("LIVE");
  });

  it("I-6f: LIVE when isLive=true regardless of source", () => {
    expect(resolveProvenanceState({ isLive: true })).toBe("LIVE");
  });

  it("I-6g: UNKNOWN for unrecognised source", () => {
    expect(resolveProvenanceState({ source: "acme", stale: false })).toBe("UNKNOWN");
  });

  it("I-6h: UNKNOWN when no source provided", () => {
    expect(resolveProvenanceState({ stale: false })).toBe("UNKNOWN");
  });
});

// ── I-7 to I-12 ProvenanceBadge rendering ────────────────────────────────────

describe("ProvenanceBadge", () => {
  afterEach(cleanup);

  it("I-7: renders delayed badge for yahoo source", () => {
    setup();
    renderInto(<ProvenanceBadge source="yahoo" stale={false} />);
    const el = container!.querySelector("[data-testid='badge-delayed']");
    expect(el).toBeTruthy();
    expect(el?.getAttribute("data-state")).toBe("DELAYED");
  });

  it("I-8: renders stale badge when stale=true", () => {
    setup();
    renderInto(<ProvenanceBadge source="kite" stale={true} />);
    expect(container!.querySelector("[data-testid='badge-stale']")).toBeTruthy();
  });

  it("I-9: renders unavailable when sourceHealthy=false", () => {
    setup();
    renderInto(<ProvenanceBadge source="kite" stale={false} sourceHealthy={false} />);
    expect(container!.querySelector("[data-testid='badge-unavailable']")).toBeTruthy();
  });

  it("I-10: returns null for UNKNOWN source", () => {
    setup();
    renderInto(<ProvenanceBadge source="acme" stale={false} />);
    expect(container!.firstChild).toBeNull();
  });

  it("I-11: returns null for LIVE without showLive=true", () => {
    setup();
    renderInto(<ProvenanceBadge source="kite" stale={false} />);
    expect(container!.firstChild).toBeNull();
  });

  it("I-12: renders LIVE badge when showLive=true", () => {
    setup();
    renderInto(<ProvenanceBadge source="kite" stale={false} showLive={true} />);
    expect(container!.querySelector("[data-testid='badge-live']")).toBeTruthy();
  });

  it("I-7b: secondary badge for indianapi", () => {
    setup();
    renderInto(<ProvenanceBadge source="indianapi" stale={false} />);
    expect(container!.querySelector("[data-testid='badge-secondary']")).toBeTruthy();
  });

  it("I-7c: UNAVAILABLE wins over STALE (priority order)", () => {
    setup();
    renderInto(<ProvenanceBadge source="yahoo" stale={true} sourceHealthy={false} />);
    expect(container!.querySelector("[data-testid='badge-unavailable']")).toBeTruthy();
    expect(container!.querySelector("[data-testid='badge-stale']")).toBeNull();
  });
});

// ── I-13 to I-15 PageHeader ───────────────────────────────────────────────────

describe("PageHeader", () => {
  afterEach(cleanup);

  it("I-13: renders h1 with correct text", () => {
    setup();
    renderInto(<PageHeader title="Stock Scanner" />);
    expect(container!.querySelector("h1")?.textContent).toBe("Stock Scanner");
  });

  it("I-14: breadcrumbs render aria nav with aria-current on last crumb", () => {
    setup();
    renderInto(
      <PageHeader
        title="RELIANCE"
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: "Watchlist", href: "/watchlist" },
          { label: "RELIANCE" },
        ]}
      />,
    );
    const nav = container!.querySelector("nav[aria-label]");
    expect(nav?.getAttribute("aria-label")).toMatch(/breadcrumb/i);
    const links = Array.from(container!.querySelectorAll("a"));
    expect(links.some(l => l.getAttribute("href") === "/")).toBe(true);
    const pageCrumbs = Array.from(container!.querySelectorAll("[aria-current='page']"));
    expect(pageCrumbs.length).toBeGreaterThan(0);
  });

  it("I-15: renders actions slot content", () => {
    setup();
    renderInto(
      <PageHeader
        title="Paper Trading"
        actions={<button data-testid="action-btn">Refresh</button>}
      />,
    );
    expect(container!.querySelector("[data-testid='action-btn']")).toBeTruthy();
  });

  it("I-13b: renders section label above h1", () => {
    setup();
    renderInto(<PageHeader title="F&O Options" section="Derivatives" />);
    expect(container!.textContent).toContain("Derivatives");
    expect(container!.querySelector("h1")?.textContent).toBe("F&O Options");
  });

  it("I-13c: renders description below title", () => {
    setup();
    renderInto(<PageHeader title="Watchlist" description="Saved baskets and short-term trend view." />);
    expect(container!.textContent).toContain("Saved baskets");
  });

  it("I-13d: page-header testid is present", () => {
    setup();
    renderInto(<PageHeader title="Dashboard" />);
    expect(container!.querySelector("[data-testid='page-header']")).toBeTruthy();
  });
});
