/**
 * Post-market "Chip downgrades today" line rendering test.
 *
 * Guards the small addition that surfaces the client-event ring buffer
 * volume in the daily post-market Telegram digest. The line must be
 * silent on healthy days (zero counts) — no phantom "0 things" noise —
 * and, when active, must name the loudest chip.
 */
import { describe, it, expect } from "vitest";
import {
  buildPostMarketReport,
  type PostMarketReportData,
} from "./dailyReports";

const HEALTHY_CANONICAL_FNO_STUB = null;

function makeData(overrides: Partial<PostMarketReportData> = {}): PostMarketReportData {
  return {
    isManualTest: false,
    istDate: "2026-07-15",
    isWeekend: false,
    canonicalFno: HEALTHY_CANONICAL_FNO_STUB,
    fno: null,
    swing: null,
    equityPaper: null,
    indexPerformance: null,
    optionChainEod: null,
    exitMonitorVerified: false,
    observabilityToday: null,
    ...overrides,
  };
}

describe("Post-market: chip downgrades today line", () => {
  it("silent when observabilityToday is null (query failed) — no phantom line", () => {
    const text = buildPostMarketReport(makeData({ observabilityToday: null }));
    expect(text).not.toContain("Chip downgrades today");
  });

  it("silent when both counts are zero — healthy day", () => {
    const text = buildPostMarketReport(
      makeData({
        observabilityToday: {
          totalDegradations: 0,
          totalRecoveries: 0,
          topChip: null,
        },
      }),
    );
    expect(text).not.toContain("Chip downgrades today");
  });

  it("renders full line with top chip on a noisy day", () => {
    const text = buildPostMarketReport(
      makeData({
        observabilityToday: {
          totalDegradations: 7,
          totalRecoveries: 4,
          topChip: { chipId: "scanner-boot", degradations: 5 },
        },
      }),
    );
    expect(text).toContain(
      "Chip downgrades today: 7 degradations · 4 recoveries (top: scanner-boot ×5)",
    );
  });

  it("handles singular grammar correctly (1 degradation · 1 recovery)", () => {
    const text = buildPostMarketReport(
      makeData({
        observabilityToday: {
          totalDegradations: 1,
          totalRecoveries: 1,
          topChip: { chipId: "option-chain-analytics", degradations: 1 },
        },
      }),
    );
    expect(text).toContain(
      "Chip downgrades today: 1 degradation · 1 recovery (top: option-chain-analytics ×1)",
    );
  });

  it("omits topChip suffix when no chip degraded (recoveries only)", () => {
    const text = buildPostMarketReport(
      makeData({
        observabilityToday: {
          totalDegradations: 0,
          totalRecoveries: 3,
          topChip: null,
        },
      }),
    );
    expect(text).toContain("Chip downgrades today: 0 degradations · 3 recoveries");
    expect(text).not.toContain("(top:");
  });
});
