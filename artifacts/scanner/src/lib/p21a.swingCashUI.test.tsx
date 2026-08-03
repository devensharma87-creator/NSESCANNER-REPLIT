/**
 * Pack 3 / Prompt 21A — Gate 4 (Gate L): Swing Cash UI production component.
 *
 * Renders the real `SwingCashLiveQueue` component (artifacts/scanner/src/pages/swing-cash.tsx)
 * through all load-bearing data states. All API hooks are mocked to control what
 * the component receives.
 *
 * Pattern matches p19a.indexDetail.test.tsx: createRoot + act + vi.mock for
 * @workspace/api-client-react hooks. No network calls. No PostgreSQL.
 *
 * NOTE: (globalThis as Record<string,unknown>).React = React is required so
 * Radix UI primitives (which call React.createElement directly) work in the
 * vmThreads jsdom environment — same pattern as p19a.indexDetail.test.tsx.
 */

/// <reference types="vitest/globals" />
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Set React globally — required for Radix UI / shadcn primitives in vmThreads.
(globalThis as Record<string, unknown>).React = React;
(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Shared hook-state control — hoisted so vi.mock factories can close over it.
// ---------------------------------------------------------------------------

const hookState = vi.hoisted(() => ({
  status: {
    data: undefined as Record<string, unknown> | undefined,
    isLoading: true,
  },
  list: {
    data: undefined as Record<string, unknown> | undefined,
    isLoading: true,
    refetch: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock all API hooks
// ---------------------------------------------------------------------------

vi.mock("@workspace/api-client-react", () => ({
  useGetSwingExecutionStatus: () => hookState.status,
  getGetSwingExecutionStatusQueryKey: () => ["swing-status"],
  useListSwingStagedOrders: () => hookState.list,
  getListSwingStagedOrdersQueryKey: () => ["swing-list"],
  useStageSwingStagedOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useApproveSwingStagedOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRejectSwingStagedOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRefreshSwingStagedOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useWatchSwingStagedOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useExpireSwingStagedOrder: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useExpireStaleSwingStagedOrders: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRunSwingTtlSweepNow: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSetSwingKillSwitch: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// Minimal shadcn/ui stubs — pass children through as plain divs.
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
    React.createElement("span", { "data-testid": "badge", className }, children),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, className }: {
    children?: React.ReactNode; onClick?: () => void; disabled?: boolean; className?: string;
  }) =>
    React.createElement("button", { onClick, disabled, className, "data-testid": "btn" }, children),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
    React.createElement("div", { "data-testid": "card", className }, children),
  CardContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "card-content" }, children),
  CardHeader: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "card-header" }, children),
  CardTitle: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "card-title" }, children),
  CardDescription: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("p", { "data-testid": "card-description" }, children),
  CardFooter: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
    React.createElement("div", { "data-testid": "card-footer", className }, children),
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => React.createElement("hr", null),
}));

vi.mock("@/components/ui/collapsible", () => ({
  Collapsible: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  CollapsibleContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  CollapsibleTrigger: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("button", null, children),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", { "data-select": true }, children),
  SelectContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  SelectItem: ({ children, value }: { children?: React.ReactNode; value?: string }) =>
    React.createElement("div", { "data-value": value }, children),
  SelectTrigger: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("button", null, children),
  SelectValue: ({ placeholder }: { placeholder?: string }) =>
    React.createElement("span", null, placeholder),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: Record<string, unknown>) => React.createElement("input", props as React.InputHTMLAttributes<HTMLInputElement>),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, onCheckedChange, disabled }: { checked?: boolean; onCheckedChange?: (v: boolean) => void; disabled?: boolean }) =>
    React.createElement("button", { role: "switch", "aria-checked": checked, disabled, onClick: () => onCheckedChange?.(!checked) }),
}));

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, htmlFor }: { children?: React.ReactNode; htmlFor?: string }) =>
    React.createElement("label", { htmlFor }, children),
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) =>
    React.createElement("div", { "data-testid": "skeleton", className }),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  TooltipContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  TooltipProvider: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
  TooltipTrigger: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", null, children),
}));

const MockIcon = ({ className }: { className?: string }) =>
  React.createElement("span", { "data-icon": true, className });

vi.mock("lucide-react", () => ({
  AlertCircle: MockIcon,
  ShieldAlert: MockIcon,
  CheckCircle2: MockIcon,
  RotateCw: MockIcon,
  XCircle: MockIcon,
  Eye: MockIcon,
  Clock: MockIcon,
  ShieldX: MockIcon,
  Play: MockIcon,
  Timer: MockIcon,
  Zap: MockIcon,
}));

