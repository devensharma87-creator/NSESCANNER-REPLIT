import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMockProviderStatus, headlineFor } from "./kite-offline-banner";

/**
 * Unit tests for the dev-only `?mockProvider=` override on the
 * KiteOfflineBanner. Pins:
 *   1. Each documented mock key maps to the expected status/copy path.
 *   2. `?mockProvider=off` (and `clear`) drops the override.
 *   3. The override is hard-gated by `import.meta.env.DEV` — flipping
 *      DEV to false makes every key a no-op (production safety).
 *   4. The URL `?mockProvider=` param is stripped after parsing so it
 *      doesn't get accidentally shared in screenshots / pasted links.
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

describe("getMockProviderStatus — DEV-mode key → status payload mapping", () => {
  it("returns null when no override is set (default)", () => {
    expect(getMockProviderStatus()).toBeNull();
  });

  it("'session' key → yahoo + session-expired reason → headline routes to 'Kite session expired'", () => {
    setSearch("?mockProvider=session");
    const s = getMockProviderStatus();
    expect(s).toEqual({
      active: "yahoo",
      liveAvailable: false,
      reason: "Complete Kite daily login to enable live data",
    });
    expect(headlineFor(s!.reason)).toBe("Kite session expired — please re-login");
  });

  it("'disconnected' key → yahoo + websocket reason → headline routes to 'Kite WebSocket disconnected'", () => {
    setSearch("?mockProvider=disconnected");
    const s = getMockProviderStatus();
    expect(s?.active).toBe("yahoo");
    expect(s?.reason).toMatch(/disconnected/i);
    expect(headlineFor(s!.reason)).toBe(
      "Kite WebSocket disconnected — falling back to Yahoo",
    );
  });

  it("'no_creds' key → yahoo + KITE_API_KEY reason → headline routes to 'credentials not configured'", () => {
    setSearch("?mockProvider=no_creds");
    const s = getMockProviderStatus();
    expect(s?.active).toBe("yahoo");
    expect(s?.reason).toMatch(/KITE_API_KEY/);
    expect(headlineFor(s!.reason)).toBe("Kite API credentials not configured");
  });

  it("'generic' key → yahoo + generic reason → headline routes to neutral default", () => {
    setSearch("?mockProvider=generic");
    const s = getMockProviderStatus();
    expect(s?.active).toBe("yahoo");
    expect(headlineFor(s!.reason)).toBe(
      "Live Zerodha feed unavailable — using delayed Yahoo data",
    );
  });

  it("'kite' key → active='kite' (banner hidden — useful for clearing the override visually)", () => {
    setSearch("?mockProvider=kite");
    expect(getMockProviderStatus()).toEqual({
      active: "kite",
      liveAvailable: true,
      reason: "Live Kite ticks streaming",
    });
  });

  it("unknown key → null (graceful fallback to real fetch)", () => {
    setSearch("?mockProvider=garbage");
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
    expect(getMockProviderStatus()?.reason).toMatch(/Complete Kite daily login/);
    // The URL no longer carries the param (so no accidental share-leak).
    expect(window.location.search).toBe("");
    // Second call (simulating a navigation / re-render with no URL param):
    expect(getMockProviderStatus()?.reason).toMatch(/Complete Kite daily login/);
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

describe("headlineFor — defensive defaults", () => {
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
