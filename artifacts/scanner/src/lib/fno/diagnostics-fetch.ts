/**
 * Read-only React Query hooks for the owner-only F&O Diagnostics cockpit.
 *
 * Plain `fetch` (the F&O diagnostics endpoints are not in the OpenAPI spec,
 * so there is no generated client) wrapped in React Query for caching and
 * refetch. Every endpoint is owner-gated server-side (`requireOwner`);
 * these hooks consume them read-only and trigger NO write/trading path.
 *
 * Types are intentionally loose — only the fields the cockpit renders are
 * declared; missing fields surface as honest "n/a" in the UI.
 */
import { useQuery } from "@tanstack/react-query";

const REFRESH_MS = 60_000;

async function fetchJson<T>(path: string): Promise<T> {
  const base = import.meta.env.BASE_URL;
  const url = `${base}${path.replace(/^\//, "")}`;
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as T;
}

// ── response shapes (loose — only rendered fields) ───────────────────────────

export interface BlockingReason {
  code: string;
  severity: "WARN" | "FAIL";
  detail: string;
}
export interface ExpectedMove {
  atmStraddlePremium: number | null;
  expectedMovePoints: number | null;
  expectedMovePercent: number | null;
  formulaLabel: string | null;
  source: string | null;
  freshnessSec: number | null;
  reason: string | null;
}
export interface PerIndexHealth {
  indexSymbol: string;
  display: string;
  spot:
    | { status: string; price: number; asOf: string; ageSec: number | null }
    | { status: string; reason: string };
  chain: Record<string, unknown> & { status: string };
  signalAllowed: boolean;
  blockingReasons: BlockingReason[];
  blockingSeverity: "OK" | "WARN" | "FAIL";
  dataSourceVerdict: string;
  spotProvider: string;
  optionChainProvider: string;
  freshEnoughForSignal: boolean;
  missingFields: string[];
  expectedMove: ExpectedMove;
}
/**
 * Backend `getEnvironmentLabel()` returns this structured object (not a string).
 * Rendered via `formatEnvLabel` — never as a raw React child. `unknown` is
 * tolerated defensively so a shape change can never crash the page again.
 */
export type EnvironmentLabel =
  | string
  | ({ env: "production" | "development"; autoTradingEnabled: boolean; reason: string } & Record<string, unknown>);

export interface DataHealthResponse {
  generatedAt: string;
  environment: EnvironmentLabel;
  universe: string[];
  kite: {
    session: { present: boolean } & Record<string, unknown>;
    feed?: Record<string, unknown>;
  } & Record<string, unknown>;
  perIndex: PerIndexHealth[];
  reasoningLogger: Record<string, unknown>;
  note: string;
}

export interface KeyCount {
  key: string;
  count: number;
}
export interface TodayResponse {
  generatedAt: string;
  signalDate: string;
  environment: EnvironmentLabel;
  decisions: KeyCount[];
  funnel: Array<{ stage: string; count: number }>;
  conversion: { openRate: number | null; decisiveWinRate: number | null } & Record<string, unknown>;
  demotionTags: KeyCount[];
  noTradeReasons: NoTradeReasons;
  openPositions: { count: number; indices: string[] };
  reasoningLogger: Record<string, unknown>;
}

export interface NoTradeReasons {
  durable: {
    source: string;
    rejectionReasonsBySetup: Array<{ setupKey: string; reasonCode: string; count: number }>;
    demotionTags: KeyCount[];
  } & Record<string, unknown>;
  ephemeral: {
    source?: string;
    total: number;
    byReason: KeyCount[];
    byIndex: KeyCount[];
  } & Record<string, unknown>;
}
export interface NoTradeResponse {
  filters: Record<string, unknown>;
  noTradeReasons: NoTradeReasons;
}

export interface GateWaterfallResponse {
  filters: Record<string, unknown>;
  waterfall: {
    funnel: Array<{ stage: string; count: number }>;
    conversion: { openRate: number | null; decisiveWinRate: number | null } & Record<string, unknown>;
    demotions?: KeyCount[];
    rejections?: Array<{ setupKey: string; reasonCode: string; count: number }>;
  } & Record<string, unknown>;
}

export interface SetupPerformanceRow {
  setupKey: string;
  opened: number;
  emitted: number;
  stopped: number;
  target1: number;
  target2: number;
  expired: number;
  demoted: number;
  decisiveWinRate: number | null;
  avgConfidence: number | null;
  avgConfluence: number | null;
}
export interface SetupPerformanceResponse {
  filters: Record<string, unknown>;
  setupPerformance: { rows: SetupPerformanceRow[] } & Record<string, unknown>;
}

export interface BlockedSignalEvent {
  capturedAt: string | null;
  signalDate: string;
  indexSymbol: string;
  setupKey: string | null;
  direction: string | null;
  optionType: string | null;
  tier: string | null;
  tradeClass: string | null;
  reasonCodes: string[];
  spot: number | null;
  confidence: number | null;
  note: string | null;
}
export interface BlockedSignalsReview {
  generatedAt: string;
  total: number;
  vetoTotals: { recoveryModeVeto: number; chaseRiskVeto: number; infoOnly: number };
  byReasonCode: KeyCount[];
  byIndex: KeyCount[];
  byDirection: KeyCount[];
  byTradeClass: KeyCount[];
  windowFrom: string | null;
  windowTo: string | null;
  cap: number;
  events: BlockedSignalEvent[];
}
export interface BlockedSignalsResponse {
  filters: Record<string, unknown>;
  blocked: BlockedSignalsReview;
}

// ── hooks ────────────────────────────────────────────────────────────────────

function commonOptions(auto: boolean) {
  return {
    staleTime: 30_000,
    refetchInterval: auto ? REFRESH_MS : (false as const),
    retry: 1,
  };
}

export function useFnoDataHealth(auto: boolean) {
  return useQuery({
    queryKey: ["fno-diagnostics", "data-health"],
    queryFn: () => fetchJson<DataHealthResponse>("/api/fno/data-health"),
    ...commonOptions(auto),
  });
}

export function useFnoToday(auto: boolean) {
  return useQuery({
    queryKey: ["fno-diagnostics", "today"],
    queryFn: () => fetchJson<TodayResponse>("/api/fno/diagnostics/today"),
    ...commonOptions(auto),
  });
}

export function useFnoGateWaterfall(auto: boolean) {
  return useQuery({
    queryKey: ["fno-diagnostics", "gate-waterfall"],
    queryFn: () => fetchJson<GateWaterfallResponse>("/api/fno/diagnostics/gate-waterfall"),
    ...commonOptions(auto),
  });
}

export function useFnoNoTradeReasons(auto: boolean) {
  return useQuery({
    queryKey: ["fno-diagnostics", "no-trade-reasons"],
    queryFn: () => fetchJson<NoTradeResponse>("/api/fno/diagnostics/no-trade-reasons"),
    ...commonOptions(auto),
  });
}

export function useFnoSetupPerformance(auto: boolean) {
  return useQuery({
    queryKey: ["fno-diagnostics", "setup-performance"],
    queryFn: () => fetchJson<SetupPerformanceResponse>("/api/fno/diagnostics/setup-performance"),
    ...commonOptions(auto),
  });
}

export function useFnoBlockedSignals(auto: boolean) {
  return useQuery({
    queryKey: ["fno-diagnostics", "blocked-signals"],
    queryFn: () => fetchJson<BlockedSignalsResponse>("/api/fno/diagnostics/blocked-signals"),
    ...commonOptions(auto),
  });
}