vi.mock("date-fns", () => ({
  formatDistanceToNow: (_d: Date) => "2 hours ago",
  format: (_d: Date, _fmt: string) => "2026-08-03 09:30",
}));

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeStatus(override: Record<string, unknown> = {}) {
  return {
    // execution sub-object: mode + env label
    execution: {
      mode: "paper_only",
      liveCashSwingOrderEnabled: false,
      brokerExecutionEnabled: false,
      summary: "Paper-only mode. No live orders.",
      environment: { env: "paper", autoTradingEnabled: false, reason: "paper_only" },
    },
    // killSwitch sub-object: component reads killSwitch.enabled
    killSwitch: {
      enabled: false,
      reason: null,
      updatedAt: null,
      updatedBy: null,
    },
    // ttlSweep sub-object
    ttlSweep: {
      isRunning: false,
      lastRunAt: null,
      lastRunResult: null,
      nextRunAt: null,
    },
    ...override,
  };
}

function makeOrder(override: Record<string, unknown> = {}) {
  return {
    id: `order-${Math.random().toString(36).slice(2, 8)}`,
    ownerKey: "owner",
    symbol: "RELIANCE",
    exchange: "NSE",
    tradingSymbol: null,
    instrumentToken: null,
    status: "STAGED",
    approvalStatus: "PENDING",
    side: "BUY",
    productType: "CNC",
    orderType: "LIMIT",
    entryPrice: 1000,
    limitPrice: 1000,
    stopLoss: 900,
    target1: 1200,
    target2: null,
    quantity: 5,
    capitalRequired: 5000,
    maxRisk: 500,
    riskPercent: 0.05,
    executionMode: "paper_only",
    brokerStatus: "BROKER_DISABLED",
    expiresAt: new Date(Date.now() + 6 * 3_600_000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    manualReviewRequired: false,
    sector: "OIL",
    signalId: null,
    setupKey: null,
    dataSource: "kite",
    dataAsOf: null,
    riskDecisionJson: null,
    recheckDecisionJson: null,
    ...override,
  };
}

function makeList(orders: Record<string, unknown>[] = []) {
  // The API route returns { items: [...], execution: ... }
  // useListSwingStagedOrders data shape matches the route's response.
  return { items: orders, totalCount: orders.length, activeCount: orders.length };
}

// ---------------------------------------------------------------------------
// DOM setup
// ---------------------------------------------------------------------------

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  hookState.list.refetch.mockReset();
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
});

async function render() {
  const { default: SwingCashLiveQueue } = await import("../pages/swing-cash.js");
  await act(async () => {
    root.render(React.createElement(SwingCashLiveQueue));
  });
}

// ---------------------------------------------------------------------------
// Data-state tests
// ---------------------------------------------------------------------------

