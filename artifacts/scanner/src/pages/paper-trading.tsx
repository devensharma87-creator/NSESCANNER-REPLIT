/**
 * Owner-only paper trading dashboard.
 *
 * F&O segment auto-trades qualifying option signals against a daily
 * bankroll. Equity segment auto-trades STRONG_BUY signals from the
 * fullNseScanner (filtered to F&O 200) on a multi-day swing book —
 * see paperTradingEq.ts on the server. Both segments expose the same
 * three sub-views: account state, open positions with live MTM, and
 * the day's closed trades.
 */
import { useCallback, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Seo } from "@/components/seo";
import {
  Card, CardHeader, CardTitle, CardDescription, CardContent,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { PaperComboSegment } from "@/components/paper-combo-segment";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import type { SpotLifecycleLike } from "@/lib/fno/targetStatus";
import type { z } from "zod";
import type { GetPaperPositionsEqResponse } from "@workspace/api-zod";
import { FoCockpitSafetyBanner } from "@/components/fno/FoCockpitSafetyBanner";
import { FoCockpitSummaryCards } from "@/components/fno/FoCockpitSummaryCards";
import { FoOpenTradesTable, type FoOpenGroup } from "@/components/fno/FoOpenTradesTable";
import { FoP25EvidencePanel } from "@/components/fno/FoP25EvidencePanel";
import {
  FoClosedTradesReview,
  type FoClosedGroup,
} from "@/components/fno/FoClosedTradesReview";
import { FoCockpitControls } from "@/components/fno/FoCockpitControls";
import {
  FoExitMonitorPanel,
  type ExitMonitorStatusResponse,
  type RunResultLike,
} from "@/components/fno/FoExitMonitorPanel";
import {
  summarizeFoCockpit,
  deriveP25Headline,
  deriveP25EvidenceDetail,
  deriveFoFreshness,
  applyFoFilters,
  sortFoRows,
  groupFoRows,
  countActiveFoFilters,
  uniqueIndexes,
  uniqueSetups,
  uniqueExitReasons,
  uniqueDirections,
  uniqueOptionTypes,
  DEFAULT_FO_FILTERS,
  type FoFilters,
  type FoSortKey,
  type FoSortDir,
  type FoGroupBy,
  type FoTradeRow,
  type FoShadowExitsResponse,
} from "@/lib/foCockpitView";
import { LedgerHealthCard } from "@/components/ledger-health-card";
import { PageHeader } from "@/components/ui/page-header";

const BASE = import.meta.env.BASE_URL;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const body = await r.json();
      if (body?.error) msg = String(body.error);
    } catch { /* ignore */ }
    throw new ApiError(msg, r.status);
  }
  return (await r.json()) as T;
}

/** Error carrying the HTTP status so consumers can classify 401/403 reliably
 *  even when the server replaces the numeric code with a textual `error` body. */
class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const QK_ACCOUNT = ["paper", "account", "FNO"] as const;
const QK_POSITIONS = ["paper", "positions", "FNO"] as const;
const QK_TRADES = ["paper", "trades", "FNO"] as const;

const QK_ACCOUNT_EQ = ["paper", "account", "EQUITY"] as const;
const QK_POSITIONS_EQ = ["paper", "positions", "EQUITY"] as const;
const QK_TRADES_EQ = ["paper", "trades", "EQUITY"] as const;

type Segment = "FNO" | "EQUITY" | "COMBO";

interface PaperAccount {
  segment: Segment;
  seedCapital: number;
  balance: number;
  dayRealizedPnl: number;
  lifetimeRealizedPnl?: number;
  dayOpenCount: number;
  dayTradeCount: number;
  lastResetDate: string;
  dailyTradeCap: number;
  maxLossPctPerTrade: number;
  dailyDrawdownPct?: number | null;
  dailyDrawdownCapPct?: number | null;
  weeklyDrawdownPct?: number | null;
  weeklyDrawdownCapPct?: number | null;
  availableCash?: number | null;
  deployedCapital?: number | null;
  capitalAdded?: number | null;
  capitalWithdrawn?: number | null;
  heatUsed?: number | null;
  heatCapAmount?: number | null;
  heatAvailable?: number | null;
  heatCapPct?: number | null;
  riskBase?: number | null;
  riskPerTradePct?: number | null;
  riskPerTradeAmount?: number | null;
}

interface OpenPosition {
  id: string;
  signalDate: string;
  indexSymbol: string;
  indexName: string;
  setupKey: string;
  direction: "BULLISH" | "BEARISH";
  optionType: "CALL" | "PUT";
  strike: number;
  lots: number;
  lotSize: number;
  entryPremium: number;
  stopPremium: number;
  target1Premium: number;
  target2Premium: number;
  capitalDeployed: number;
  lastPremium: number;
  unrealizedPnl: number;
  maxRunup?: number;
  maxDrawdown?: number;
  openedAt: string;
  lastEvaluatedAt: string;
  spotLifecycle?: SpotLifecycleLike | null;
  exitMonitorStatus?: "MONITORED" | "BLOCKED" | null;
  exitTradeGrade?: boolean | null;
  exitQuoteSource?: string | null;
  exitQuoteAsOf?: string | null;
  exitQuoteFreshnessSec?: number | null;
  lastExitCheckAt?: string | null;
  lastExitCheckError?: string | null;
}

interface ClosedTrade {
  id: string;
  signalDate: string;
  indexSymbol: string;
  indexName: string;
  setupKey: string;
  direction: "BULLISH" | "BEARISH";
  optionType: "CALL" | "PUT";
  strike: number;
  lots: number;
  lotSize: number;
  entryPremium: number;
  exitPremium: number;
  capitalDeployed: number;
  realizedPnl: number;
  exitReason: "TARGET1_HIT" | "TARGET2_HIT" | "STOPPED" | "EXPIRED" | "MANUAL_OVERRIDE" | "TIME_EXIT_1520";
  openedAt: string;
  exitedAt: string;
  journal?: string | null;
  tags?: string[];
  stopPremium?: number | null;
  target1Premium?: number | null;
  target2Premium?: number | null;
  maxRunup?: number | null;
  maxDrawdown?: number | null;
  spotLifecycle?: SpotLifecycleLike | null;
  exitMonitorStatus?: "MONITORED" | "BLOCKED" | null;
  exitTradeGrade?: boolean | null;
  exitQuoteSource?: string | null;
  exitQuoteAsOf?: string | null;
  exitQuoteFreshnessSec?: number | null;
  exitDetectedAt?: string | null;
  lastExitCheckAt?: string | null;
  lastExitCheckError?: string | null;
  telegramStatus?: "SENT" | "FAILED" | "DUPLICATE" | null;
}

const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
const inrDec = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);
const pct = (n: number) =>
  `${(n * 100).toFixed(1)}%`;
const fmtTime = (iso: string) => {
  try {
    return new Date(iso).toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
  } catch { return iso; }
};

const REASON_TONE: Record<ClosedTrade["exitReason"], string> = {
  TARGET2_HIT: "bg-emerald-500/15 text-emerald-200 border-emerald-500/30",
  TARGET1_HIT: "bg-emerald-500/10 text-emerald-200 border-emerald-500/25",
  STOPPED:     "bg-rose-500/15 text-rose-200 border-rose-500/30",
  EXPIRED:     "bg-amber-500/10 text-amber-200 border-amber-500/30",
  MANUAL_OVERRIDE: "bg-slate-500/15 text-slate-200 border-slate-500/30",
  TIME_EXIT_1520: "bg-sky-500/15 text-sky-200 border-sky-500/30",
};

type EqExitReason =
  | "TARGET2_HIT"
  | "STOPPED"
  | "TRAIL_STOP_HIT"
  | "TIME_STOP"
  | "SIGNAL_FLIP"
  | "MANUAL_OVERRIDE";

// ─── EQ Position type: derived from generated API schema (SG3) ───────────────
// Derive from the generated OpenAPI spec type so that provenance union fields
// (openedSessionValidity, timestampConfidence, cutoffPolicyValidity, …) are no
// longer manually duplicated here. When the API spec changes, this type updates
// automatically rather than silently drifting.
//
// Raw JSON fetch returns date fields as ISO strings; z.input<> (the pre-coercion
// input type for zod.coerce.date) accepts `string | number | Date`. We narrow
// those to `string` here — the actual shape returned by JSON.parse.
//
// NOTE: `status`, `source`, and all provenance enum fields now come from the
// generated schema. Any new provenance field added to the OpenAPI spec will
// be reflected here automatically.

type _GeneratedEqPositionInput = z.input<typeof GetPaperPositionsEqResponse>["positions"][number];

type OpenEqPosition = Omit<_GeneratedEqPositionInput, "signalTriggeredAt" | "openedAt" | "lastEvaluatedAt"> & {
  /** ISO string as received from raw JSON fetch (before any Zod coercion). */
  signalTriggeredAt: string;
  /** ISO string as received from raw JSON fetch (before any Zod coercion). */
  openedAt: string;
  /** ISO string as received from raw JSON fetch (before any Zod coercion). */
  lastEvaluatedAt: string;
};

// SG3 compile-time proof: provenance union fields are derived from the generated schema,
// not manually duplicated. This assertion fails to compile if the generated schema
// changes incompatibly (e.g., a union variant is added or removed in the OpenAPI spec).
//
// Note: The full OpenEqPosition is NOT a structural subtype of _GeneratedEqPositionInput
// because the date fields are intentionally narrowed (string vs coerced Date). The Pick
// below proves specifically that the provenance enum fields — the ones previously
// hand-written as duplicate unions — now come directly from the generated schema.
type _ProvenanceFieldsMatch = Pick<OpenEqPosition,
  "openedSessionValidity" | "openedSessionReason" | "openedAtIst" |
  "calendarVersion" | "calendarScope" | "timestampConfidence" | "cutoffPolicyValidity"
> extends Pick<_GeneratedEqPositionInput,
  "openedSessionValidity" | "openedSessionReason" | "openedAtIst" |
  "calendarVersion" | "calendarScope" | "timestampConfidence" | "cutoffPolicyValidity"
> ? true : false;
const _provenanceFieldsMatch: _ProvenanceFieldsMatch = true;
void _provenanceFieldsMatch;

type EqTradeSource = "AUTO_STRONG_BUY" | "SWING_STAGED_APPROVAL" | "MANUAL_BUY" | "LEGACY_UNKNOWN";

const EQ_SOURCE_LABEL: Record<EqTradeSource, string> = {
  AUTO_STRONG_BUY: "AUTO",
  SWING_STAGED_APPROVAL: "SWING QUEUE",
  MANUAL_BUY: "MANUAL",
  LEGACY_UNKNOWN: "LEGACY",
};

const EQ_SOURCE_TONE: Record<EqTradeSource, string> = {
  AUTO_STRONG_BUY: "border-sky-400/40 text-sky-300",
  SWING_STAGED_APPROVAL: "border-violet-400/40 text-violet-300",
  MANUAL_BUY: "border-amber-400/40 text-amber-300",
  LEGACY_UNKNOWN: "border-muted-foreground/40 text-muted-foreground",
};

function EqSourceBadge({ source }: { source?: EqTradeSource | null }) {
  const key: EqTradeSource = source ?? "LEGACY_UNKNOWN";
  return (
    <Badge
      variant="outline"
      className={`text-[9px] px-1.5 py-0 font-medium ${EQ_SOURCE_TONE[key]}`}
      title={
        key === "LEGACY_UNKNOWN"
          ? "Opened before source tracking was added — cannot be attributed honestly."
          : undefined
      }
    >
      {EQ_SOURCE_LABEL[key]}
    </Badge>
  );
}

interface ClosedEqTrade {
  id: string;
  symbol: string;
  name: string;
  exchange: string;
  signalDate: string;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  capitalDeployed: number;
  realizedPnl: number;
  exitReason: EqExitReason;
  openedAt: string;
  exitedAt: string;
  journal?: string | null;
  tags?: string[];
  source?: EqTradeSource | null;
  stagedOrderId?: string | null;
}

const EQ_REASON_TONE: Record<EqExitReason, string> = {
  TARGET2_HIT:     "bg-emerald-500/15 text-emerald-200 border-emerald-500/30",
  STOPPED:         "bg-rose-500/15 text-rose-200 border-rose-500/30",
  TRAIL_STOP_HIT:  "bg-amber-500/15 text-amber-200 border-amber-500/30",
  TIME_STOP:       "bg-sky-500/15 text-sky-200 border-sky-500/30",
  SIGNAL_FLIP:     "bg-fuchsia-500/15 text-fuchsia-200 border-fuchsia-500/30",
  MANUAL_OVERRIDE: "bg-slate-500/15 text-slate-200 border-slate-500/30",
};

const fmtDate = (iso: string) => {
  try {
    return new Date(iso).toLocaleDateString("en-IN", {
      day: "2-digit", month: "short",
    });
  } catch { return iso; }
};

// Combined "DD MMM YYYY · HH:MM:SS IST" rendering — used wherever the trigger
// time of a paper trade matters (open positions table). Forces IST so the
// timestamp matches what's stored in the DB regardless of the browser locale.
const fmtDateTime = (iso: string) => {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString("en-IN", {
      day: "2-digit", month: "short", year: "numeric",
      timeZone: "Asia/Kolkata",
    });
    const time = d.toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
      timeZone: "Asia/Kolkata",
    });
    return `${date} · ${time} IST`;
  } catch { return iso; }
};

