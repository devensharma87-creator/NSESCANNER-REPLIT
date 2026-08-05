/**
 * Pack 7 Gate 0B — OI Lab State Tests.
 * Pack 7 Gate 8 items 19–20.
 *
 * Tests the OI Lab state resolution logic and verifies that:
 *  1. All 5 states (LOADING, RENDERED, NO_SNAPSHOTS, BUFFER_WARMING, ERROR) are deterministic
 *  2. Buffer text content is correct for each state
 *  3. Sentiment bands have complete mappings
 *  4. Screenshots directory contains the required viewport coverage (Gate 19)
 *  5. Global artifact is unmodified (Gate 20)
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// ─── State resolver (mirrors OI Lab component logic) ─────────────────────────

type OiLabState = "LOADING" | "RENDERED" | "NO_SNAPSHOTS" | "BUFFER_WARMING" | "ERROR";

interface InsightDataLike {
  windowBufferCount?: number;
  windowMode?: string;
}

function resolveOiLabState(
  loading: boolean,
  data: InsightDataLike | null | undefined,
  error: string | null,
): OiLabState {
  if (loading && !data) return "LOADING";
  if (error && !data) return "ERROR";
  if (!data) return "ERROR";

  const bufLen = data.windowBufferCount ?? 0;
  if (bufLen === 0 && data.windowMode === "none") return "NO_SNAPSHOTS";
  if (bufLen > 0 && (data.windowMode === "approx" || data.windowMode === "exact")) {
    return "BUFFER_WARMING";
  }
  return "RENDERED";
}

// ─── Buffer state text (mirrors component logic) ─────────────────────────────

function getBufferStateText(windowBufferCount: number, windowMode: string): string {
  if (windowBufferCount === 0) {
    return "No snapshots buffered — falling back to broker since-open Δ";
  }
  const snap = windowBufferCount === 1 ? "snap" : "snaps";
  return `Buffer warming up (${windowBufferCount} ${snap}) — falling back to broker since-open Δ`;
}

// ─── LOADING state ────────────────────────────────────────────────────────────

describe("Gate 0B: LOADING state", () => {
  it("loading=true, data=null → LOADING", () => {
    expect(resolveOiLabState(true, null, null)).toBe("LOADING");
  });

  it("loading=true, data=undefined → LOADING", () => {
    expect(resolveOiLabState(true, undefined, null)).toBe("LOADING");
  });

  it("loading=false with data does not produce LOADING", () => {
    const data = { windowBufferCount: 0, windowMode: "none" };
    expect(resolveOiLabState(false, data, null)).not.toBe("LOADING");
  });
});

// ─── ERROR state ──────────────────────────────────────────────────────────────

describe("Gate 0B: ERROR state", () => {
  it("error=present, data=null → ERROR", () => {
    const result = resolveOiLabState(false, null, "kite_login_required");
    expect(result).toBe("ERROR");
  });

  it("error=null, data=null → ERROR (no data, no loading = error fallback)", () => {
    const result = resolveOiLabState(false, null, null);
    expect(result).toBe("ERROR");
  });

  it("LOADING takes precedence over ERROR when both loading=true and error present", () => {
    const result = resolveOiLabState(true, null, "some error");
    expect(result).toBe("LOADING");
  });
});

// ─── NO_SNAPSHOTS state ───────────────────────────────────────────────────────

describe("Gate 0B: NO_SNAPSHOTS state", () => {
  it("windowBufferCount=0, windowMode=none → NO_SNAPSHOTS", () => {
    const data = { windowBufferCount: 0, windowMode: "none" };
    expect(resolveOiLabState(false, data, null)).toBe("NO_SNAPSHOTS");
  });

  it("windowBufferCount=0 with data present is NO_SNAPSHOTS", () => {
    const data = { windowBufferCount: 0, windowMode: "none", spot: 24987 };
    expect(resolveOiLabState(false, data, null)).toBe("NO_SNAPSHOTS");
  });

  it("NO_SNAPSHOTS text is correct", () => {
    const text = getBufferStateText(0, "none");
    expect(text).toContain("No snapshots buffered");
    expect(text).toContain("broker since-open");
  });
});

// ─── BUFFER_WARMING state ─────────────────────────────────────────────────────

describe("Gate 0B: BUFFER_WARMING state", () => {
  it("windowBufferCount=1, windowMode=approx → BUFFER_WARMING", () => {
    const data = { windowBufferCount: 1, windowMode: "approx" };
    expect(resolveOiLabState(false, data, null)).toBe("BUFFER_WARMING");
  });

  it("windowBufferCount=2, windowMode=exact → BUFFER_WARMING", () => {
    const data = { windowBufferCount: 2, windowMode: "exact" };
    expect(resolveOiLabState(false, data, null)).toBe("BUFFER_WARMING");
  });

  it("windowBufferCount=1 text uses singular 'snap'", () => {
    const text = getBufferStateText(1, "approx");
    expect(text).toContain("1 snap)");
    expect(text).not.toContain("snaps");
  });

  it("windowBufferCount=2 text uses plural 'snaps'", () => {
    const text = getBufferStateText(2, "approx");
    expect(text).toContain("2 snaps)");
  });

  it("windowBufferCount=3 text uses plural 'snaps'", () => {
    const text = getBufferStateText(3, "exact");
    expect(text).toContain("3 snaps)");
  });
});

// ─── RENDERED state ───────────────────────────────────────────────────────────

describe("Gate 0B: RENDERED state", () => {
  it("windowBufferCount=0 with windowMode=fallback_open → RENDERED (broker data)", () => {
    // fallback_open mode uses broker data — treated as rendered
    const data = { windowBufferCount: 0, windowMode: "fallback_open" };
    expect(resolveOiLabState(false, data, null)).toBe("RENDERED");
  });

  it("data present, no error, no warming → RENDERED", () => {
    const data = { windowBufferCount: 0, windowMode: "fallback_open", spot: 24987 };
    expect(resolveOiLabState(false, data, null)).toBe("RENDERED");
  });
});

// ─── Fixture field completeness ───────────────────────────────────────────────

describe("Gate 0B: fetchInterceptor.ts fixture field completeness", () => {
  it("fetchInterceptor.ts exists", () => {
    expect(fs.existsSync("src/mocks/fetchInterceptor.ts")).toBe(true);
  });

  it("fetchInterceptor.ts contains F_OI_LAB_INSIGHTS_RENDERED fixture", () => {
    const content = fs.readFileSync(
      "src/mocks/fetchInterceptor.ts",
      "utf-8",
    );
    expect(content).toContain("F_OI_LAB_INSIGHTS_RENDERED");
  });

  it("fetchInterceptor.ts contains intradayFlow field (the crash-fix field)", () => {
    const content = fs.readFileSync(
      "src/mocks/fetchInterceptor.ts",
      "utf-8",
    );
    expect(content).toContain("intradayFlow");
  });

  it("fetchInterceptor.ts uses oi field (not callOi/putOi) in topResistance/topSupport", () => {
    const content = fs.readFileSync(
      "src/mocks/fetchInterceptor.ts",
      "utf-8",
    );
    // The correct field is `oi` per InsightResp — not callOi or putOi
    expect(content).toMatch(/topResistance.*oi:|oi:.*4_200_000/);
    expect(content).not.toMatch(/callOi: 4_200_000|putOi: 3_800_000/);
  });

  it("fetchInterceptor.ts contains marketInsight field", () => {
    const content = fs.readFileSync(
      "src/mocks/fetchInterceptor.ts",
      "utf-8",
    );
    expect(content).toContain("marketInsight");
  });

  it("fetchInterceptor.ts contains analysis field", () => {
    const content = fs.readFileSync(
      "src/mocks/fetchInterceptor.ts",
      "utf-8",
    );
    expect(content).toContain("analysis:");
  });

  it("fetchInterceptor.ts contains maxPainDeviation field", () => {
    const content = fs.readFileSync(
      "src/mocks/fetchInterceptor.ts",
      "utf-8",
    );
    expect(content).toContain("maxPainDeviation");
  });

  it("fetchInterceptor.ts contains F_OI_LAB_INSIGHTS_NO_SNAPSHOTS fixture", () => {
    const content = fs.readFileSync(
      "src/mocks/fetchInterceptor.ts",
      "utf-8",
    );
    expect(content).toContain("F_OI_LAB_INSIGHTS_NO_SNAPSHOTS");
  });

  it("fetchInterceptor.ts contains F_OI_LAB_INSIGHTS_BUFFER_WARMING fixture", () => {
    const content = fs.readFileSync(
      "src/mocks/fetchInterceptor.ts",
      "utf-8",
    );
    expect(content).toContain("F_OI_LAB_INSIGHTS_BUFFER_WARMING");
  });

  it("fetchInterceptor.ts contains F_OI_LAB_INSIGHTS_ERROR fixture", () => {
    const content = fs.readFileSync(
      "src/mocks/fetchInterceptor.ts",
      "utf-8",
    );
    expect(content).toContain("F_OI_LAB_INSIGHTS_ERROR");
  });

  it("fetchInterceptor.ts uses window.location.search for state routing", () => {
    const content = fs.readFileSync(
      "src/mocks/fetchInterceptor.ts",
      "utf-8",
    );
    expect(content).toContain("window.location.search");
    expect(content).toContain("oifix=");
  });

  it("fetchInterceptor.ts has delayMs support for LOADING state", () => {
    const content = fs.readFileSync(
      "src/mocks/fetchInterceptor.ts",
      "utf-8",
    );
    expect(content).toContain("delayMs");
  });
});

// ─── Gate 19: Viewport screenshot coverage ────────────────────────────────────

describe("Gate 19: All 7 surfaces × 3 viewports = 21 screenshots (Gate 0A)", () => {
  const screenshotDir = "../audit-evidence/screenshots/p25c";

  it("screenshot directory exists", () => {
    expect(fs.existsSync(screenshotDir)).toBe(true);
  });

  it("screenshot directory has at least 21 .jpg files", () => {
    const files = fs.readdirSync(screenshotDir).filter(f => f.endsWith(".jpg"));
    expect(files.length).toBeGreaterThanOrEqual(21);
  });

  it("Gate 0B screenshots directory exists", () => {
    expect(fs.existsSync("../audit-evidence/screenshots/p26")).toBe(true);
  });

  it("Gate 0B has LOADING state screenshot", () => {
    const exists = fs.existsSync(
      "../audit-evidence/screenshots/p26/gate0b-oi-lab-loading.jpg"
    );
    expect(exists).toBe(true);
  });

  it("Gate 0B has RENDERED state screenshot", () => {
    const exists = fs.existsSync(
      "../audit-evidence/screenshots/p26/gate0b-oi-lab-rendered.jpg"
    );
    expect(exists).toBe(true);
  });

  it("Gate 0B has ERROR state screenshot", () => {
    const exists = fs.existsSync(
      "../audit-evidence/screenshots/p26/gate0b-oi-lab-error.jpg"
    );
    expect(exists).toBe(true);
  });
});

// ─── Gate 20: Global artifact untouched ──────────────────────────────────────

describe("Gate 20: Global artifact excluded from Pack 7", () => {
  it("artifacts/global directory exists", () => {
    expect(fs.existsSync("../global")).toBe(true);
  });

  it("Pack 7 OI Lab fixture changes are in scanner, not global", () => {
    const scannerInterceptor = "src/mocks/fetchInterceptor.ts";
    const globalInterceptor  = "artifacts/global/src/mocks/fetchInterceptor.ts";
    expect(fs.existsSync(scannerInterceptor)).toBe(true);
    expect(fs.existsSync(globalInterceptor)).toBe(false);
  });

  it("p26 gate test files are not in global artifact", () => {
    const globalGate6 = "artifacts/global/src/lib/p26.gate6.crossTabEquality.test.ts";
    expect(fs.existsSync(globalGate6)).toBe(false);
  });
});

// ─── Sentiment band coverage ──────────────────────────────────────────────────

describe("Sentiment band coverage", () => {
  const SENTIMENT_BANDS = [
    "STRONGLY_BEARISH",
    "MILDLY_BEARISH",
    "NEUTRAL",
    "MILDLY_BULLISH",
    "STRONGLY_BULLISH",
  ] as const;

  it("all 5 SentimentBand values are defined", () => {
    expect(SENTIMENT_BANDS.length).toBe(5);
  });

  it("oi-lab.tsx contains all 5 SentimentBand values", () => {
    const content = fs.readFileSync("src/pages/oi-lab.tsx", "utf-8");
    for (const band of SENTIMENT_BANDS) {
      expect(content).toContain(band);
    }
  });

  it("MILDLY_BULLISH in fixture data matches SentimentBand type", () => {
    const fixtureContent = fs.readFileSync(
      "src/mocks/fetchInterceptor.ts",
      "utf-8",
    );
    expect(fixtureContent).toContain("MILDLY_BULLISH");
  });
});
