/**
 * Regression: the Live Feed page (Market Pulse → Live Feed) crashed with
 * "Cannot read properties of undefined (reading 'running')".
 *
 * Root cause: /api/kite/status is owner-gated and answers 401 with a JSON
 * error body. The query accepted that body as data, so `data.feed` was
 * undefined and `data.feed.running` threw during render, taking the whole
 * page down. A non-OK response must be an ERROR, never data.
 */

import { describe, it, expect } from "vitest";

import { parseKiteStatus } from "./kite";

const VALID = {
  credentialsConfigured: true,
  apiKeyPreview: "abc***",
  loggedIn: true,
  userId: "AB1234",
  userName: "Owner",
  loginTime: "2026-08-12T03:45:00.000Z",
  expiresAt: "2026-08-12T02:30:00.000Z",
  feed: {
    running: true,
    connected: true,
    subscribed: 58,
    liveQuotes: 58,
    lastConnectAt: null,
    lastDisconnectAt: null,
    lastError: null,
  },
};

describe("parseKiteStatus", () => {
  it("rejects a 401 error body instead of treating it as status data", () => {
    // This is the exact body that crashed the page.
    expect(() => parseKiteStatus(false, 401, { error: "AUTH_REQUIRED" })).toThrow("AUTH_REQUIRED");
  });

  it("rejects 403 as an auth failure too", () => {
    expect(() => parseKiteStatus(false, 403, { error: "FORBIDDEN" })).toThrow("AUTH_REQUIRED");
  });

  it("reports other HTTP failures with their status code", () => {
    expect(() => parseKiteStatus(false, 500, null)).toThrow("KITE_STATUS_HTTP_500");
    expect(() => parseKiteStatus(false, 502, null)).toThrow("KITE_STATUS_HTTP_502");
  });

  it("rejects an OK response that is missing the feed object", () => {
    // Without this guard `s.feed.running` throws exactly as before.
    const { feed: _omitted, ...noFeed } = VALID;
    expect(() => parseKiteStatus(true, 200, noFeed)).toThrow("KITE_STATUS_MALFORMED");
    expect(() => parseKiteStatus(true, 200, null)).toThrow("KITE_STATUS_MALFORMED");
    expect(() => parseKiteStatus(true, 200, "not-an-object")).toThrow("KITE_STATUS_MALFORMED");
    expect(() => parseKiteStatus(true, 200, { ...VALID, feed: null })).toThrow("KITE_STATUS_MALFORMED");
  });

  it("returns a well-formed status untouched", () => {
    const parsed = parseKiteStatus(true, 200, VALID);
    expect(parsed.feed.running).toBe(true);
    expect(parsed.feed.subscribed).toBe(58);
    expect(parsed.loggedIn).toBe(true);
  });

  it("never fabricates a feed object to keep rendering alive", () => {
    // A defaulted `feed: { running: false, ... }` would render "Running: No"
    // and "Live Quotes: 0" — an invented claim about the feed. It must throw.
    let threw = false;
    try {
      parseKiteStatus(false, 401, { error: "AUTH_REQUIRED" });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