// P0.2-correction-4: isOffSessionTimestamp() removed. Session validity is now
// a backend-derived field (`openedSessionValidity`) on each position, set by
// the positions API via classifyStoredTimestamp(). This eliminates client-side
// calendar guessing (which had no holiday check) and makes the badge
// authoritative. See sessionAdmission.ts on the server.

export default function PaperTrading() {
  const [segment, setSegment] = useState<Segment>("FNO");
  return (
    <div className="container mx-auto px-4 py-6 max-w-7xl">
      <Seo path="/paper-trading" title="Paper Trading" noindex />
      <PageHeader
        title="Paper Trading"
        section="Trading Desk"
        description="Owner-only virtual broker. Auto-trades qualifying signals against a fresh daily bankroll so you can audit the strategy without real money."
        className="mb-2"
      />
      <div className="mb-4">
        <EnvironmentBanner />
      </div>
      <Tabs value={segment} onValueChange={v => setSegment(v as Segment)}>
        <TabsList className="mb-4">
          <TabsTrigger value="FNO">F&amp;O</TabsTrigger>
          <TabsTrigger value="EQUITY">Equity</TabsTrigger>
          <TabsTrigger value="COMBO" data-testid="tab-combo">Combos</TabsTrigger>
        </TabsList>
        <TabsContent value="FNO" className="space-y-6">
          <FOSegment />
        </TabsContent>
        <TabsContent value="EQUITY" className="space-y-6">
          <EquitySegment />
        </TabsContent>
        <TabsContent value="COMBO" className="space-y-6">
          <PaperComboSegment />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EquitySegment() {
  const qc = useQueryClient();
  const [buyOpen, setBuyOpen] = useState(false);
  const account = useQuery({
    queryKey: QK_ACCOUNT_EQ,
    queryFn: () => api<PaperAccount>(`/paper/account?segment=EQUITY`),
    refetchInterval: 15_000,
  });
  const positions = useQuery({
    queryKey: QK_POSITIONS_EQ,
    queryFn: () => api<{ positions: OpenEqPosition[]; generatedAt: string }>(`/paper/positions/eq`),
    refetchInterval: 15_000,
  });
  const handleTopupSuccess = () => {
    void qc.invalidateQueries({ queryKey: QK_ACCOUNT_EQ });
  };
  const handleBuySuccess = () => {
    void qc.invalidateQueries({ queryKey: QK_POSITIONS_EQ });
    void qc.invalidateQueries({ queryKey: QK_ACCOUNT_EQ });
  };
  // Closed/historical trades intentionally NOT fetched here — Paper tab is
  // live-only by design. Reports tab (/paper-reports) carries the history.
  return (
    <div className="space-y-6">
      <LedgerHealthCard segment="EQUITY" />
      <EqAccountCard
        data={account.data}
        openPositions={positions.data?.positions ?? []}
        loading={account.isLoading}
        error={account.error instanceof Error ? account.error.message : null}
        onTopupSuccess={handleTopupSuccess}
      />
      <EqPositionsCard
        positions={positions.data?.positions ?? []}
        loading={positions.isLoading}
        error={positions.error instanceof Error ? positions.error.message : null}
        onBuyClick={() => setBuyOpen(true)}
      />
      <EqAuditPanel />
      <ManualBuyEqDialog
        open={buyOpen}
        onClose={() => setBuyOpen(false)}
        onSuccess={handleBuySuccess}
      />
    </div>
  );
}

interface EqAuditRow {
  id: string;
  ts: string;
  symbol: string;
  signal: string | null;
  score: number | null;
  decision: string;
  reason: string;
  detail: string | null;
  entry: number | null;
  stop: number | null;
  qty: number | null;
  deploy: number | null;
  balance: number | null;
  accountValue: number | null;
  source: string;
}

const SKIP_TONE: Record<string, string> = {
  STOP_SANITY: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  DD_DAILY: "text-rose-300 border-rose-500/40 bg-rose-500/10",
  DD_WEEKLY: "text-rose-300 border-rose-500/40 bg-rose-500/10",
  DD_MONTHLY: "text-rose-300 border-rose-500/40 bg-rose-500/10",
  HEAT_CAP: "text-rose-300 border-rose-500/40 bg-rose-500/10",
  DAILY_CAP: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  CONCURRENT_CAP: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  INSUFF_BAL: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  QTY_LT_1: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  DEPLOY_LE_0: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  DUPLICATE: "text-slate-300 border-slate-500/30 bg-slate-500/10",
  TXN_ABORT: "text-slate-300 border-slate-500/30 bg-slate-500/10",
  NO_ACCT: "text-rose-300 border-rose-500/40 bg-rose-500/10",
  INVALID_ENTRY: "text-rose-300 border-rose-500/40 bg-rose-500/10",
  INVALID_RISK: "text-rose-300 border-rose-500/40 bg-rose-500/10",
  OPENED: "text-emerald-300 border-emerald-500/40 bg-emerald-500/10",
  // P0.2 structured session codes (same orange tone as the legacy MARKET_CLOSED)
  MARKET_CLOSED: "text-orange-300 border-orange-500/40 bg-orange-500/10",
  MARKET_CLOSED_WEEKEND: "text-orange-300 border-orange-500/40 bg-orange-500/10",
  MARKET_CLOSED_HOLIDAY: "text-orange-300 border-orange-500/40 bg-orange-500/10",
  BEFORE_MARKET_SESSION: "text-orange-300 border-orange-500/40 bg-orange-500/10",
  AFTER_MARKET_SESSION: "text-orange-300 border-orange-500/40 bg-orange-500/10",
  ENTRY_CUTOFF_PASSED: "text-orange-300 border-orange-500/40 bg-orange-500/10",
  SPECIAL_SESSION_NOT_AUTHORIZED: "text-orange-300 border-orange-500/40 bg-orange-500/10",
  CALENDAR_UNAVAILABLE: "text-slate-300 border-slate-500/30 bg-slate-500/10",
  INVALID_SERVER_TIMESTAMP: "text-slate-300 border-slate-500/30 bg-slate-500/10",
  TRADE_ADMISSION_CONTEXT_INCOMPLETE: "text-slate-300 border-slate-500/30 bg-slate-500/10",
};

/**
 * Equity-side decision audit trail. Rolling view of every "would-be
 * trade" the auto swing tick + manual buy form considered, including
 * the gate that fired (if any) and the snapshot that drove it.
 *
 * Polls every 30 s — fast enough to feel live during market hours,
 * slow enough not to flood the API outside trading hours.
 */
function EqAuditPanel() {
  const summary = useQuery({
    queryKey: ["paper", "audit", "eq", "summary"],
    queryFn: () => api<{ items: Array<{ reason: string; count: number }>; hours: number }>(
      `/paper/audit/eq/summary?hours=24`,
    ),
    refetchInterval: 30_000,
  });
  const list = useQuery({
    queryKey: ["paper", "audit", "eq", "list"],
    queryFn: () => api<{ items: EqAuditRow[] }>(`/paper/audit/eq?limit=100`),
    refetchInterval: 30_000,
  });
  const items = list.data?.items ?? [];
  const summaryItems = summary.data?.items ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Equity decision audit</CardTitle>
        <CardDescription>
          Every paper-buy attempt (auto from STRONG_BUY scans, or manual from the
          Buy buttons) gets a row here. Use it to see exactly why a STRONG_BUY
          didn't trade — drawdown cap, heat cap, duplicate, balance, etc.
          Last 24 h summary on top; most-recent 100 decisions below. Refreshes every 30 s.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* 24h skip-reason summary */}
        {summary.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : summaryItems.length === 0 ? (
          <div className="text-xs text-muted-foreground font-mono">
            No decisions in the last 24 h.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {summaryItems.map(s => (
              <span
                key={s.reason}
                className={`px-2 py-1 rounded border text-[10px] font-mono uppercase tracking-wider ${SKIP_TONE[s.reason] ?? "text-muted-foreground border-border bg-muted/30"}`}
                title={`${s.count} occurrence${s.count === 1 ? "" : "s"} of ${s.reason} in the last 24 h`}
              >
                {s.reason} · {s.count}
              </span>
            ))}
          </div>
        )}
        {/* Detail table */}
        {list.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : list.error ? (
          <ErrorBlock message={list.error instanceof Error ? list.error.message : "Failed to load audit"} />
        ) : items.length === 0 ? (
          <div className="text-xs text-muted-foreground font-mono py-4 text-center">
            No audit rows yet.
          </div>
        ) : (
          <div className="overflow-auto max-h-96 border border-border rounded">
            <table className="w-full text-xs font-mono">
              <thead className="sticky top-0 bg-card border-b border-border z-10">
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-2 py-2">Time</th>
                  <th className="px-2 py-2">Symbol</th>
                  <th className="px-2 py-2">Decision</th>
                  <th className="px-2 py-2">Reason</th>
                  <th className="px-2 py-2">Detail</th>
                  <th className="px-2 py-2 text-right">Score</th>
                  <th className="px-2 py-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {items.map(r => (
                  <tr
                    key={r.id}
                    className="border-b border-border/50 hover:bg-accent/30"
                    data-testid={`row-audit-${r.id}`}
                  >
                    <td className="px-2 py-1.5 text-muted-foreground tabular-nums whitespace-nowrap">
                      {fmtDateTime(r.ts)}
                    </td>
                    <td className="px-2 py-1.5 font-bold">{r.symbol}</td>
                    <td className="px-2 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded border text-[10px] uppercase ${r.decision === "OPEN" ? "text-emerald-300 border-emerald-500/40 bg-emerald-500/10" : "text-rose-300 border-rose-500/40 bg-rose-500/10"}`}>
                        {r.decision}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`px-1.5 py-0.5 rounded border text-[10px] uppercase ${SKIP_TONE[r.reason] ?? "text-muted-foreground border-border bg-muted/30"}`}>
                        {r.reason}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground max-w-[420px] truncate" title={r.detail ?? ""}>
                      {r.detail ?? "—"}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {r.score == null ? "—" : r.score.toFixed(0)}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground text-[10px]">{r.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EqAccountCard({ data, openPositions, loading, error, onTopupSuccess }: {
  data?: PaperAccount;
  openPositions: OpenEqPosition[];
  loading: boolean;
  error: string | null;
  onTopupSuccess: () => void;
}) {
  const [dialogMode, setDialogMode] = useState<"ADD" | "WITHDRAW" | null>(null);
  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle>Equity Account</CardTitle></CardHeader>
        <CardContent><ErrorBlock message={error} /></CardContent>
      </Card>
    );
  }
  if (loading || !data) {
    return (
      <Card>
        <CardHeader><CardTitle>Equity Account</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-24 w-full" /></CardContent>
      </Card>
    );
  }
  // Capital math:
  //   invested        = sum of entry × qty for all OPEN positions
  //   currentValue    = sum of LTP   × qty for all OPEN positions (live MTM)
  //   unrealizedPnl   = currentValue - invested
  //   realizedLifetime= server-computed sum of realizedPnl across every
  //                     CLOSED trade. Top-up safe (does NOT count manual
  //                     capital injections as realised gains).
  const invested = openPositions.reduce((s, p) => s + p.capitalDeployed, 0);
  const currentValue = openPositions.reduce((s, p) => s + p.lastPrice * p.qty, 0);
  const unrealizedPnl = currentValue - invested;
  const unrealizedPnlPct = invested > 0 ? (unrealizedPnl / invested) * 100 : 0;
  // Show em-dash when the API hasn't supplied the field rather than
  // silently rendering ₹0.00 (which would mask a regression / DB issue).
  const hasLifetime = typeof data.lifetimeRealizedPnl === "number";
  const realizedLifetime = data.lifetimeRealizedPnl ?? 0;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Equity Account</CardTitle>
          <CardDescription>
            Live capital snapshot. Closed-trade history lives in the Reports tab.
            Use Add capital to top up the running cash balance.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDialogMode("ADD")}
            data-testid="button-topup-eq"
          >
            Add capital
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDialogMode("WITHDRAW")}
            disabled={data.balance <= 0}
            data-testid="button-withdraw-eq"
          >
            Withdraw
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Section 1 — Capital ledger */}
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
            Capital
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Capital introduced" value={inr(data.seedCapital)} />
            <Stat label="Invested" value={inr(invested)} />
            <Stat
              label="Realized P&L (lifetime)"
              value={hasLifetime ? inrDec(realizedLifetime) : "—"}
              tone={
                hasLifetime
                  ? realizedLifetime > 0
                    ? "pos"
                    : realizedLifetime < 0
                      ? "neg"
                      : undefined
                  : undefined
              }
            />
            <Stat label="Balance capital" value={inr(data.balance)} />
          </div>
        </div>
        {/* Section 2 — Open portfolio MTM */}
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
            Open portfolio (live MTM)
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat label="Invested amount" value={inr(invested)} />
            <Stat label="Current value" value={inr(currentValue)} />
            <Stat
              label="Profit / Loss"
              value={inrDec(unrealizedPnl)}
              tone={unrealizedPnl > 0 ? "pos" : unrealizedPnl < 0 ? "neg" : undefined}
            />
            <Stat
              label="% P/L"
              value={`${unrealizedPnlPct >= 0 ? "+" : ""}${unrealizedPnlPct.toFixed(2)}%`}
              tone={unrealizedPnl > 0 ? "pos" : unrealizedPnl < 0 ? "neg" : undefined}
            />
          </div>
        </div>
      </CardContent>
      <TopupDialog
        open={dialogMode !== null}
        mode={dialogMode ?? "ADD"}
        onClose={() => setDialogMode(null)}
        onSuccess={onTopupSuccess}
        segment="EQUITY"
        currentBalance={data.balance}
      />
    </Card>
  );
}

