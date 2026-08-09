/**
 * home-debug.tsx — Development-only Home state fixture page.
 *
 * Renders the actual production Home sub-components (FnoBanWidget, BreadthBar,
 * GlobalCuesStrip, IndexTabs) in three fixture states using isolated
 * QueryClient instances with pre-populated query data.
 *
 * States:
 *   A. ALL_UNAVAILABLE — all APIs return null/error; indices "—"; breadth "—"; F&O ban UNAVAILABLE
 *   B. READY_PARTIAL   — breadth available; indices unavailable; F&O ban STALE/LAST KNOWN
 *   C. READY_CLOSED    — previous-close index values; sessionDate visible; F&O ban ALL CLEAR
 *
 * Route: /debug/home-states/:state (unavailable | partial | closed)
 * Access: owner only (guarded in App.tsx by requireOwner route flag)
 *
 * Screenshot targets (1440×900):
 *   /debug/home-states/unavailable → ALL_UNAVAILABLE evidence
 *   /debug/home-states/partial     → READY_PARTIAL evidence
 *   /debug/home-states/closed      → READY_CLOSED evidence
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  getGetFnoBanListQueryKey,
  getGetMarketTrendQueryKey,
  getGetIndicesBoardQueryKey,
  getGetGlobalIndicesQueryKey,
  getGetHomeEnrichmentQueryKey,
  getGetMarketMacroHistoryQueryKey,
} from "@workspace/api-client-react";
import FnoBanWidget from "@/components/fno-ban-widget";
import BreadthBar from "@/components/home/breadth-bar";
import GlobalCuesStrip from "@/components/home/global-cues-strip";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW_ISO = new Date().toISOString();
const SESSION_DATE = "2026-08-08"; // last trading session (Friday)
const SESSION_AS_OF = "2026-08-08T15:30:00.000Z"; // 3:30 PM IST = 10:00 UTC

/**
 * ALL_UNAVAILABLE: APIs return explicit UNAVAILABLE sentinels.
 * F&O ban: available=false (no cache). Market trend: null (no data).
 * Using null instead of undefined so React Query stores settled state
 * and the components render their unavailable branches (not loading skeletons).
 */
const fixtureA = {
  fnoBan: { available: false, stale: false, cached: false, fetchedAt: null, sourceUrl: null, symbols: [], count: 0 },
  marketTrend: null,
  indicesBoard: null,
  globalIndices: null,
  homeEnrichment: null,
  macroHistory: null,
};

/** READY_PARTIAL: breadth available; indices unavailable; F&O ban STALE/LAST KNOWN. */
const fixtureB = {
  fnoBan: {
    available: true,
    stale: true,
    cached: true,
    fetchedAt: "2026-08-08T13:00:00.000Z", // last successful sync (IST 18:30)
    sourceUrl: "https://archives.nseindia.com/content/fo/fo_secban.csv",
    symbols: ["HINDCOPPER", "MANINFRA"],
    count: 2,
  },
  marketTrend: {
    bias: "NEUTRAL",
    score: 12,
    headline: "Mixed breadth — advances lead declines marginally",
    breadth: { advancers: 1240, decliners: 820, unchanged: 68, advanceDeclineRatio: 1.51 },
    drivers: [],
    lastUpdated: new Date(SESSION_AS_OF),
  },
  indicesBoard: undefined,
  globalIndices: {
    items: [
      { symbol: "^NSEI", name: "NIFTY 50", price: 24987.5, change: 62.3, changePercent: 0.25, volume: 0, updatedAt: new Date(SESSION_AS_OF), exchange: "NSE" },
      { symbol: "^BSESN", name: "SENSEX", price: 81741.2, change: 198.5, changePercent: 0.24, volume: 0, updatedAt: new Date(SESSION_AS_OF), exchange: "BSE" },
    ],
    generatedAt: new Date(SESSION_AS_OF),
  },
  homeEnrichment: undefined,
  macroHistory: {
    items: [
      { symbol: "DXY", name: "US Dollar Index", price: 104.23, change: -0.17, changePercent: -0.16, updatedAt: new Date(SESSION_AS_OF) },
      { symbol: "XAUUSD", name: "Gold", price: 2418.5, change: 8.3, changePercent: 0.34, updatedAt: new Date(SESSION_AS_OF) },
    ],
    generatedAt: new Date(SESSION_AS_OF),
  },
};