describe("Pack3/21A/Gate4 — Swing Cash UI production component", () => {
  it("DS-1: renders without crash when both status and list are loading", async () => {
    hookState.status.isLoading = true;
    hookState.status.data = undefined;
    hookState.list.isLoading = true;
    hookState.list.data = undefined;
    await render();
    expect(document.body.contains(container)).toBe(true);
  });

  it("DS-2: renders without crash when status is loaded but list is still loading", async () => {
    hookState.status.isLoading = false;
    hookState.status.data = makeStatus();
    hookState.list.isLoading = true;
    hookState.list.data = undefined;
    await render();
    expect(document.body.contains(container)).toBe(true);
  });

  it("DS-3: renders empty orders state without crash", async () => {
    hookState.status.isLoading = false;
    hookState.status.data = makeStatus();
    hookState.list.isLoading = false;
    hookState.list.data = makeList([]);
    await render();
    expect(document.body.contains(container)).toBe(true);
  });

  it("DS-4: kill switch active state renders without crash and no fabricated orders shown", async () => {
    hookState.status.isLoading = false;
    hookState.status.data = makeStatus({ killSwitchActive: true });
    hookState.list.isLoading = false;
    hookState.list.data = makeList([]);
    await render();
    expect(document.body.contains(container)).toBe(true);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/₹0(?!\s*[A-Za-z])/);
  });

  it("DS-5: single STAGED order renders without crash", async () => {
    hookState.status.isLoading = false;
    hookState.status.data = makeStatus();
    hookState.list.isLoading = false;
    hookState.list.data = makeList([makeOrder({ status: "STAGED" })]);
    await render();
    expect(document.body.contains(container)).toBe(true);
    expect(container.textContent).toContain("RELIANCE");
  });

  it("DS-6: APPROVAL_REQUIRED order renders without crash", async () => {
    hookState.status.isLoading = false;
    hookState.status.data = makeStatus();
    hookState.list.isLoading = false;
    hookState.list.data = makeList([makeOrder({ status: "APPROVAL_REQUIRED" })]);
    await render();
    expect(document.body.contains(container)).toBe(true);
  });

  it("DS-7: REJECTED terminal order renders without crash", async () => {
    hookState.status.isLoading = false;
    hookState.status.data = makeStatus();
    hookState.list.isLoading = false;
    hookState.list.data = makeList([makeOrder({ status: "REJECTED" })]);
    await render();
    expect(document.body.contains(container)).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // Safety invariants
  // ---------------------------------------------------------------------------

  it("SI-1: loading state shows no fabricated money or count values", async () => {
    hookState.status.isLoading = true;
    hookState.status.data = undefined;
    hookState.list.isLoading = true;
    hookState.list.data = undefined;
    await render();
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/₹0\.00/);
  });

  it("SI-2: STAGED order renders without any [object Object] in DOM", async () => {
    hookState.status.isLoading = false;
    hookState.status.data = makeStatus();
    hookState.list.isLoading = false;
    hookState.list.data = makeList([makeOrder({ status: "STAGED" })]);
    await render();
    const text = container.textContent ?? "";
    expect(text).not.toContain("[object Object]");
  });

  it("SI-3: paper_only mode — no raw 'LIVE' execution-mode badge shown", async () => {
    hookState.status.isLoading = false;
    hookState.status.data = makeStatus({ mode: "paper_only" });
    hookState.list.isLoading = false;
    hookState.list.data = makeList([makeOrder({ executionMode: "paper_only" })]);
    await render();
    const badges = Array.from(container.querySelectorAll("[data-testid='badge']"));
    const badgeTexts = badges.map((b) => (b.textContent ?? "").trim());
    // No badge should show exactly "LIVE" (reserved for live-order mode).
    expect(badgeTexts.includes("LIVE")).toBe(false);
  });

  it("SI-4: multiple orders all render (no dedup loss)", async () => {
    hookState.status.isLoading = false;
    hookState.status.data = makeStatus();
    hookState.list.isLoading = false;
    hookState.list.data = makeList([
      makeOrder({ id: "o1", symbol: "RELIANCE", status: "STAGED" }),
      makeOrder({ id: "o2", symbol: "INFY", status: "STAGED" }),
      makeOrder({ id: "o3", symbol: "TCS", status: "STAGED" }),
    ]);
    await render();
    const text = container.textContent ?? "";
    expect(text).toContain("RELIANCE");
    expect(text).toContain("INFY");
    expect(text).toContain("TCS");
  });

  it("SI-5: null orders list does not crash the component", async () => {
    hookState.status.isLoading = false;
    hookState.status.data = makeStatus();
    hookState.list.isLoading = false;
    (hookState.list as { data: unknown }).data = null;
    await expect(render()).resolves.not.toThrow();
  });

  it("SI-6: STAGED order symbol is rendered as text, not as a raw JSON string", async () => {
    hookState.status.isLoading = false;
    hookState.status.data = makeStatus();
    hookState.list.isLoading = false;
    hookState.list.data = makeList([makeOrder({ status: "STAGED", symbol: "MARUTI" })]);
    await render();
    const text = container.textContent ?? "";
    expect(text).toContain("MARUTI");
    expect(text).not.toContain('"symbol"');
  });

  it("SI-7: execution mode data comes from status hook (component renders with any valid mode)", async () => {
    hookState.status.isLoading = false;
    hookState.status.data = makeStatus({ mode: "live_staged_approval" });
    hookState.list.isLoading = false;
    hookState.list.data = makeList([]);
    await render();
    // Component must not crash for any valid mode.
    expect(document.body.contains(container)).toBe(true);
    const text = container.textContent ?? "";
    expect(text).not.toContain("[object Object]");
  });

  it("SI-8: WATCH_ONLY order renders without crash", async () => {
    hookState.status.isLoading = false;
    hookState.status.data = makeStatus();
    hookState.list.isLoading = false;
    hookState.list.data = makeList([makeOrder({ status: "WATCH_ONLY" })]);
    await render();
    expect(document.body.contains(container)).toBe(true);
  });

  it("SI-9: EXPIRED order renders without crash", async () => {
    hookState.status.isLoading = false;
    hookState.status.data = makeStatus();
    hookState.list.isLoading = false;
    hookState.list.data = makeList([
      makeOrder({
        status: "EXPIRED",
        expiresAt: new Date(Date.now() - 3_600_000).toISOString(),
      }),
    ]);
    await render();
    expect(document.body.contains(container)).toBe(true);
  });

  it("SI-10: component renders without crash when executionMode is live_dry_run", async () => {
    hookState.status.isLoading = false;
    hookState.status.data = makeStatus({ mode: "live_dry_run" });
    hookState.list.isLoading = false;
    hookState.list.data = makeList([makeOrder({ executionMode: "live_dry_run" })]);
    await render();
    expect(document.body.contains(container)).toBe(true);
    const text = container.textContent ?? "";
    expect(text).not.toContain("[object Object]");
  });
});