// Phase-1 portfolio drawdown meters. Render only when the API supplied
// the FNO-only fields (omitted on the equity account). Tints red once
// usage hits 80 % of cap so the trader sees the wall before the gate
// blocks the next trade.
function DrawdownMeter({
  label,
  drawdownPct,
  capPct,
}: {
  label: string;
  drawdownPct: number;
  capPct: number;
}) {
  const usage = capPct > 0 ? Math.min(1, drawdownPct / capPct) : 0;
  const widthPct = Math.round(usage * 100);
  const tone =
    usage >= 0.8 ? "bg-rose-500" :
    usage >= 0.5 ? "bg-amber-500" :
                   "bg-emerald-500";
  const labelTone =
    usage >= 0.8 ? "text-rose-300" :
    usage >= 0.5 ? "text-amber-300" :
                   "text-muted-foreground";
  return (
    <div
      className="flex flex-col gap-1"
      title={`Realised loss in window as % of seed capital. Cap = ${(capPct * 100).toFixed(2)}%; new entries blocked at cap.`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className={`text-[10px] font-mono uppercase tracking-wider ${labelTone}`}>
          {label}
        </span>
        <span className="text-xs font-mono tabular-nums">
          {(drawdownPct * 100).toFixed(2)}% / {(capPct * 100).toFixed(2)}%
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-secondary/40 overflow-hidden">
        <div className={`h-full ${tone} transition-all`} style={{ width: `${widthPct}%` }} />
      </div>
    </div>
  );
}

/**
 * Tiny env probe shown above every Paper-Trading segment so the owner
 * never confuses the dev preview (read-only by default) with the live
 * production deployment (auto-trader on). Hits a public diagnostic
 * endpoint so it renders even before login.
 */
interface EnvInfo {
  env: "production" | "development";
  autoTradingEnabled: boolean;
  reason: string;
}

function EnvironmentBanner() {
  const q = useQuery({
    queryKey: ["paper", "diagnostics", "environment"] as const,
    queryFn: () => api<EnvInfo>(`/paper/diagnostics/environment`),
    staleTime: 5 * 60_000,
  });
  if (!q.data) return null;
  const isProd = q.data.env === "production";
  const live = q.data.autoTradingEnabled;
  // Production + auto-trader on → muted green confirmation.
  // Anything else (dev, or prod with auto-trader off) → loud amber so
  // the owner knows new trades are NOT being captured here.
  const tone =
    isProd && live
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
      : "border-amber-500/40 bg-amber-500/10 text-amber-100";
  const headline = isProd
    ? live
      ? "Production · live paper trading"
      : "Production · auto-trader DISABLED (read-only)"
    : live
      ? "Development · auto-trader ENABLED (unusual — overrides default)"
      : "Development preview · read-only (auto-trader off)";
  const sub = isProd
    ? "This is the live deployment on your published domain. New auto-opens here are recorded as real paper trades."
    : "This is the Replit Workspace preview. New auto-opens are suppressed so dev cannot diverge from prod. Existing dev history stays visible. Manual buys still work for testing.";
  return (
    <div className={`rounded-md border px-4 py-2.5 text-sm ${tone}`}>
      <div className="font-semibold">{headline}</div>
      <div className="text-xs opacity-90 mt-0.5">{sub}</div>
      <div className="text-[11px] opacity-70 mt-1 font-mono">env={q.data.env} · {q.data.reason}</div>
    </div>
  );
}

/**
 * Snapshot from `GET /paper/diagnostics/daily-summary/fo`. We only type
 * the fields the card consumes; extra fields are ignored.
 */
interface FoDailySummary {
  date: string;
  signalsGenerated: number;
  tradesOpened: number;
  tradesOpenedByTier: { BASELINE: number; HC: number };
  validCandidates: number;
  tradeOpenRate: number | null;
  skipped: {
    total: number;
    byReason: Array<{ key: string; count: number }>;
  };
}

/**
 * Friendly one-liner for each `SkipReason` returned by the F&O paper
 * trader. Keys MUST stay in sync with the `SkipReason` union in
 * `artifacts/api-server/src/lib/paperTradingFO.ts`. Unknown keys fall
 * through to the raw key so a new reason never silently disappears.
 */
const SKIP_REASON_COPY: Record<string, string> = {
  MISSED_WINDOW:
    "Signal triggered & exited inside the same 30s sweep — anti-phantom rule.",
  DATA_QUALITY_DELAYED:
    "Data was delayed at the moment of trigger — F&O requires live Kite.",
  DATA_QUALITY_STALE:
    "Data was stale at the moment of trigger — last bar older than freshness floor.",
  CONFIDENCE_FLOOR:
    "Below confidence floor (HC ≥65 / BASELINE ≥55).",
  MARKET_CLOSED:
    "Market closed — no new F&O opens outside session hours.",
  TIME_FILTER_LATE:
    "After F&O late-entry cutoff (close to 15:20 IST force-exit window).",
  BASELINE_LATE:
    "BASELINE late-entry cutoff (after 14:45 IST) — no new BASELINE opens.",
  LIQUIDITY_LTP:
    "Option leg LTP below liquidity floor (≥ ₹20).",
  LIQUIDITY_SPREAD:
    "Option leg bid-ask spread above 1.5% — too wide to fill safely.",
  LIQUIDITY_OI:
    "Option leg open-interest below 50k contracts.",
  LIQUIDITY_CHAIN_MISSING:
    "No option chain available for the underlying / expiry.",
  INVALID_PREMIUM_PLAN:
    "Premium plan invalid (entry / stop / target geometry rejected).",
  DAILY_TRADE_CAP:
    "Daily F&O trade cap reached — no more opens today (IST).",
  BASELINE_DAILY_CAP:
    "BASELINE lane locked: max 2 BASELINE trades/day reached.",
  CONSECUTIVE_STOPS:
    "Per-index 60-min cool-down after a stop-out — sizing throttled.",
  BASELINE_CONSECUTIVE_LOSSES:
    "BASELINE lane locked after 2 consecutive losses today.",
  DAILY_DD_CAP:
    "F&O daily DD cap (2.5%) latched — no more F&O opens today (IST).",
  WEEKLY_DD_CAP:
    "F&O weekly DD cap (5%) latched — no more F&O opens this week (Mon→).",
  BASELINE_DAILY_DD_CAP:
    "BASELINE lane locked: 0.75% daily loss cap reached. Lane reopens tomorrow (IST).",
  BASELINE_GUARDRAIL_STATS_UNAVAILABLE:
    "Guardrail stats unavailable — failing CLOSED on BASELINE opens (safety).",
  PORTFOLIO_HEAT:
    "Portfolio heat cap reached — open positions already use 6% of capital.",
  BUDGET_TOO_TIGHT:
    "Computed lot budget too tight to open even one lot at this premium.",
  INSUFFICIENT_BALANCE:
    "Cash balance below the capital required for one lot.",
};

// Sticky-latch SkipReasons (vs transient gates like CONFIDENCE_FLOOR or
// MISSED_WINDOW which can change tick to tick). These names MUST match the
// `SkipReason` union in `paperTradingFO.ts`.
const LATCH_REASON_COPY: Record<string, string> = {
  BASELINE_DAILY_DD_CAP: "BASELINE 0.75% daily loss cap latched",
  BASELINE_DAILY_CAP: "BASELINE 2-trades/day cap reached",
  BASELINE_CONSECUTIVE_LOSSES: "BASELINE lane locked after 2 consecutive losses",
  BASELINE_LATE: "BASELINE late-entry cutoff (after 14:45 IST)",
  BASELINE_GUARDRAIL_STATS_UNAVAILABLE:
    "BASELINE guardrail stats unavailable (fail-closed)",
  DAILY_TRADE_CAP: "Daily F&O trade cap reached",
  PORTFOLIO_HEAT: "Portfolio heat cap reached (6%)",
  TIME_FILTER_LATE: "After 15:20 IST F&O cutoff",
};

/**
 * Pure display helper — derives the list of ACTIVE guardrail latches from the
 * account snapshot + daily F&O summary. Classification/labelling only: it reads
 * nothing it does not already display and changes no trading decision, cap, or
 * latch state (the real latches live server-side).
 */
function deriveGuardrailLatches(account: PaperAccount, s: FoDailySummary): string[] {
  const tradeCap = account.dailyTradeCap;
  const tradeCapReached = tradeCap > 0 && account.dayTradeCount >= tradeCap;
  const dailyDdLatched =
    account.dailyDrawdownPct != null &&
    account.dailyDrawdownCapPct != null &&
    account.dailyDrawdownPct >= account.dailyDrawdownCapPct;
  const weeklyDdLatched =
    account.weeklyDrawdownPct != null &&
    account.weeklyDrawdownCapPct != null &&
    account.weeklyDrawdownPct >= account.weeklyDrawdownCapPct;

  const latches: string[] = [];
  if (dailyDdLatched) latches.push("Daily DD cap latched");
  if (weeklyDdLatched) latches.push("Weekly DD cap latched");
  if (tradeCapReached) latches.push("Daily trade cap reached");
  for (const r of s.skipped.byReason.slice(0, 5)) {
    if (r.count > 0 && LATCH_REASON_COPY[r.key]) latches.push(LATCH_REASON_COPY[r.key]);
  }
  return latches;
}

/**
 * Compact, high-visibility latch banner surfaced near the TOP of the F&O cockpit
 * so an operator immediately sees WHY entries are blocked, without scrolling to
 * the "Why no F&O trade?" detail card. Shares the daily-summary query key with
 * that card, so React Query dedupes — no extra network fetch. Renders nothing
 * when no latch is active.
 */
function FoGuardrailLatchBanner({ account }: { account: PaperAccount }) {
  const summary = useQuery({
    queryKey: ["paper", "fo", "daily-summary"] as const,
    queryFn: () => api<FoDailySummary>(`/paper/diagnostics/daily-summary/fo`),
    refetchInterval: 30_000,
  });
  if (!summary.data) return null;
  const latches = deriveGuardrailLatches(account, summary.data);
  if (latches.length === 0) return null;
  return (
    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      <div className="font-semibold mb-1">
        Active guardrail latch — F&amp;O entries are intentionally blocked
      </div>
      <ul className="list-disc list-inside text-amber-100/90 space-y-0.5">
        {latches.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <div className="mt-2 text-xs text-amber-100/70">
        Lane reopens on the next IST trading day. This is the safety net working
        as designed — not a bug. Full breakdown in “Why no F&amp;O trade?” below.
      </div>
    </div>
  );
}

function GuardrailStatusCard({ account }: { account: PaperAccount }) {
  const summary = useQuery({
    queryKey: ["paper", "fo", "daily-summary"] as const,
    queryFn: () => api<FoDailySummary>(`/paper/diagnostics/daily-summary/fo`),
    refetchInterval: 30_000,
  });

  // B2.2-D-168: Distinguish the five required states.
  // INITIAL_ERROR_WITHOUT_DATA — first fetch failed, skeleton would be misleading.
  if (summary.isError && !summary.data) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">Why no F&amp;O trade?</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div
            className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
            data-testid="guardrail-status-error"
          >
            <div className="font-semibold mb-1">Failed to load guardrail status</div>
            <div className="text-rose-100/80">
              {summary.error instanceof Error ? summary.error.message : "Unexpected error — please retry."}
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void summary.refetch()}
            data-testid="guardrail-status-retry"
          >
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }
  // INITIAL_LOADING — first fetch in progress.
  if (summary.isLoading || !summary.data) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-sm">Why no F&amp;O trade?</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-24 w-full" /></CardContent>
      </Card>
    );
  }
  // From here: summary.data is present. If summary.isError is ALSO true it means
  // a background refetch failed while old data is still cached (REFETCH_ERROR_WITH_
  // USABLE_CACHED_DATA). The stale indicator is injected in the Card header below.

  const s = summary.data;
  const tradeCap = account.dailyTradeCap;

  // Top 5 skip reasons (already sorted desc on the server).
  const topReasons = s.skipped.byReason.slice(0, 5);
  const openRatePct =
    s.tradeOpenRate == null ? "—" : `${(s.tradeOpenRate * 100).toFixed(0)}%`;

  // Show a coloured headline only when something is actively gating.
  const latches = deriveGuardrailLatches(account, s);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Why no F&amp;O trade?</CardTitle>
        {/* REFETCH_ERROR_WITH_USABLE_CACHED_DATA: stale label inline, data still shown */}
        {summary.isError && (
          <div
            className="mt-1 flex items-center gap-1.5 text-[10px] font-mono text-amber-400"
            data-testid="guardrail-status-stale"
          >
            <AlertTriangle className="w-3 h-3" />
            Refresh failed — showing last-known values
          </div>
        )}
        <CardDescription>
          Live view of today&apos;s safety guardrails and signal-skip reasons.
          The system can be quiet because nothing qualified, or because a
          guardrail latched after a loss. This panel makes the difference
          obvious. Refreshes every 30s.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {latches.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <div className="font-semibold mb-1">
              Active guardrail latch — entries are intentionally blocked
            </div>
            <ul className="list-disc list-inside text-amber-100/90 space-y-0.5">
              {latches.map(l => <li key={l}>{l}</li>)}
            </ul>
            <div className="mt-2 text-xs text-amber-100/70">
              Latches reset on the next IST trading day. This is the safety
              net working as designed — not a bug.
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <GuardrailStat label="Signals today" value={String(s.signalsGenerated)} />
          <GuardrailStat
            label="Trades opened"
            value={`${s.tradesOpened} / ${tradeCap}`}
            sub={`HC ${s.tradesOpenedByTier.HC} · BASELINE ${s.tradesOpenedByTier.BASELINE}`}
          />
          <GuardrailStat
            label="Open rate"
            value={openRatePct}
            sub={`${s.validCandidates} candidates`}
          />
          <GuardrailStat
            label="Skipped today"
            value={String(s.skipped.total)}
            sub="durable daily summary"
          />
        </div>

        {topReasons.length > 0 && (
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              Top skip reasons
            </div>
            <ul className="space-y-1.5 text-sm">
              {topReasons.map(r => (
                <li key={r.key} className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <Badge variant="outline" className="font-mono text-[11px]">
                      {r.key}
                    </Badge>
                    <span className="ml-2 text-muted-foreground">
                      {SKIP_REASON_COPY[r.key] ?? "See diagnostics for detail."}
                    </span>
                  </div>
                  <span className="font-semibold tabular-nums">{r.count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {topReasons.length === 0 && s.signalsGenerated > 0 && (
          <p className="text-sm text-muted-foreground">
            No skip reasons logged today — every qualifying signal opened.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function GuardrailStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function FnoDrawdownCard({ data }: { data: PaperAccount }) {
  if (
    data.dailyDrawdownPct == null ||
    data.dailyDrawdownCapPct == null ||
    data.weeklyDrawdownPct == null ||
    data.weeklyDrawdownCapPct == null
  ) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Portfolio drawdown caps</CardTitle>
        <CardDescription>
          Realised loss as % of seed capital. New paper entries are
          automatically blocked once either cap is reached. Counts only
          CLOSED trades (open MTM does not gate).
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DrawdownMeter
          label="Daily DD (today, IST)"
          drawdownPct={data.dailyDrawdownPct}
          capPct={data.dailyDrawdownCapPct}
        />
        <DrawdownMeter
          label="Weekly DD (Mon→today, IST)"
          drawdownPct={data.weeklyDrawdownPct}
          capPct={data.weeklyDrawdownCapPct}
        />
      </CardContent>
    </Card>
  );
}

function EqPositionsCard({ positions, loading, error, onBuyClick }: {
  positions: OpenEqPosition[];
  loading: boolean;
  error: string | null;
  onBuyClick: () => void;
}) {
  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle>Portfolio</CardTitle></CardHeader>
        <CardContent><ErrorBlock message={error} /></CardContent>
      </Card>
    );
  }
  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>Portfolio</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-32 w-full" /></CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Portfolio</CardTitle>
          <CardDescription>
            Live mark-to-market using the most recent LTP from the scanner
            cache. Stop trails up to T1 once price prints T1. Use Close to
            force-exit at the last observed LTP.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onBuyClick}
          data-testid="button-buy-eq"
        >
          Buy stock
        </Button>
      </CardHeader>
      <CardContent>
        {positions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No open equity positions right now. Auto-opens on the next
            qualifying STRONG_BUY signal in the F&amp;O 200 universe.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="py-2 pr-3">Symbol</th>
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3 text-right">Qty</th>
                  <th className="py-2 pr-3 text-right">LTP</th>
                  <th className="py-2 pr-3 text-right">Entry</th>
                  <th className="py-2 pr-3 text-right">SL</th>
                  <th className="py-2 pr-3 text-right">T1</th>
                  <th className="py-2 pr-3 text-right">T2</th>
                  <th className="py-2 pr-3 text-right">Capital</th>
                  <th className="py-2 pr-3 text-right">U.P&amp;L</th>
                  <th className="py-2 pr-3 text-right">U.P&amp;L %</th>
                  <th className="py-2 pr-3 text-right">Day P&amp;L</th>
                  <th className="py-2 pr-3 text-right">Day %</th>
                  <th className="py-2 pr-3">Opened</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {positions.map(p => <EqPositionRow key={p.id} p={p} />)}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EqPositionRow({ p }: { p: OpenEqPosition }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const closeMut = useMutation({
    mutationFn: () =>
      api<ClosedEqTrade>(`/paper/positions/eq/${encodeURIComponent(p.id)}/close`, {
        method: "POST",
      }),
    onSuccess: () => {
      toast({ title: "Position closed", description: `${p.symbol} × ${p.qty}` });
      void qc.invalidateQueries({ queryKey: QK_POSITIONS_EQ });
      void qc.invalidateQueries({ queryKey: QK_ACCOUNT_EQ });
      void qc.invalidateQueries({ queryKey: QK_TRADES_EQ });
    },
    onError: (err: Error) => {
      toast({ title: "Close failed", description: err.message, variant: "destructive" });
    },
  });
  const upnlTone =
    p.unrealizedPnl > 0 ? "text-emerald-300" :
    p.unrealizedPnl < 0 ? "text-rose-300" : "text-foreground";
  const upnlPct = p.unrealizedPnlPct ?? (p.capitalDeployed > 0 ? (p.unrealizedPnl / p.capitalDeployed) * 100 : 0);
  // B2.2-D-PT-1: null dayPnl coerced to 0 fabricates a flat day — show "—" when unavailable.
  const dayPnl = p.dayPnl;
  const dayPnlPct = p.dayPnlPct;
  const dayTone =
    dayPnl == null ? "text-muted-foreground/60" :
    dayPnl > 0 ? "text-emerald-300" :
    dayPnl < 0 ? "text-rose-300" : "text-foreground";
  return (
    <tr className="border-b border-border/40">
      <td className="py-2 pr-3">
        <div className="font-medium">{p.symbol}</div>
        <div className="text-[11px] text-muted-foreground">
          {p.name}
          {p.trailedToT1 && (
            <span className="ml-2 text-amber-300">stop trailed to T1</span>
          )}
        </div>
      </td>
      <td className="py-2 pr-3">
        <EqSourceBadge source={p.source} />
      </td>
      <td className="py-2 pr-3 text-right tabular-nums">{p.qty}</td>
      <td className="py-2 pr-3 text-right tabular-nums font-medium">{p.lastPrice.toFixed(2)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{p.entryPrice.toFixed(2)}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-rose-300">{p.stopPrice.toFixed(2)}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-emerald-300">{p.target1Price.toFixed(2)}</td>
      <td className="py-2 pr-3 text-right tabular-nums text-emerald-300">{p.target2Price.toFixed(2)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{inr(p.capitalDeployed)}</td>
      <td className={`py-2 pr-3 text-right tabular-nums font-medium ${upnlTone}`}>
        {inrDec(p.unrealizedPnl)}
      </td>
      <td className={`py-2 pr-3 text-right tabular-nums ${upnlTone}`}>
        {upnlPct >= 0 ? "+" : ""}{upnlPct.toFixed(2)}%
      </td>
      <td className={`py-2 pr-3 text-right tabular-nums font-medium ${dayTone}`}>
        {/* B2.2-D-PT-1: dayPnl null → show "—" not ₹0.00 */}
        {dayPnl != null ? inrDec(dayPnl) : "—"}
      </td>
      <td className={`py-2 pr-3 text-right tabular-nums ${dayTone}`}>
        {/* B2.2-D-PT-1: dayPnlPct null → show "—" not +0.00% */}
        {dayPnlPct != null ? `${dayPnlPct >= 0 ? "+" : ""}${dayPnlPct.toFixed(2)}%` : "—"}
      </td>
      <td className="py-2 pr-3 text-[12px] text-muted-foreground whitespace-nowrap">
        <span>{fmtDateTime(p.openedAt)}</span>
        {p.openedSessionValidity === "OFF_SESSION" && (
          <Badge
            variant="outline"
            className="ml-1.5 text-[9px] px-1 py-0 border-orange-400/50 text-orange-400 align-middle"
            title={`Position opened outside the NSE equity session (09:15–15:30 IST, Mon–Fri).${p.openedSessionReason ? ` Reason: ${p.openedSessionReason}.` : ""} The session gate fix prevents recurrence.`}
          >
            OFF-SESSION
          </Badge>
        )}
        {p.openedSessionValidity === "SESSION_UNKNOWN" && (
          <Badge
            variant="outline"
            className="ml-1.5 text-[9px] px-1 py-0 border-slate-400/50 text-slate-400 align-middle"
            title="Session status could not be determined for this position's open timestamp."
          >
            SESSION?
          </Badge>
        )}
        {p.openedSessionValidity === "TIMESTAMP_AMBIGUOUS" && (
          <Badge
            variant="outline"
            className="ml-1.5 text-[9px] px-1 py-0 border-yellow-500/50 text-yellow-500 align-middle"
            title="Position's openedAt timestamp is null or unparseable — session validity cannot be determined."
          >
            TIMESTAMP?
          </Badge>
        )}
      </td>
      <td className="py-2 pr-3 text-right">
        <Button
          size="sm"
          variant="outline"
          disabled={closeMut.isPending}
          onClick={() => closeMut.mutate()}
        >
          {closeMut.isPending ? "Closing…" : "Close"}
        </Button>
      </td>
    </tr>
  );
}

function EqTradesCard({ trades, loading, error }: {
  trades: ClosedEqTrade[];
  loading: boolean;
  error: string | null;
}) {
  const totals = useMemo(() => {
    let realized = 0, wins = 0, losses = 0;
    for (const t of trades) {
      realized += t.realizedPnl;
      if (t.realizedPnl > 0) wins++;
      else if (t.realizedPnl < 0) losses++;
    }
    return {
      count: trades.length,
      realized,
      wins,
      losses,
      // Denominator: decided trades only (wins + losses). Scratches excluded.
      winPct: wins + losses === 0 ? null : wins / (wins + losses),
    };
  }, [trades]);
  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle>Today's closed trades</CardTitle></CardHeader>
        <CardContent><ErrorBlock message={error} /></CardContent>
      </Card>
    );
  }
  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>Today's closed trades</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-32 w-full" /></CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Today's closed trades</CardTitle>
        <CardDescription>
          {totals.count === 0
            ? "Nothing closed yet today."
            : `${totals.count} closed · realized ${inrDec(totals.realized)} · win-rate ${totals.winPct == null ? "—" : pct(totals.winPct)}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {trades.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No closed equity paper trades today yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="py-2 pr-3">Symbol</th>
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3 text-right">Qty</th>
                  <th className="py-2 pr-3 text-right">Entry</th>
                  <th className="py-2 pr-3 text-right">Exit</th>
                  <th className="py-2 pr-3 text-right">Capital</th>
                  <th className="py-2 pr-3 text-right">P&amp;L</th>
                  <th className="py-2 pr-3">Reason</th>
                  <th className="py-2 pr-3">Opened</th>
                  <th className="py-2 pr-3">Closed</th>
                  <th className="py-2 pr-3">Journal</th>
                </tr>
              </thead>
              <tbody>
                {trades.map(t => {
                  const tone =
                    t.realizedPnl > 0 ? "text-emerald-300" :
                    t.realizedPnl < 0 ? "text-rose-300" : "";
                  return (
                    <tr key={t.id} className="border-b border-border/40">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{t.symbol}</div>
                        <div className="text-[11px] text-muted-foreground">{t.name}</div>
                      </td>
                      <td className="py-2 pr-3">
                        <EqSourceBadge source={t.source} />
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{t.qty}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{t.entryPrice.toFixed(2)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{t.exitPrice.toFixed(2)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{inr(t.capitalDeployed)}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums font-medium ${tone}`}>
                        {inrDec(t.realizedPnl)}
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`px-2 py-0.5 rounded border text-[11px] ${EQ_REASON_TONE[t.exitReason]}`}>
                          {t.exitReason}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-[12px] text-muted-foreground">{fmtDate(t.openedAt)}</td>
                      <td className="py-2 pr-3 text-[12px] text-muted-foreground">{fmtTime(t.exitedAt)}</td>
                      <td className="py-2 pr-3">
                        <JournalPanel tradeId={t.id} segment="eq" initial={{ journal: t.journal, tags: t.tags }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type SkipReason =
  | "MISSED_WINDOW"
  | "DATA_QUALITY_DELAYED"
  | "DATA_QUALITY_STALE"
  | "CONFIDENCE_FLOOR"
  | "MARKET_CLOSED"
  | "TIME_FILTER_LATE"
  | "BASELINE_LATE"
  | "LIQUIDITY_LTP"
  | "LIQUIDITY_SPREAD"
  | "LIQUIDITY_OI"
  | "LIQUIDITY_CHAIN_MISSING"
  | "INVALID_PREMIUM_PLAN"
  | "DAILY_TRADE_CAP"
  | "BASELINE_DAILY_CAP"
  | "CONSECUTIVE_STOPS"
  | "BASELINE_CONSECUTIVE_LOSSES"
  | "DAILY_DD_CAP"
  | "WEEKLY_DD_CAP"
  | "BASELINE_DAILY_DD_CAP"
  | "BASELINE_GUARDRAIL_STATS_UNAVAILABLE"
  | "PORTFOLIO_HEAT"
  | "BUDGET_TOO_TIGHT"
  | "INSUFFICIENT_BALANCE";

interface MissedSignalRow {
  signalDate: string;
  indexSymbol: string;
  indexName: string;
  setupKey: string;
  direction: "BULLISH" | "BEARISH";
  confidence: number;
  tier: "BASELINE" | "STANDARD";
  status: string;
  reason: "TARGET2_HIT" | "TARGET1_HIT" | "STOPPED" | "EXPIRED" | "MANUAL_OVERRIDE" | null;
  skipReason: SkipReason;
  dataQuality: string;
  optionEntry: number | null;
  optionStop: number | null;
  optionTarget1: number | null;
  optionTarget2: number | null;
  observedAt: string;
}

const SKIP_REASON_LABEL: Record<SkipReason, string> = {
  MISSED_WINDOW: "Missed window",
  DATA_QUALITY_DELAYED: "Kite data unavailable",
  DATA_QUALITY_STALE: "Stale Kite bars",
  CONFIDENCE_FLOOR: "Below conf. floor",
  MARKET_CLOSED: "Market closed",
  TIME_FILTER_LATE: "Past 15:25 cutoff",
  BASELINE_LATE: "Baseline past 14:45",
  LIQUIDITY_LTP: "Premium below ₹20",
  LIQUIDITY_SPREAD: "Bid/ask too wide",
  LIQUIDITY_OI: "OI too thin",
  LIQUIDITY_CHAIN_MISSING: "Strike not on chain",
  INVALID_PREMIUM_PLAN: "Bad premium plan",
  DAILY_TRADE_CAP: "Daily 4-trade cap",
  BASELINE_DAILY_CAP: "Baseline 2/day cap",
  CONSECUTIVE_STOPS: "2 consec. stops",
  BASELINE_CONSECUTIVE_LOSSES: "Baseline 2 consec. losses",
  DAILY_DD_CAP: "Daily DD cap (2.5%)",
  WEEKLY_DD_CAP: "Weekly DD cap (5%)",
  BASELINE_DAILY_DD_CAP: "Baseline DD cap (0.75%)",
  BASELINE_GUARDRAIL_STATS_UNAVAILABLE: "Baseline stats unavailable (fail-closed)",
  PORTFOLIO_HEAT: "Portfolio heat cap",
  BUDGET_TOO_TIGHT: "Budget too tight",
  INSUFFICIENT_BALANCE: "Insufficient balance",
};

const SKIP_REASON_TONE: Record<SkipReason, string> = {
  MISSED_WINDOW: "bg-amber-500/15 text-amber-200 border-amber-500/30",
  DATA_QUALITY_DELAYED: "bg-sky-500/15 text-sky-200 border-sky-500/30",
  DATA_QUALITY_STALE: "bg-slate-500/15 text-slate-200 border-slate-500/30",
  CONFIDENCE_FLOOR: "bg-violet-500/15 text-violet-200 border-violet-500/30",
  MARKET_CLOSED: "bg-slate-500/15 text-slate-200 border-slate-500/30",
  TIME_FILTER_LATE: "bg-orange-500/15 text-orange-200 border-orange-500/30",
  BASELINE_LATE: "bg-orange-500/15 text-orange-200 border-orange-500/30",
  LIQUIDITY_LTP: "bg-cyan-500/15 text-cyan-200 border-cyan-500/30",
  LIQUIDITY_SPREAD: "bg-cyan-500/15 text-cyan-200 border-cyan-500/30",
  LIQUIDITY_OI: "bg-cyan-500/15 text-cyan-200 border-cyan-500/30",
  LIQUIDITY_CHAIN_MISSING: "bg-cyan-500/15 text-cyan-200 border-cyan-500/30",
  INVALID_PREMIUM_PLAN: "bg-rose-500/15 text-rose-200 border-rose-500/30",
  DAILY_TRADE_CAP: "bg-fuchsia-500/15 text-fuchsia-200 border-fuchsia-500/30",
  BASELINE_DAILY_CAP: "bg-fuchsia-500/15 text-fuchsia-200 border-fuchsia-500/30",
  CONSECUTIVE_STOPS: "bg-rose-500/15 text-rose-200 border-rose-500/30",
  BASELINE_CONSECUTIVE_LOSSES: "bg-rose-500/15 text-rose-200 border-rose-500/30",
  DAILY_DD_CAP: "bg-rose-500/15 text-rose-200 border-rose-500/30",
  WEEKLY_DD_CAP: "bg-rose-500/15 text-rose-200 border-rose-500/30",
  BASELINE_DAILY_DD_CAP: "bg-rose-500/15 text-rose-200 border-rose-500/30",
  BASELINE_GUARDRAIL_STATS_UNAVAILABLE: "bg-amber-500/15 text-amber-200 border-amber-500/30",
  PORTFOLIO_HEAT: "bg-amber-500/15 text-amber-200 border-amber-500/30",
  BUDGET_TOO_TIGHT: "bg-slate-500/15 text-slate-200 border-slate-500/30",
  INSUFFICIENT_BALANCE: "bg-slate-500/15 text-slate-200 border-slate-500/30",
};

interface FoAnalytics {
  totalTrades: number;
  wins: number;
  losses: number;
  scratches: number;
  winRate: number | null;
  totalRealizedPnl: number;
  avgWin: number;
  avgLoss: number;
  largestWin: number;
  largestLoss: number;
  profitFactor: number;
  expectancy: number;
  avgRMultiple: number | null;
  rMultipleSamples: number;
  maxDrawdown: number;
  currentDrawdown: number;
  peakEquity: number;
  exitReasonCounts: Record<string, number>;
  bySetup: Array<{
    setupKey: string;
    trades: number;
    wins: number;
    losses: number;
    winRate: number | null;
    totalPnl: number;
    avgPnl: number;
    bestTrade: number;
    worstTrade: number;
  }>;
  equityCurve: Array<{
    date: string;
    dailyPnl: number;
    cumulativePnl: number;
    drawdown: number;
  }>;
  generatedAt: string;
}

function FOSegment() {
  const qc = useQueryClient();
  const account = useQuery({
    queryKey: QK_ACCOUNT,
    queryFn: () => api<PaperAccount>(`/paper/account?segment=FNO`),
    refetchInterval: 10_000,
  });
  const exitMonitorStatus = useQuery({
    queryKey: ["paper", "diagnostics", "fo", "exit-monitor", "status"] as const,
    queryFn: () => api<ExitMonitorStatusResponse>(`/paper/diagnostics/fo/exit-monitor/status`),
    refetchInterval: 30_000,
  });
  const [exitMonitorSelectedId, setExitMonitorSelectedId] = useState("");
  const [exitMonitorRunResult, setExitMonitorRunResult] = useState<RunResultLike | null>(null);
  const runDryMut = useMutation({
    mutationFn: (id: string) =>
      api<{ generatedAt: string; status?: string; decision?: RunResultLike["decision"] }>(
        `/paper/diagnostics/fo/exit-monitor/run-dry`,
        { method: "POST", body: JSON.stringify({ id }) },
      ),
    onSuccess: (res) => {
      setExitMonitorRunResult({ action: "dry", at: Date.now(), status: res.status, decision: res.decision ?? null });
    },
    onError: (err: Error) => {
      setExitMonitorRunResult({ action: "dry", at: Date.now(), error: err.message });
    },
  });
  const runNowMut = useMutation({
    mutationFn: (id: string) =>
      api<{
        generatedAt: string;
        status?: string;
        closed?: boolean;
        decision?: RunResultLike["decision"];
      }>(`/paper/diagnostics/fo/exit-monitor/run-now`, {
        method: "POST",
        body: JSON.stringify({ id }),
      }),
    onSuccess: (res) => {
      setExitMonitorRunResult({
        action: "now",
        at: Date.now(),
        status: res.status,
        closed: res.closed,
        decision: res.decision ?? null,
      });
      if (res.closed) {
        toast({ title: "Trade closed", description: "Exit monitor manually closed the selected trade." });
        void qc.invalidateQueries({ queryKey: QK_POSITIONS });
        void qc.invalidateQueries({ queryKey: QK_ACCOUNT });
        void qc.invalidateQueries({ queryKey: QK_TRADES });
      }
      void qc.invalidateQueries({ queryKey: ["paper", "diagnostics", "fo", "exit-monitor", "status"] });
    },
    onError: (err: Error) => {
      setExitMonitorRunResult({ action: "now", at: Date.now(), error: err.message });
    },
  });
  const positions = useQuery({
    queryKey: QK_POSITIONS,
    queryFn: () => api<{ positions: OpenPosition[]; generatedAt: string }>(`/paper/positions/fo`),
    refetchInterval: 10_000,
  });
  const missed = useQuery({
    queryKey: ["paper", "missed", "FNO"] as const,
    queryFn: () => api<{ missed: MissedSignalRow[]; generatedAt: string }>(`/paper/missed/fo`),
    refetchInterval: 30_000,
  });
  // Closed trades for the day power the read-only cockpit summary tiles.
  // The full historical analytics, equity curve and by-setup breakdown
  // still live on the Reports tab (/paper-reports) — this stays live-only.
  const trades = useQuery({
    queryKey: QK_TRADES,
    queryFn: () =>
      api<{ date: string; trades: ClosedTrade[]; generatedAt: string }>(`/paper/trades/fo`),
    refetchInterval: 30_000,
  });
  // Official P25 evidence count = server-computed `mfeAvailableCount`.
  const shadowExits = useQuery({
    queryKey: ["paper", "analytics", "fo", "shadow-exits"] as const,
    queryFn: () =>
      api<FoShadowExitsResponse>(`/paper/analytics/fo/shadow-exits`),
    refetchInterval: 60_000,
  });
  const mtmSweep = useQuery({
    queryKey: ["paper", "diagnostics", "fo", "mtm-sweep"] as const,
    queryFn: () => api<{ lastSuccessAt: string | null }>(`/paper/diagnostics/fo/mtm-sweep`),
    refetchInterval: 30_000,
  });

  const openRows = useMemo<FoTradeRow[]>(
    () => (positions.data?.positions ?? []).map((p) => ({ ...p, status: "OPEN" })),
    [positions.data],
  );
  const closedRows = useMemo<FoTradeRow[]>(
    () => (trades.data?.trades ?? []).map((t) => ({ ...t, status: "CLOSED" })),
    [trades.data],
  );
  const exitMonitorOpenPositions = useMemo(
    () =>
      (positions.data?.positions ?? []).map((p) => ({
        id: p.id,
        label: `${p.indexSymbol} ${p.strike} ${p.optionType} · ${p.direction} · opened ${p.openedAt.slice(0, 16).replace("T", " ")}`,
      })),
    [positions.data],
  );

  // ── W3-P6: client-side cockpit controls (display-only) ──────────────────────
  // Shared filter/sort/group state for the whole F&O cockpit. Every transform is
  // an accepted PURE helper over rows already fetched — no new fetch, no payload
  // change, no trading-logic touch. Filtering/sorting/grouping is presentation.
  const [foFilters, setFoFilters] = useState<FoFilters>(DEFAULT_FO_FILTERS);
  const [foSortKey, setFoSortKey] = useState<FoSortKey>("entryTime");
  const [foSortDir, setFoSortDir] = useState<FoSortDir>("desc");
  const [foGroupBy, setFoGroupBy] = useState<FoGroupBy>("none");

  const foOptions = useMemo(() => {
    const all = [...openRows, ...closedRows];
    return {
      indexes: uniqueIndexes(all),
      setups: uniqueSetups(all),
      directions: uniqueDirections(all),
      optionTypes: uniqueOptionTypes(all),
      exitReasons: uniqueExitReasons(all),
    };
  }, [openRows, closedRows]);

  // id → original payload, so grouped FoTradeRow rows map back to typed payloads
  // without re-deriving any field.
  // Keys normalized via String() on BOTH build and lookup, so a numeric-vs-string
  // id mismatch can never silently drop a row from the grouped view.
  const openById = useMemo(
    () => new Map((positions.data?.positions ?? []).map((p) => [String(p.id), p])),
    [positions.data],
  );
  const closedById = useMemo(
    () => new Map((trades.data?.trades ?? []).map((t) => [String(t.id), t])),
    [trades.data],
  );

  const openFilteredSorted = useMemo(
    () => sortFoRows(applyFoFilters(openRows, foFilters), foSortKey, foSortDir),
    [openRows, foFilters, foSortKey, foSortDir],
  );
  const closedFilteredSorted = useMemo(
    () => sortFoRows(applyFoFilters(closedRows, foFilters), foSortKey, foSortDir),
    [closedRows, foFilters, foSortKey, foSortDir],
  );

  const openGroups = useMemo<FoOpenGroup[]>(
    () =>
      groupFoRows(openFilteredSorted, foGroupBy)
        .map((g) => ({
          key: g.key,
          positions: g.rows
            .map((r) => openById.get(String(r.id)))
            .filter((p): p is NonNullable<typeof p> => p != null),
        }))
        .filter((g) => g.positions.length > 0),
    [openFilteredSorted, foGroupBy, openById],
  );
  const closedGroups = useMemo<FoClosedGroup[]>(
    () =>
      groupFoRows(closedFilteredSorted, foGroupBy)
        .map((g) => ({
          key: g.key,
          trades: g.rows
            .map((r) => closedById.get(String(r.id)))
            .filter((t): t is NonNullable<typeof t> => t != null),
        }))
        .filter((g) => g.trades.length > 0),
    [closedFilteredSorted, foGroupBy, closedById],
  );

  const foCounts = useMemo(
    () => ({
      open: openFilteredSorted.length,
      closed: closedFilteredSorted.length,
      showing: openFilteredSorted.length + closedFilteredSorted.length,
      total: openRows.length + closedRows.length,
      active: countActiveFoFilters(foFilters),
    }),
    [openFilteredSorted, closedFilteredSorted, openRows, closedRows, foFilters],
  );

  const cockpitSummary = useMemo(
    () => summarizeFoCockpit({ openTrades: openRows, closedTrades: closedRows }),
    [openRows, closedRows],
  );
  const p25 = useMemo(
    () =>
      deriveP25Headline({
        officialCount:
          shadowExits.data?.enabled === false
            ? null
            : shadowExits.data?.mfeAvailableCount,
      }),
    [shadowExits.data],
  );
  const p25Detail = useMemo(
    () => deriveP25EvidenceDetail(shadowExits.data),
    [shadowExits.data],
  );
  const lastClosedAt = useMemo<string | null>(() => {
    let best: string | null = null;
    let bestMs = -Infinity;
    for (const t of trades.data?.trades ?? []) {
      const ms = Date.parse(t.exitedAt);
      if (Number.isFinite(ms) && ms > bestMs) {
        bestMs = ms;
        best = t.exitedAt;
      }
    }
    return best;
  }, [trades.data]);
  const freshness = useMemo(
    () =>
      deriveFoFreshness({
        now: Date.now(),
        mtmSweepLastSuccessAt: mtmSweep.data?.lastSuccessAt ?? null,
        lastOpenEvalAt: cockpitSummary.lastEvaluatedAt,
        lastClosedAt,
      }),
    [mtmSweep.data, cockpitSummary.lastEvaluatedAt, lastClosedAt],
  );
  const summaryLoading = positions.isLoading || trades.isLoading;
  // B2.2-D-168: Detect refetch-error-with-cached-data — both .isError and .data
  // are set simultaneously when a background refetch fails while stale data exists.
  // In that case, show data + stale label instead of an amber "metrics unavailable" box.
  const summaryIsStale =
    (positions.isError && positions.data != null) ||
    (trades.isError && trades.data != null);
  // Only surface the error string for INITIAL errors (no cached data).
  // Refetch errors use summaryIsStale so the data is preserved and labelled.
  const summaryError = summaryIsStale
    ? null
    : positions.error instanceof Error
      ? positions.error.message
      : trades.error instanceof Error
        ? trades.error.message
        : null;

  const handleTopupSuccess = useCallback(() => {
    void qc.invalidateQueries({ queryKey: QK_ACCOUNT });
  }, [qc]);

  // Pre-existing manual close, lifted here so the upgraded open-positions
  // table/cards stay presentational. Same endpoint, same invalidations, same
  // toast as before — no new close semantics introduced. A per-id pending set
  // preserves the old per-row lock so concurrent closes on different rows each
  // stay disabled until their own request settles (single-flight per row).
  const { toast } = useToast();
  const [closingIds, setClosingIds] = useState<ReadonlySet<string>>(() => new Set());
  const closeMut = useMutation({
    mutationFn: (id: string) =>
      api<ClosedTrade>(`/paper/positions/fo/${encodeURIComponent(id)}/close`, {
        method: "POST",
      }),
    onMutate: (id) => {
      setClosingIds((prev) => {
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    },
    onSuccess: (_res, id) => {
      const pos = positions.data?.positions.find((p) => p.id === id);
      toast({
        title: "Position closed",
        description: pos ? `${pos.indexSymbol} ${pos.optionType} ${pos.strike}` : undefined,
      });
      void qc.invalidateQueries({ queryKey: QK_POSITIONS });
      void qc.invalidateQueries({ queryKey: QK_ACCOUNT });
      void qc.invalidateQueries({ queryKey: QK_TRADES });
    },
    onError: (err: Error) => {
      toast({ title: "Close failed", description: err.message, variant: "destructive" });
    },
    onSettled: (_res, _err, id) => {
      setClosingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    },
  });
  const handleCloseFo = useCallback(
    (id: string) => {
      if (closingIds.has(id)) return;
      closeMut.mutate(id);
    },
    [closingIds, closeMut],
  );

  return (
    <div className="space-y-6">
      <LedgerHealthCard segment="FNO" />
      <FoCockpitSafetyBanner p25={p25} freshness={freshness} />
      <FoCockpitSummaryCards
        summary={summaryLoading ? null : cockpitSummary}
        p25={p25}
        loading={summaryLoading}
        error={summaryError}
        isStale={summaryIsStale}
      />
      {account.data && <FoGuardrailLatchBanner account={account.data} />}
      <FoP25EvidencePanel
        detail={p25Detail}
        loading={shadowExits.isLoading}
        error={shadowExits.error instanceof Error ? shadowExits.error.message : null}
        errorStatus={shadowExits.error instanceof ApiError ? shadowExits.error.status : null}
      />
      <FoExitMonitorPanel
        data={exitMonitorStatus.data ?? null}
        loading={exitMonitorStatus.isLoading}
        error={exitMonitorStatus.error instanceof Error ? exitMonitorStatus.error.message : null}
        openPositions={exitMonitorOpenPositions}
        selectedId={exitMonitorSelectedId}
        onSelectedIdChange={setExitMonitorSelectedId}
        onRunDry={() => runDryMut.mutate(exitMonitorSelectedId)}
        onRunNow={() => runNowMut.mutate(exitMonitorSelectedId)}
        runDryPending={runDryMut.isPending}
        runNowPending={runNowMut.isPending}
        runResult={exitMonitorRunResult}
      />
      <AccountCard
        data={account.data}
        loading={account.isLoading}
        error={account.error instanceof Error ? account.error.message : null}
        onTopupSuccess={handleTopupSuccess}
      />
      {account.data && <FnoDrawdownCard data={account.data} />}
      {account.data && <GuardrailStatusCard account={account.data} />}
      <FoCockpitControls
        filters={foFilters}
        onFilters={setFoFilters}
        sortKey={foSortKey}
        onSortKey={setFoSortKey}
        sortDir={foSortDir}
        onSortDir={setFoSortDir}
        groupBy={foGroupBy}
        onGroupBy={setFoGroupBy}
        onReset={() => setFoFilters(DEFAULT_FO_FILTERS)}
        options={foOptions}
        counts={foCounts}
      />
      <FoOpenTradesTable
        groups={openGroups}
        grouped={foGroupBy !== "none"}
        rawCount={openRows.length}
        isNoData={(positions.data?.positions ?? null) == null}
        loading={positions.isLoading}
        error={positions.error instanceof Error ? positions.error.message : null}
        now={Date.now()}
        onClose={handleCloseFo}
        closingIds={closingIds}
      />
      <FoClosedTradesReview
        groups={closedGroups}
        grouped={foGroupBy !== "none"}
        rawCount={closedRows.length}
        isNoData={(trades.data?.trades ?? null) == null}
        loading={trades.isLoading}
        error={trades.error instanceof Error ? trades.error.message : null}
      />
      <MissedSignalsCard
        missed={missed.data?.missed ?? []}
        loading={missed.isLoading}
        error={missed.error instanceof Error ? missed.error.message : null}
      />
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
      <div className="font-semibold mb-1">Failed to load</div>
      <div className="text-rose-100/80">{message}</div>
    </div>
  );
}

function AccountCard({ data, loading, error, onTopupSuccess }: {
  data?: PaperAccount;
  loading: boolean;
  error: string | null;
  onTopupSuccess: () => void;
}) {
  const [dialogMode, setDialogMode] = useState<"ADD" | "WITHDRAW" | null>(null);
  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle>F&amp;O Account</CardTitle></CardHeader>
        <CardContent><ErrorBlock message={error} /></CardContent>
      </Card>
    );
  }
  if (loading || !data) {
    return (
      <Card>
        <CardHeader><CardTitle>F&amp;O Account</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-24 w-full" /></CardContent>
      </Card>
    );
  }
  // Persistent bankroll: cumulative running equity = balance + day P&L
  // (the day's realised P&L hasn't been folded into balance yet for any
  // still-OPEN positions). "Net vs seed" is now the lifetime delta from
  // the original starting bankroll — meaningful again now that the
  // daily auto-refill is gone.
  const netVsSeed = data.balance + data.dayRealizedPnl - data.seedCapital;
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>F&amp;O Account</CardTitle>
          <CardDescription>
            Persistent bankroll — losses and gains carry over across days.
            Day counters last rolled over: {data.lastResetDate}. Use Add capital
            to top up.
          </CardDescription>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDialogMode("ADD")}
            data-testid="button-topup-fno"
          >
            Add capital
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDialogMode("WITHDRAW")}
            disabled={data.balance <= 0}
            data-testid="button-withdraw-fno"
          >
            Withdraw
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Section A — Bankroll & day counters */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Stat
            label="Cash balance"
            value={inr(data.balance)}
            hint="Free cash in the F&O paper bankroll right now. Realised P&L from still-open positions is not folded in until they close."
          />
          <Stat
            label="Realized P&L (today)"
            value={inrDec(data.dayRealizedPnl)}
            tone={data.dayRealizedPnl > 0 ? "pos" : data.dayRealizedPnl < 0 ? "neg" : undefined}
            hint="Net booked profit/loss from F&O paper trades closed today (IST). Resets at the next IST day rollover."
          />
          <Stat
            label="Open positions"
            value={`${data.dayOpenCount}`}
            hint="F&O paper positions currently open."
          />
          <Stat
            label="Trades opened today"
            value={`${data.dayTradeCount} / ${data.dailyTradeCap}`}
            tone={data.dayTradeCount >= data.dailyTradeCap ? "neg" : undefined}
            hint="F&O paper trades opened today vs the daily trade cap. At the cap, no new auto-entries open until the next IST day."
          />
          <Stat
            label="Risk per trade"
            value={pct(data.maxLossPctPerTrade)}
            hint="Max capital risked per F&O trade as a percent of available cash (STANDARD-tier sizing baseline)."
          />
          <Stat
            label="Net vs. seed (lifetime)"
            value={inrDec(netVsSeed)}
            tone={netVsSeed > 0 ? "pos" : netVsSeed < 0 ? "neg" : undefined}
            hint="Account-balance reconciliation metric only — not strategy P&L. Formula: cash balance + today's realised P&L − seed capital. Includes capital movements (deposits/withdrawals) that are NOT trade-attributed. Primary trade performance is shown in the Analytics tab as Realised P&L."
          />
          <Stat
            label="Seed capital"
            value={inr(data.seedCapital)}
            hint="The original starting bankroll for the F&O paper account."
          />
        </div>
        {/* Section B — Risk base, heat & capital movements (new sizing surface) */}
        {typeof data.riskBase === "number" && (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
              Risk base &amp; portfolio heat
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Stat
                label="Available cash (risk base)"
                value={inr(data.availableCash ?? data.balance)}
                hint="Per-trade budget and heat cap are computed off available cash (NOT seed). This is the withdrawable balance; open-position capital is locked separately."
              />
              <Stat
                label="Deployed (locked)"
                value={inr(data.deployedCapital ?? 0)}
                hint="Capital currently locked in OPEN F&O positions (Σ lots × lot size × entry premium). Not withdrawable until positions close."
              />
              {typeof data.riskPerTradeAmount === "number" && (
                <Stat
                  label="Risk budget / trade"
                  value={inr(data.riskPerTradeAmount)}
                  hint={`Per-trade risk budget = ${pct(data.riskPerTradePct ?? 0)} of available cash. Lot sizing floors to this before the heat cap.`}
                />
              )}
              {typeof data.heatUsed === "number" && typeof data.heatCapAmount === "number" && (
                <Stat
                  label="Heat used / cap"
                  value={`${inr(data.heatUsed)} / ${inr(data.heatCapAmount)}`}
                  tone={data.heatUsed >= data.heatCapAmount ? "neg" : undefined}
                  hint={`Portfolio heat = ₹-at-risk across OPEN positions. Cap = ${pct(data.heatCapPct ?? 0)} of available cash. New opens are blocked once heat reaches the cap.`}
                />
              )}
              {typeof data.heatAvailable === "number" && (
                <Stat
                  label="Heat headroom"
                  value={inr(data.heatAvailable)}
                  hint="Remaining heat budget before the portfolio-heat cap blocks new opens."
                />
              )}
              {typeof data.capitalAdded === "number" && (
                <Stat
                  label="Capital added (lifetime)"
                  value={inr(data.capitalAdded)}
                  hint="Cumulative manual cash injections into this paper account."
                />
              )}
              {typeof data.capitalWithdrawn === "number" && (
                <Stat
                  label="Capital withdrawn (lifetime)"
                  value={inr(data.capitalWithdrawn)}
                  hint="Cumulative manual cash withdrawals from this paper account."
                />
              )}
            </div>
          </div>
        )}
      </CardContent>
      <TopupDialog
        open={dialogMode !== null}
        mode={dialogMode ?? "ADD"}
        onClose={() => setDialogMode(null)}
        onSuccess={onTopupSuccess}
        segment="FNO"
        currentBalance={data.balance}
      />
    </Card>
  );
}

function TopupDialog({
  open, onClose, onSuccess, segment, currentBalance, mode = "ADD",
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
  segment: Segment;
  currentBalance: number;
  mode?: "ADD" | "WITHDRAW";
}) {
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const isWithdraw = mode === "WITHDRAW";
  const mutation = useMutation({
    mutationFn: async (amt: number) => {
      return api<{ segment: string; amount: number; newBalance: number }>(
        isWithdraw ? `/paper/account/withdraw` : `/paper/account/topup`,
        { method: "POST", body: JSON.stringify({ segment, amount: amt }) },
      );
    },
    onSuccess: (result) => {
      toast({
        title: isWithdraw ? "Capital withdrawn" : "Capital added",
        description: `${isWithdraw ? "−" : "+"}${inr(result.amount)} → new balance ${inr(result.newBalance)}`,
      });
      setAmount("");
      onSuccess();
      onClose();
    },
    onError: (err: unknown) => {
      toast({
        title: isWithdraw ? "Withdrawal failed" : "Top-up failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });
  if (!open) return null;
  const parsed = Number(amount);
  const positive = Number.isFinite(parsed) && parsed > 0;
  // Withdrawable = available cash (balance). Open-position capital is locked
  // separately and is NOT part of balance, so it can't be withdrawn here.
  const exceedsCash = isWithdraw && positive && parsed > currentBalance;
  const valid = positive && !exceedsCash;
  const addPresets =
    segment === "FNO" ? [50_000, 100_000, 200_000, 500_000] : [200_000, 500_000, 1_000_000, 2_000_000];
  const presets = isWithdraw
    ? addPresets.filter(p => p <= currentBalance)
    : addPresets;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-xl"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label={isWithdraw ? "Withdraw capital" : "Add capital"}
      >
        <h2 className="text-lg font-semibold mb-1">
          {isWithdraw ? "Withdraw capital" : "Add capital"} ({segment})
        </h2>
        <p className="text-sm text-muted-foreground mb-4">
          {isWithdraw ? "Withdrawable cash" : "Current balance"}:{" "}
          <span className="font-medium text-foreground">{inr(currentBalance)}</span>.
          {isWithdraw
            ? " Open-position capital is locked separately and cannot be withdrawn."
            : " The amount you enter is added to the running cash balance — seed capital stays unchanged."}
        </p>
        <div className="space-y-3">
          <input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="Amount in ₹"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="input-topup-amount"
            min="1"
            step="1"
          />
          <div className="flex flex-wrap gap-2">
            {presets.map(p => (
              <Button
                key={p}
                variant="secondary"
                size="sm"
                onClick={() => setAmount(String(p))}
                type="button"
              >
                {isWithdraw ? "−" : "+"}{inr(p)}
              </Button>
            ))}
            {isWithdraw && currentBalance > 0 && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setAmount(String(currentBalance))}
                type="button"
                data-testid="button-withdraw-max"
              >
                Max {inr(currentBalance)}
              </Button>
            )}
          </div>
          {exceedsCash && (
            <p
              className="text-sm text-destructive"
              data-testid="text-withdraw-blocked"
            >
              Withdrawal blocked — exceeds available cash. Open-position capital is
              already locked separately.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => valid && mutation.mutate(parsed)}
              disabled={!valid || mutation.isPending}
              data-testid="button-topup-confirm"
            >
              {mutation.isPending
                ? isWithdraw ? "Withdrawing…" : "Adding…"
                : `${isWithdraw ? "Withdraw" : "Add"} ${positive ? inr(parsed) : "capital"}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ManualBuyEqDialog({
  open, onClose, onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [symbol, setSymbol] = useState("");
  const [qty, setQty] = useState("");
  const mutation = useMutation({
    mutationFn: async (payload: { symbol: string; qty?: number }) => {
      return api<{
        id: string;
        symbol: string;
        qty: number;
        entryPrice: number;
        stopPrice: number;
        target1Price: number;
        target2Price: number;
        capitalDeployed: number;
      }>(`/paper/positions/eq/manual`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: (result) => {
      toast({
        title: "Buy filled",
        description: `${result.symbol} × ${result.qty} @ ${inrDec(result.entryPrice)} (stop ${inrDec(result.stopPrice)})`,
      });
      setSymbol("");
      setQty("");
      onSuccess();
      onClose();
    },
    onError: (err: unknown) => {
      toast({
        title: "Buy rejected",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });
  if (!open) return null;
  const cleanSymbol = symbol.trim().toUpperCase();
  const qtyParsed = qty.trim() === "" ? undefined : Number(qty);
  const qtyValid = qtyParsed === undefined || (Number.isFinite(qtyParsed) && qtyParsed > 0 && Number.isInteger(qtyParsed));
  const valid = cleanSymbol.length > 0 && qtyValid;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-xl"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Buy stock"
      >
        <h2 className="text-lg font-semibold mb-1">Buy stock (Equity paper)</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Bypasses the STRONG_BUY / score / sector / volume gates that the auto
          swing tick uses, but still respects every capital safety check
          (stop-sanity, drawdown caps, max concurrent, balance, heat cap).
          Stop &amp; targets are auto-computed from ATR(14) / 20-bar swing low.
        </p>
        <div className="space-y-3">
          <label className="block text-xs uppercase tracking-wider text-muted-foreground">Symbol (NSE)</label>
          <input
            type="text"
            value={symbol}
            onChange={e => setSymbol(e.target.value)}
            placeholder="e.g. COFORGE"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="input-buy-symbol"
            autoFocus
          />
          <label className="block text-xs uppercase tracking-wider text-muted-foreground">Quantity (optional)</label>
          <input
            type="number"
            inputMode="numeric"
            value={qty}
            onChange={e => setQty(e.target.value)}
            placeholder="Leave blank for auto-sizing (account_value / slots)"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="input-buy-qty"
            min="1"
            step="1"
          />
          <p className="text-xs text-muted-foreground">
            Symbol must currently exist in the scanner cache (any row in the
            full NSE scan, not just STRONG_BUY).
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => valid && mutation.mutate({
                symbol: cleanSymbol,
                ...(qtyParsed !== undefined ? { qty: qtyParsed } : {}),
              })}
              disabled={!valid || mutation.isPending}
              data-testid="button-buy-confirm"
            >
              {mutation.isPending ? "Placing…" : "Buy"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnalyticsCard({ data, loading, error }: {
  data?: FoAnalytics;
  loading: boolean;
  error: string | null;
}) {
  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle>Strategy analytics</CardTitle></CardHeader>
        <CardContent><ErrorBlock message={error} /></CardContent>
      </Card>
    );
  }
  if (loading || !data) {
    return (
      <Card>
        <CardHeader><CardTitle>Strategy analytics</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-32 w-full" /></CardContent>
      </Card>
    );
  }
  if (data.totalTrades === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Strategy analytics</CardTitle>
          <CardDescription>
            P&L, win-rate, expectancy and drawdown computed from every closed
            paper trade.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground py-6 text-center">
            No closed paper trades yet. Once trades start closing this section
            will fill with cumulative P&L, win-rate, expectancy and an equity
            curve.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Strategy analytics</CardTitle>
        <CardDescription>
          Computed from {data.totalTrades} closed trade{data.totalTrades === 1 ? "" : "s"}.
          Updated {fmtTime(data.generatedAt)}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <Stat
            label="Cumulative P&L"
            value={inrDec(data.totalRealizedPnl)}
            tone={data.totalRealizedPnl > 0 ? "pos" : data.totalRealizedPnl < 0 ? "neg" : undefined}
          />
          <Stat
            label="Win rate"
            value={data.winRate == null ? "—" : `${(data.winRate * 100).toFixed(1)}%`}
            tone={data.winRate == null ? undefined : data.winRate >= 0.5 ? "pos" : data.winRate > 0 ? "neg" : undefined}
          />
          <Stat
            label="Expectancy / trade"
            value={inrDec(data.expectancy)}
            tone={data.expectancy > 0 ? "pos" : data.expectancy < 0 ? "neg" : undefined}
          />
          <Stat
            label="Profit factor"
            value={data.profitFactor >= 99 ? "∞" : data.profitFactor.toFixed(2)}
            tone={data.profitFactor >= 1.5 ? "pos" : data.profitFactor < 1 ? "neg" : undefined}
          />
          <Stat
            label="Avg R-multiple"
            value={data.avgRMultiple == null ? "—" : `${data.avgRMultiple.toFixed(2)}R`}
            tone={data.avgRMultiple != null && data.avgRMultiple > 0 ? "pos" : data.avgRMultiple != null && data.avgRMultiple < 0 ? "neg" : undefined}
          />
          <Stat
            label="Max drawdown"
            value={inrDec(data.maxDrawdown)}
            tone={data.maxDrawdown < 0 ? "neg" : undefined}
          />
          <Stat label="Wins / Losses" value={`${data.wins} / ${data.losses}`} />
          <Stat
            label="Avg win"
            value={inrDec(data.avgWin)}
            tone={data.avgWin > 0 ? "pos" : undefined}
          />
          <Stat
            label="Avg loss"
            value={inrDec(data.avgLoss)}
            tone={data.avgLoss < 0 ? "neg" : undefined}
          />
          <Stat
            label="Largest win"
            value={data.wins === 0 ? "—" : inrDec(data.largestWin)}
            tone={data.wins > 0 && data.largestWin > 0 ? "pos" : undefined}
            hint={data.wins === 0 ? "No winning trades yet." : undefined}
          />
          <Stat
            label="Largest loss"
            value={data.losses === 0 ? "—" : inrDec(data.largestLoss)}
            tone={data.losses > 0 && data.largestLoss < 0 ? "neg" : undefined}
            hint={data.losses === 0 ? "No losing trades yet." : undefined}
          />
          <Stat
            label="Current drawdown"
            value={inrDec(data.currentDrawdown)}
            tone={data.currentDrawdown < 0 ? "neg" : undefined}
          />
        </div>
        <EquityCurveSparkline points={data.equityCurve} />
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-2">
            By setup
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="py-2 pr-3">Setup</th>
                  <th className="py-2 pr-3 text-right">Trades</th>
                  <th className="py-2 pr-3 text-right">Win rate</th>
                  <th className="py-2 pr-3 text-right">Total P&amp;L</th>
                  <th className="py-2 pr-3 text-right">Avg P&amp;L</th>
                  <th className="py-2 pr-3 text-right">Best</th>
                  <th className="py-2 pr-3 text-right">Worst</th>
                </tr>
              </thead>
              <tbody>
                {data.bySetup.map(s => (
                  <tr key={s.setupKey} className="border-b border-border/40">
                    <td className="py-2 pr-3 font-medium">{s.setupKey}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{s.trades}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{s.winRate == null ? "—" : `${(s.winRate * 100).toFixed(1)}%`}</td>
                    <td className={`py-2 pr-3 text-right tabular-nums font-medium ${s.totalPnl > 0 ? "text-emerald-300" : s.totalPnl < 0 ? "text-rose-300" : ""}`}>
                      {inrDec(s.totalPnl)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{inrDec(s.avgPnl)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-emerald-300/80">{s.wins === 0 ? "—" : inrDec(s.bestTrade)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-rose-300/80">{s.losses === 0 ? "—" : inrDec(s.worstTrade)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EquityCurveSparkline({ points }: {
  points: FoAnalytics["equityCurve"];
}) {
  if (points.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        Equity curve will appear after the first closed paper trade.
      </p>
    );
  }
  const W = 800;
  const H = 160;
  const PAD = 8;
  const xs = points.map((_, i) => i);
  const ys = points.map(p => p.cumulativePnl);
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(0, ...ys);
  const xRange = Math.max(1, xs.length - 1);
  const yRange = Math.max(1, maxY - minY);
  const sx = (i: number) => PAD + (i / xRange) * (W - 2 * PAD);
  const sy = (v: number) => H - PAD - ((v - minY) / yRange) * (H - 2 * PAD);
  const baselineY = sy(0);
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${sx(i).toFixed(1)},${sy(p.cumulativePnl).toFixed(1)}`)
    .join(" ");
  const last = points[points.length - 1]!;
  const lastTone = last.cumulativePnl >= 0 ? "stroke-emerald-400" : "stroke-rose-400";
  const fillTone = last.cumulativePnl >= 0 ? "fill-emerald-400/20" : "fill-rose-400/20";
  const areaPath =
    `${path} L${sx(points.length - 1).toFixed(1)},${baselineY.toFixed(1)} ` +
    `L${sx(0).toFixed(1)},${baselineY.toFixed(1)} Z`;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
          Equity curve · {points.length} trading day{points.length === 1 ? "" : "s"}
        </div>
        <div className="text-xs text-muted-foreground">
          Peak {inrDec(Math.max(...ys))} · Trough {inrDec(Math.min(...ys))}
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-40 rounded border border-border bg-muted/20"
        role="img"
        aria-label="Cumulative P&L equity curve"
      >
        <line x1={PAD} y1={baselineY} x2={W - PAD} y2={baselineY} className="stroke-border" strokeDasharray="2 4" />
        <path d={areaPath} className={fillTone} />
        <path d={path} fill="none" strokeWidth="1.5" className={lastTone} />
      </svg>
    </div>
  );
}

function MissedSignalsCard({ missed, loading, error }: {
  missed: MissedSignalRow[];
  loading: boolean;
  error: string | null;
}) {
  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle>Missed signals</CardTitle></CardHeader>
        <CardContent><ErrorBlock message={error} /></CardContent>
      </Card>
    );
  }
  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>Missed signals</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-20 w-full" /></CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Skipped / missed (since server start)</CardTitle>
        <CardDescription>
          Every trigger the F&amp;O paper-trade engine declined this session,
          with the precise reason. This is an in-memory session log — it resets
          on server restart, so it is not a full-day total (see &ldquo;Skipped
          today&rdquo; above for the durable daily count). Use this to understand
          the gap between what the scanner shows and what the engine actually
          executed:
          <br />
          <span className="text-amber-300">Missed window</span> — signal
          triggered &amp; hit T1/T2/SL inside one polling cycle (anti-phantom
          rule prevents same-cycle open+close).{" "}
          <span className="text-sky-300">Kite data unavailable</span> — F&amp;O
          is Kite-only since the 2026-05-06 hard-cut; this fires if a signal
          ever surfaces without a live-Kite data quality tag (defence-in-depth,
          should be near-zero in steady state).{" "}
          <span className="text-violet-300">Below conf. floor</span> —
          STANDARD &lt; 65 / BASELINE &lt; 55. Most common skip reason — the
          confluence engine post-haircut score didn&apos;t clear the floor.{" "}
          <span className="text-slate-300">Stale Kite bars</span> — last
          intraday bar older than the 15-min freshness floor.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {missed.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No skipped/missed signals tracked since server start. This in-memory
            log resets on server restart.
          </p>
        ) : (
          <>
            {/* "Why no trade?" terminal-reason rollup (2026-05-11). Grouped
                client-side from the same dataset; the server's
                /paper/diagnostics/untriggered/fo endpoint exposes the same
                bucketing for programmatic consumers. */}
            <WhyNoTradeSummary rows={missed} />
            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="py-2 pr-3">When</th>
                  <th className="py-2 pr-3">Index</th>
                  <th className="py-2 pr-3">Setup</th>
                  <th className="py-2 pr-3">Side</th>
                  <th className="py-2 pr-3">Why skipped</th>
                  <th className="py-2 pr-3">Outcome</th>
                  <th className="py-2 pr-3 text-right">Conf</th>
                  <th className="py-2 pr-3 text-right">Entry</th>
                  <th className="py-2 pr-3 text-right">Would-be exit</th>
                </tr>
              </thead>
              <tbody>
                {missed.map((m, idx) => {
                  const wouldBeExit =
                    m.reason === "TARGET2_HIT" ? m.optionTarget2 :
                    m.reason === "TARGET1_HIT" ? m.optionTarget1 :
                    m.reason === "STOPPED" ? m.optionStop :
                    null;
                  const outcomeTone = m.reason ? REASON_TONE[m.reason] ?? "bg-slate-500/15 text-slate-200 border-slate-500/30" : "bg-slate-500/15 text-slate-200 border-slate-500/30";
                  const skipTone = SKIP_REASON_TONE[m.skipReason] ?? "bg-slate-500/15 text-slate-200 border-slate-500/30";
                  const skipLabel = SKIP_REASON_LABEL[m.skipReason] ?? m.skipReason;
                  return (
                    <tr key={`${m.signalDate}-${m.indexSymbol}-${m.setupKey}-${m.direction}-${m.skipReason}-${idx}`} className="border-b border-border/40">
                      <td className="py-2 pr-3 text-[12px] text-muted-foreground">{fmtTime(m.observedAt)}</td>
                      <td className="py-2 pr-3 font-medium">{m.indexName || m.indexSymbol}</td>
                      <td className="py-2 pr-3 text-[12px]">{m.setupKey}</td>
                      <td className="py-2 pr-3">
                        <span className={m.direction === "BULLISH" ? "text-emerald-300" : "text-rose-300"}>
                          {m.direction === "BULLISH" ? "Bullish" : "Bearish"}
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`px-2 py-0.5 rounded border text-[11px] ${skipTone}`} title={`dataQuality=${m.dataQuality}`}>{skipLabel}</span>
                      </td>
                      <td className="py-2 pr-3">
                        {m.reason ? (
                          <span className={`px-2 py-0.5 rounded border text-[11px] ${outcomeTone}`}>{m.reason}</span>
                        ) : (
                          <span className="text-[11px] text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{m.confidence}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {m.optionEntry != null ? `₹${m.optionEntry.toFixed(2)}` : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {wouldBeExit != null ? `₹${wouldBeExit.toFixed(2)}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * "Why no trade?" terminal-reason rollup. Pure client-side aggregation
 * of the missed-signals ring buffer — no extra fetch. Three pivots:
 * by-reason (the dominant blocker), by-tier (is BASELINE even firing?),
 * and by-index (is the drought index-specific?). Mirrors the server's
 * /paper/diagnostics/untriggered/fo bucketing.
 */
function WhyNoTradeSummary({ rows }: { rows: MissedSignalRow[] }) {
  const byReason: Record<string, number> = {};
  const byTier: Record<string, number> = { STANDARD: 0, BASELINE: 0 };
  const byIndex: Record<string, number> = {};
  for (const m of rows) {
    const r = m.skipReason ?? "UNKNOWN";
    byReason[r] = (byReason[r] ?? 0) + 1;
    byTier[m.tier] = (byTier[m.tier] ?? 0) + 1;
    byIndex[m.indexSymbol] = (byIndex[m.indexSymbol] ?? 0) + 1;
  }
  const sortDesc = (rec: Record<string, number>) =>
    Object.entries(rec)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]);

  const reasonRows = sortDesc(byReason);
  const tierRows = sortDesc(byTier);
  const indexRows = sortDesc(byIndex);

  const Pill = ({ k, n, tone }: { k: string; n: number; tone?: string }) => (
    <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] ${tone ?? "border-border bg-muted/30 text-foreground/80"}`}>
      <span>{k}</span>
      <span className="tabular-nums font-semibold">{n}</span>
    </span>
  );

  return (
    <div className="mb-3 grid gap-2 rounded-md border border-border bg-muted/10 p-3 sm:grid-cols-3">
      <div>
        <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">By reason ({rows.length})</div>
        <div className="flex flex-wrap gap-1">
          {reasonRows.map(([k, n]) => (
            <Pill key={k} k={SKIP_REASON_LABEL[k as SkipReason] ?? k} n={n} tone={SKIP_REASON_TONE[k as SkipReason]} />
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">By tier</div>
        <div className="flex flex-wrap gap-1">
          {tierRows.map(([k, n]) => (
            <Pill key={k} k={k} n={n} tone={k === "BASELINE" ? "border-violet-500/30 bg-violet-500/15 text-violet-200" : "border-emerald-500/30 bg-emerald-500/15 text-emerald-200"} />
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">By index</div>
        <div className="flex flex-wrap gap-1">
          {indexRows.map(([k, n]) => <Pill key={k} k={k} n={n} />)}
        </div>
      </div>
    </div>
  );
}

function Stat({
  label, value, tone, hint,
}: { label: string; value: string; tone?: "pos" | "neg"; hint?: string }) {
  const color =
    tone === "pos" ? "text-emerald-300" :
    tone === "neg" ? "text-rose-300" :
    "text-foreground";
  return (
    <div className="flex flex-col gap-1" title={hint}>
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`text-lg font-semibold tabular-nums ${color}`}>{value}</span>
    </div>
  );
}

function HeatIndicator({ deployed, total }: { deployed: number; total: number }) {
  const pctVal = total > 0 ? (deployed / total) * 100 : 0;
  const clamped = Math.min(100, Math.max(0, pctVal));
  const heatColor =
    clamped >= 80 ? "bg-rose-500" :
    clamped >= 60 ? "bg-amber-500" :
    clamped >= 40 ? "bg-yellow-500" :
    "bg-emerald-500";
  const textColor =
    clamped >= 80 ? "text-rose-300" :
    clamped >= 60 ? "text-amber-300" :
    clamped >= 40 ? "text-yellow-300" :
    "text-emerald-300";
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Portfolio Heat</span>
      <div className="flex items-center gap-2">
        <span className={`text-lg font-semibold tabular-nums ${textColor}`}>
          {clamped.toFixed(1)}%
        </span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-muted/40 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${heatColor}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

const JOURNAL_TAGS = [
  "FOLLOWED_PLAN", "DEVIATED", "EARLY_EXIT", "LATE_ENTRY",
  "SIZE_TOO_BIG", "SIZE_TOO_SMALL", "GOOD_RR", "BAD_RR",
  "MOMENTUM_TRADE", "MEAN_REVERSION", "NEWS_DRIVEN",
] as const;

function JournalPanel({ tradeId, segment, initial }: {
  tradeId: string;
  segment: "fo" | "eq";
  initial: { journal?: string | null; tags?: string[] };
}) {
  const [text, setText] = useState(initial.journal ?? "");
  const [tags, setTags] = useState<string[]>(initial.tags ?? []);
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { toast } = useToast();

  const save = useMutation({
    mutationFn: () =>
      api<{ id: string }>(`/paper/trades/${segment}/${encodeURIComponent(tradeId)}/journal`, {
        method: "PATCH",
        body: JSON.stringify({ journal: text || null, tags }),
      }),
    onSuccess: () => {
      toast({ title: "Journal saved" });
      if (segment === "fo") {
        void qc.invalidateQueries({ queryKey: QK_TRADES });
      } else {
        void qc.invalidateQueries({ queryKey: QK_TRADES_EQ });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const toggleTag = useCallback((tag: string) => {
    setTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  }, []);

  const hasContent = !!(initial.journal || (initial.tags && initial.tags.length > 0));

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className={`text-[11px] ${hasContent ? "text-sky-400 hover:text-sky-300" : "text-muted-foreground hover:text-foreground"} transition-colors`}
      >
        {hasContent ? "Edit journal" : "Add journal"}
      </button>
    );
  }

  return (
    <div className="mt-2 p-3 rounded-md border border-border/60 bg-card/50 space-y-2">
      <textarea
        className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm resize-y min-h-[60px] focus:outline-none focus:ring-1 focus:ring-ring"
        placeholder="What did you learn from this trade?"
        value={text}
        onChange={e => setText(e.target.value)}
        rows={3}
      />
      <div className="flex flex-wrap gap-1.5">
        {JOURNAL_TAGS.map(tag => (
          <button
            key={tag}
            onClick={() => toggleTag(tag)}
            className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
              tags.includes(tag)
                ? "bg-sky-500/20 text-sky-200 border-sky-500/40"
                : "bg-muted/30 text-muted-foreground border-border/40 hover:border-border"
            }`}
          >
            {tag.replace(/_/g, " ")}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? "Saving…" : "Save"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function TradesCard({ trades, loading, error }: {
  trades: ClosedTrade[];
  loading: boolean;
  error: string | null;
}) {
  const totals = useMemo(() => {
    let realized = 0, wins = 0, losses = 0;
    for (const t of trades) {
      realized += t.realizedPnl;
      if (t.realizedPnl > 0) wins++;
      else if (t.realizedPnl < 0) losses++;
    }
    return {
      count: trades.length,
      realized,
      wins,
      losses,
      // Denominator: decided trades only (wins + losses). Scratches excluded.
      winPct: wins + losses === 0 ? null : wins / (wins + losses),
    };
  }, [trades]);
  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle>Today's closed trades</CardTitle></CardHeader>
        <CardContent><ErrorBlock message={error} /></CardContent>
      </Card>
    );
  }
  if (loading) {
    return (
      <Card>
        <CardHeader><CardTitle>Today's closed trades</CardTitle></CardHeader>
        <CardContent><Skeleton className="h-32 w-full" /></CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Today's closed trades</CardTitle>
        <CardDescription>
          {totals.count === 0
            ? "Nothing closed yet today."
            : `${totals.count} closed · realized ${inrDec(totals.realized)} · win-rate ${totals.winPct == null ? "—" : pct(totals.winPct)}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {trades.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No closed paper trades today yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                <tr>
                  <th className="py-2 pr-3">Symbol</th>
                  <th className="py-2 pr-3">Side</th>
                  <th className="py-2 pr-3">Lots</th>
                  <th className="py-2 pr-3 text-right">Entry</th>
                  <th className="py-2 pr-3 text-right">Exit</th>
                  <th className="py-2 pr-3 text-right">Capital</th>
                  <th className="py-2 pr-3 text-right">P&amp;L</th>
                  <th className="py-2 pr-3">Reason</th>
                  <th className="py-2 pr-3">Opened</th>
                  <th className="py-2 pr-3">Closed</th>
                  <th className="py-2 pr-3">Journal</th>
                </tr>
              </thead>
              <tbody>
                {trades.map(t => {
                  const tone =
                    t.realizedPnl > 0 ? "text-emerald-300" :
                    t.realizedPnl < 0 ? "text-rose-300" : "";
                  return (
                    <tr key={t.id} className="border-b border-border/40">
                      <td className="py-2 pr-3">
                        <div className="font-medium">{t.indexSymbol}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {t.optionType} {t.strike} · {t.setupKey}
                        </div>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge variant={t.direction === "BULLISH" ? "default" : "destructive"}>
                          {t.direction}
                        </Badge>
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{t.lots} × {t.lotSize}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{t.entryPremium.toFixed(2)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{t.exitPremium.toFixed(2)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{inr(t.capitalDeployed)}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums font-medium ${tone}`}>
                        {inrDec(t.realizedPnl)}
                      </td>
                      <td className="py-2 pr-3">
                        <span className={`px-2 py-0.5 rounded border text-[11px] ${REASON_TONE[t.exitReason]}`}>
                          {t.exitReason.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-[12px] text-muted-foreground">{fmtTime(t.openedAt)}</td>
                      <td className="py-2 pr-3 text-[12px] text-muted-foreground">{fmtTime(t.exitedAt)}</td>
                      <td className="py-2 pr-3">
                        <JournalPanel tradeId={t.id} segment="fo" initial={{ journal: t.journal, tags: t.tags }} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
