import { describe, expect, it } from "vitest";
import { computeLifecycleSummary } from "./paperEqLifecycleSummary";

describe("computeLifecycleSummary (Checkpoint 2 lifecycle diagnostic)", () => {
  it("reports zero anomalies for a fully-sourced, cleanly-resolved symbol", () => {
    const summary = computeLifecycleSummary({
      trades: [{ source: "AUTO_STRONG_BUY" }, { source: "MANUAL_BUY" }],
      auditRowCount: 4,
      stagingOrders: [
        { status: "APPROVED", approvalStatus: "APPROVED" },
        { status: "EXPIRED", approvalStatus: "REJECTED" },
      ],
      notificationCount: 2,
    });
    expect(summary).toEqual({
      tradeCount: 2,
      tradesMissingSource: 0,
      stagingOrderCount: 2,
      expiredWhilePendingCount: 0,
      notificationCount: 2,
    });
  });

  it("surfaces trades missing a source instead of hiding the gap", () => {
    const summary = computeLifecycleSummary({
      trades: [{ source: "AUTO_STRONG_BUY" }, { source: null }, { source: null }],
      auditRowCount: 0,
      stagingOrders: [],
      notificationCount: 0,
    });
    expect(summary.tradeCount).toBe(3);
    expect(summary.tradesMissingSource).toBe(2);
  });

  it("treats an empty-string source as missing (never fabricated as present)", () => {
    const summary = computeLifecycleSummary({
      trades: [{ source: "" }],
      auditRowCount: 0,
      stagingOrders: [],
      notificationCount: 0,
    });
    expect(summary.tradesMissingSource).toBe(1);
  });

  it("flags a staged order that EXPIRED while still PENDING approval as actionable", () => {
    const summary = computeLifecycleSummary({
      trades: [],
      auditRowCount: 0,
      stagingOrders: [{ status: "EXPIRED", approvalStatus: "PENDING" }],
      notificationCount: 0,
    });
    expect(summary.stagingOrderCount).toBe(1);
    expect(summary.expiredWhilePendingCount).toBe(1);
  });

  it("does NOT flag EXPIRED+REJECTED or EXPIRED+APPROVED as actionable — a human decision was made", () => {
    const summary = computeLifecycleSummary({
      trades: [],
      auditRowCount: 0,
      stagingOrders: [
        { status: "EXPIRED", approvalStatus: "REJECTED" },
        { status: "EXPIRED", approvalStatus: "APPROVED" },
        { status: "EXPIRED", approvalStatus: "WATCH_ONLY" },
      ],
      notificationCount: 0,
    });
    expect(summary.expiredWhilePendingCount).toBe(0);
  });

  it("does NOT flag a non-EXPIRED PENDING order (still actively staged, not yet actionable)", () => {
    const summary = computeLifecycleSummary({
      trades: [],
      auditRowCount: 0,
      stagingOrders: [{ status: "STAGED", approvalStatus: "PENDING" }],
      notificationCount: 0,
    });
    expect(summary.expiredWhilePendingCount).toBe(0);
  });

  it("handles the fully-empty symbol case (unknown symbol) without throwing", () => {
    const summary = computeLifecycleSummary({
      trades: [],
      auditRowCount: 0,
      stagingOrders: [],
      notificationCount: 0,
    });
    expect(summary).toEqual({
      tradeCount: 0,
      tradesMissingSource: 0,
      stagingOrderCount: 0,
      expiredWhilePendingCount: 0,
      notificationCount: 0,
    });
  });
});