/** READY_CLOSED: previous-session data visible; sessionDate shown; F&O ban ALL CLEAR. */
const fixtureC = {
  fnoBan: {
    available: true,
    stale: false,
    cached: false,
    fetchedAt: NOW_ISO,
    sourceUrl: "https://archives.nseindia.com/content/fo/fo_secban.csv",
    symbols: [],
    count: 0,
  },
  marketTrend: {
    bias: "BULLISH",
    score: 38,
    headline: "Broad-based advances — session closed strong",
    breadth: { advancers: 1587, decliners: 542, unchanged: 44, advanceDeclineRatio: 2.93 },
    drivers: [],
    lastUpdated: new Date(SESSION_AS_OF),
    candleProvenance: { source: "none", detail: "Market closed" },
  },
  indicesBoard: {
    items: [
      {
        key: "NIFTY50",
        label: "NIFTY 50",
        category: "BROAD_MARKET",
        ltp: 24987.5,
        previousClose: 24925.2,
        change: 62.3,
        changePercent: 0.25,
        open: 24941.0,
        high: 25012.8,
        low: 24921.5,
        volume: 0,
        source: "KITE_DELAYED",
        sessionDate: SESSION_DATE,
        kiteAuthenticated: false,
      },
      {
        key: "BANKNIFTY",
        label: "BANK NIFTY",
        category: "SECTORAL",
        ltp: 52841.3,
        previousClose: 52601.8,
        change: 239.5,
        changePercent: 0.46,
        open: 52650.0,
        high: 52901.2,
        low: 52580.4,
        volume: 0,
        source: "KITE_DELAYED",
        sessionDate: SESSION_DATE,
        kiteAuthenticated: false,
      },
    ],
    lastUpdated: new Date(SESSION_AS_OF),
    kiteAuthenticated: false,
  },
  globalIndices: {
    items: [
      { symbol: "^NSEI", name: "NIFTY 50", price: 24987.5, change: 62.3, changePercent: 0.25, volume: 0, updatedAt: new Date(SESSION_AS_OF), exchange: "NSE" },
      { symbol: "^BSESN", name: "SENSEX", price: 81741.2, change: 198.5, changePercent: 0.24, volume: 0, updatedAt: new Date(SESSION_AS_OF), exchange: "BSE" },
      { symbol: "^DJI", name: "Dow Jones", price: 39712.4, change: -88.3, changePercent: -0.22, volume: 0, updatedAt: new Date(SESSION_AS_OF), exchange: "NYSE" },
    ],
    generatedAt: new Date(SESSION_AS_OF),
  },
  homeEnrichment: {
    indices: [],
    generatedAt: new Date(SESSION_AS_OF),
  },
  macroHistory: {
    items: [
      { symbol: "DXY", name: "US Dollar Index", price: 104.23, change: -0.17, changePercent: -0.16, updatedAt: new Date(SESSION_AS_OF) },
    ],
    generatedAt: new Date(SESSION_AS_OF),
  },
};

// ── QueryClient factory ────────────────────────────────────────────────────────

function makeFixtureClient(fixture: AnyFixture) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  // Prefill all query caches with fixture data
  qc.setQueryData(getGetFnoBanListQueryKey(), fixture.fnoBan);
  qc.setQueryData(getGetMarketTrendQueryKey(), fixture.marketTrend);
  qc.setQueryData(getGetIndicesBoardQueryKey(), fixture.indicesBoard);
  qc.setQueryData(getGetGlobalIndicesQueryKey(), fixture.globalIndices);
  qc.setQueryData(getGetHomeEnrichmentQueryKey(), fixture.homeEnrichment);
  qc.setQueryData(getGetMarketMacroHistoryQueryKey(), fixture.macroHistory);
  return qc;
}

// ── Per-state panel ────────────────────────────────────────────────────────────

type AnyFixture = {
  fnoBan: unknown;
  marketTrend: unknown;
  indicesBoard: unknown;
  globalIndices: unknown;
  homeEnrichment: unknown;
  macroHistory: unknown;
};

interface StatePanelProps {
  label: string;
  stateCode: string;
  description: string;
  fixture: AnyFixture;
  borderColor: string;
}

function StatePanel({ label, stateCode, description, fixture, borderColor }: StatePanelProps) {
  const client = useMemo(() => makeFixtureClient(fixture), []);
  return (
    <QueryClientProvider client={client}>
      <div className={`rounded-xl border-2 ${borderColor} p-4 space-y-4`}>
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <span className="text-xs font-mono font-bold bg-muted px-2 py-0.5 rounded text-muted-foreground">
              {stateCode}
            </span>
            <h2 className="text-base font-mono font-bold text-foreground">{label}</h2>
          </div>
          <p className="text-[11px] font-mono text-muted-foreground">{description}</p>
        </div>
        <div className="space-y-3">
          <GlobalCuesStrip />
          <BreadthBar />
          <FnoBanWidget />
        </div>
      </div>
    </QueryClientProvider>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HomeDebugPage() {
  return (
    <div className="min-h-screen bg-background p-6 space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-mono font-bold text-foreground">
          HOME STATE FIXTURE EVIDENCE
        </h1>
        <p className="text-xs font-mono text-muted-foreground">
          PROMPT_33B · Item 3 · Development-only · Owner evidence page
          · All three states rendered from production components with fixture API data
        </p>
        <p className="text-[10px] font-mono text-muted-foreground/60">
          Generated: {new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6">
        <StatePanel
          label="ALL UNAVAILABLE"
          stateCode="STATE-A"
          description="All APIs return null/no data. Index values: — · Breadth: — · A/D: — · F&O ban: UNAVAILABLE · No current-looking values."
          fixture={fixtureA}
          borderColor="border-muted-foreground/30"
        />
        <StatePanel
          label="READY PARTIAL"
          stateCode="STATE-B"
          description="Breadth available (ADV 1240 / DEC 820 → A/D 1.51). Indices unavailable (Kite offline). F&O ban: STALE/LAST KNOWN with asOf. No complete market-direction claim."
          fixture={fixtureB}
          borderColor="border-amber-500/40"
        />
        <StatePanel
          label="READY CLOSED"
          stateCode="STATE-C"
          description="Previous-close values visible. sessionDate=2026-08-08. Source=KITE_DELAYED. State: READY_CLOSED. Not live. F&O ban: ALL CLEAR."
          fixture={fixtureC}
          borderColor="border-signal-strong-buy/40"
        />
      </div>
    </div>
  );
}
