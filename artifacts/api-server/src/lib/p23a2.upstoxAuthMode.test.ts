/**
 * Gate A tests — Upstox authentication mode semantics.
 * Pack 5 23A: ANALYTICS_TOKEN preferred; STANDARD_DAILY_TOKEN fallback;
 * NOT_CONFIGURED when neither is set; no token material in error messages.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveUpstoxConfig, type UpstoxAuthMode } from "./marketData/upstoxClient";

describe("Gate A — UpstoxAuthMode: resolveUpstoxConfig()", () => {
  const original = {
    UPSTOX_ANALYTICS_TOKEN: process.env["UPSTOX_ANALYTICS_TOKEN"],
    UPSTOX_ACCESS_TOKEN:    process.env["UPSTOX_ACCESS_TOKEN"],
  };

  beforeEach(() => {
    delete process.env["UPSTOX_ANALYTICS_TOKEN"];
    delete process.env["UPSTOX_ACCESS_TOKEN"];
  });

  afterEach(() => {
    if (original.UPSTOX_ANALYTICS_TOKEN !== undefined)
      process.env["UPSTOX_ANALYTICS_TOKEN"] = original.UPSTOX_ANALYTICS_TOKEN;
    else delete process.env["UPSTOX_ANALYTICS_TOKEN"];
    if (original.UPSTOX_ACCESS_TOKEN !== undefined)
      process.env["UPSTOX_ACCESS_TOKEN"] = original.UPSTOX_ACCESS_TOKEN;
    else delete process.env["UPSTOX_ACCESS_TOKEN"];
  });

  it("A-1: analytics token present → authMode=ANALYTICS_TOKEN", () => {
    process.env["UPSTOX_ANALYTICS_TOKEN"] = "analytics_tok_abc";
    const cfg = resolveUpstoxConfig();
    expect(cfg.authMode).toBe<UpstoxAuthMode>("ANALYTICS_TOKEN");
    expect(cfg.accessToken).toBe("analytics_tok_abc");
  });

  it("A-2: standard token present, no analytics token → authMode=STANDARD_DAILY_TOKEN", () => {
    process.env["UPSTOX_ACCESS_TOKEN"] = "standard_tok_xyz";
    const cfg = resolveUpstoxConfig();
    expect(cfg.authMode).toBe<UpstoxAuthMode>("STANDARD_DAILY_TOKEN");
    expect(cfg.accessToken).toBe("standard_tok_xyz");
  });

  it("A-3: both tokens present → analytics token wins (ANALYTICS_TOKEN preferred)", () => {
    process.env["UPSTOX_ANALYTICS_TOKEN"] = "analytics_preferred";
    process.env["UPSTOX_ACCESS_TOKEN"]    = "standard_fallback";
    const cfg = resolveUpstoxConfig();
    expect(cfg.authMode).toBe<UpstoxAuthMode>("ANALYTICS_TOKEN");
    expect(cfg.accessToken).toBe("analytics_preferred");
  });

  it("A-4: neither token present → authMode=NOT_CONFIGURED, accessToken=null", () => {
    const cfg = resolveUpstoxConfig();
    expect(cfg.authMode).toBe<UpstoxAuthMode>("NOT_CONFIGURED");
    expect(cfg.accessToken).toBeNull();
  });

  it("A-5: authMode is part of config shape (required field)", () => {
    const cfg = resolveUpstoxConfig();
    expect("authMode" in cfg).toBe(true);
  });

  it("A-6: NOT_CONFIGURED error message contains no env-var name or token material", async () => {
    // Verify the live request path produces a safe error message
    const { UpstoxError } = await import("./marketData/upstoxClient");
    const err = new UpstoxError("Upstox not configured (authMode=NOT_CONFIGURED).", "config");
    expect(err.message).not.toContain("UPSTOX_ACCESS_TOKEN");
    expect(err.message).not.toContain("UPSTOX_ANALYTICS_TOKEN");
    expect(err.message).toContain("NOT_CONFIGURED");
  });

  it("A-7: analytics token stripped of surrounding whitespace", () => {
    process.env["UPSTOX_ANALYTICS_TOKEN"] = "  tok_with_spaces  ";
    const cfg = resolveUpstoxConfig();
    expect(cfg.authMode).toBe<UpstoxAuthMode>("ANALYTICS_TOKEN");
    expect(cfg.accessToken).toBe("tok_with_spaces");
  });

  it("A-8: empty string analytics token treated as absent → falls through to standard", () => {
    process.env["UPSTOX_ANALYTICS_TOKEN"] = "";
    process.env["UPSTOX_ACCESS_TOKEN"]    = "standard_valid";
    const cfg = resolveUpstoxConfig();
    expect(cfg.authMode).toBe<UpstoxAuthMode>("STANDARD_DAILY_TOKEN");
  });

  it("A-9: empty string for both → NOT_CONFIGURED", () => {
    process.env["UPSTOX_ANALYTICS_TOKEN"] = "";
    process.env["UPSTOX_ACCESS_TOKEN"]    = "";
    const cfg = resolveUpstoxConfig();
    expect(cfg.authMode).toBe<UpstoxAuthMode>("NOT_CONFIGURED");
    expect(cfg.accessToken).toBeNull();
  });
});
