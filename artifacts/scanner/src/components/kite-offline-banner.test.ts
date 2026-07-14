import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMockProviderStatus, headlineFor } from "./kite-offline-banner";

/**
 * Unit tests for the dev-only `?mockProvider=` override on the
 * KiteOfflineBanner. Pins:
 *   1. Each documented mock key maps to the expected MarketDataHealthPublic shape.
 *   2. `?mockProvider=off` (and `clear`) drops the override.
 *   3. The override is hard-gated by `import.meta.env.DEV` — flipping
 *      DEV to false makes every key a no-op (production safety).
 *   4. The URL `?mockProvider=` param is stripped after parsing so it
 *      doesn't get accidentally shared in screenshots / pasted links.
 *
 * NOTE (2026-07-01 shape change): getMockProviderStatus() now returns
 * MarketDataHealthPublic (from /api/data-health/market) rather than the old
 * { active, liveAvailable, reason } shape from /api/provider/status.
 * Keys that existed in the old API (no_creds, generic) have no equivalent in
 * the new contract and return null. New keys: waiting, market_closed.
 */

/**
 * jsdom locks `replaceState` to the same origin as the configured page URL,
 * so we use search-only relative paths here. The vitest config pins the
 * page origin to `http://localhost/` via `testEnvironmentOptions.url`.
 */
function setSearch(search: string) {
  window.history.replaceState({}, "", search || "/");
}

beforeEach(() => {
  setSearch("/");
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getMockProviderStatus — DEV-mode key → MarketDataHealthPublic shape", () => {
  it("returns null when no override is set (default)", () => {
    expect(getMockProviderStatus()).toBeNull();
  });

  it("'session' key → quoteStatus=UNAVAILABLE, sessionStatus=EXPIRED", () => {
    setSearch("?mockProvider=session");
    const s = getMockProviderStatus();
    expect(s).not.toBeNull();
    expect(s?.kite.quoteStatus).toBe("UNAVAILABLE");
    expect(s?.kite.sessionStatus).toBe("EXPIRED");
    expect(s?.overall.severity).toBe("red");
    expect(s?.overall.actionRequired).toBe(true);
  });

  it("'disconnected' key → quoteStatus=STALE, session ACTIVE", () => {
    setSearch("?mockProvider=disconnected");
    const s = getMockProviderStatus();
    expect(s).not.toBeNull();
    expect(s?.kite.quoteStatus).toBe("STALE");
    expect(s?.kite.sessionStatus).toBe("ACTIVE");
    expect(s?.overall.severity).toBe("orange");
    expect(s?.overall.actionRequired).toBe(false);
  });

  it("'waiting' key → quoteStatus=CONNECTED_WAITING, session ACTIVE", () => {
    setSearch("?mockProvider=waiting");
    const s = getMockProviderStatus();
    expect(s).not.toBeNull();
    expect(s?.kite.quoteStatus).toBe("CONNECTED_WAITING");
    expect(s?.kite.sessionStatus).toBe("ACTIVE");
    expect(s?.overall.severity).toBe("yellow");
    expect(s?.overall.actionRequired).toBe(false);
  });

  it("'market_closed' key → quoteStatus=MARKET_CLOSED_SESSION_ACTIVE (banner should hide)", () => {
    setSearch("?mockProvider=market_closed");
    const s = getMockProviderStatus();
    expect(s).not.toBeNull();
    expect(s?.kite.quoteStatus).toBe("MARKET_CLOSED_SESSION_ACTIVE");
    expect(s?.marketSession).toBe("closed");
    expect(s?.overall.severity).toBe("green");
    expect(s?.overall.actionRequired).toBe(false);
  });

  it("'kite' key → quoteStatus=LIVE_TICKS (banner should hide)", () => {
    setSearch("?mockProvider=kite");
    const s = getMockProviderStatus();
    expect(s).not.toBeNull();
    expect(s?.kite.quoteStatus).toBe("LIVE_TICKS");
    expect(s?.marketSession).toBe("open");
    expect(s?.overall.severity).toBe("green");
  });

  it("unknown key → null (graceful fallback to real fetch)", () => {
    setSearch("?mockProvider=garbage");
    expect(getMockProviderStatus()).toBeNull();
  });

  it("old key 'no_creds' → null (key removed; old /provider/status shape no longer emitted)", () => {
    setSearch("?mockProvider=no_creds");
    expect(getMockProviderStatus()).toBeNull();
  });

  it("old key 'generic' → null (key removed)", () => {
    setSearch("?mockProvider=generic");
    expect(getMockProviderStatus()).toBeNull();
  });
});

describe("getMockProviderStatus — clearing the override", () => {
  it("'?mockProvider=off' clears a previously-set sessionStorage key", () => {
    window.sessionStorage.setItem("mockProvider", "session");
    setSearch("?mockProvider=off");
    expect(getMockProviderStatus()).toBeNull();
    expect(window.sessionStorage.getItem("mockProvider")).toBeNull();
  });

  it("'?mockProvider=clear' is an alias for 'off'", () => {
    window.sessionStorage.setItem("mockProvider", "session");
    setSearch("?mockProvider=clear");
    expect(getMockProviderStatus()).toBeNull();
    expect(window.sessionStorage.getItem("mockProvider")).toBeNull();
  });

  it("override survives navigation via sessionStorage even after URL param is stripped", () => {
    // First hit: param sets sessionStorage AND is stripped from the URL.
    setSearch("?mockProvider=session");
    const first = getMockProviderStatus();
    expect(first?.kite.quoteStatus).toBe("UNAVAILABLE");
    // The URL no longer carries the param (so no accidental share-leak).
    expect(window.location.search).toBe("");
    // Second call (simulating a navigation / re-render with no URL param):
    const second = getMockProviderStatus();
    expect(second?.kite.quoteStatus).toBe("UNAVAILABLE");
  });
});

describe("getMockProviderStatus — production safety (import.meta.env.DEV gate)", () => {
  it("returns null in production builds even when ?mockProvider= is set in the URL", () => {
    vi.stubEnv("DEV", false);
    setSearch("?mockProvider=session");
    expect(getMockProviderStatus()).toBeNull();
    // And nothing was written to sessionStorage either — no leakage.
    expect(window.sessionStorage.getItem("mockProvider")).toBeNull();
  });

  it("returns null in production builds even when sessionStorage already has a key", () => {
    window.sessionStorage.setItem("mockProvider", "session");
    vi.stubEnv("DEV", false);
    expect(getMockProviderStatus()).toBeNull();
  });
});

describe("headlineFor — backward-compat shim (deprecated but still exported)", () => {
  it("session-expired text → 'Kite session expired — please re-login'", () => {
    expect(headlineFor("Complete Kite daily login to enable live data")).toBe(
      "Kite session expired — please re-login",
    );
  });

  it("disconnected text → 'Kite WebSocket disconnected — falling back to Yahoo'", () => {
    expect(headlineFor("WebSocket disconnected")).toBe(
      "Kite WebSocket disconnected — falling back to Yahoo",
    );
  });

  it("api key text → 'Kite API credentials not configured'", () => {
    expect(headlineFor("KITE_API_KEY not set")).toBe(
      "Kite API credentials not configured",
    );
  });

  it("unrecognised reason falls through to the neutral default", () => {
    expect(headlineFor("something completely new")).toBe(
      "Live Zerodha feed unavailable — using delayed Yahoo data",
    );
  });

  it("empty string falls through to neutral default (never crashes)", () => {
    expect(headlineFor("")).toBe(
      "Live Zerodha feed unavailable — using delayed Yahoo data",
    );
  });
});
