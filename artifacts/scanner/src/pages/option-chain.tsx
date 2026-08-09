import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import {
  useGetOptionChain,
  useGetOptionAnalytics,
  useGetFnoBanList,
  getGetOptionChainQueryKey,
  getGetOptionAnalyticsQueryKey,
  getGetFnoBanListQueryKey,
  type OptionChainStrikeRow,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Activity, Target, Search, ChevronDown, ChevronUp, ArrowUp, ArrowDown, Radio, Shield, AlertTriangle, ChevronRight, Info, Filter, Database } from "lucide-react";
import { DataSourceBadge } from "@/components/ui/data-source-badge";
import { formatDistanceToNow } from "date-fns";
import {
  FNO_ALL,
  QUICK_PRESETS,
  groupBySector,
  findFno,
  type FnoEntry,
} from "@/data/fnoUniverse";

import { applyStrikeFilter, type StrikeFilter } from "@/lib/optionChainFilters";
import { UnifiedGradeChip } from "@/components/ui/unified-grade-chip";

function fmt(n: number | null | undefined, dp = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function fmtInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-IN");
}
function fmtKL(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e7) return `${(n / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${(n / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  // Defensive: small non-K values must still render as clean integers so any
  // upstream float noise (e.g. "268.6000000000006") never reaches the user.
  return `${Math.round(n)}`;
}
/** Signed percentage with explicit "+" for positive values. Renders "—" for
 *  null/undefined so a missing baseline (e.g. NSE-direct path has no per-leg
 *  prev close) never shows as a fake "0.00%". */
function fmtPct(n: number | null | undefined, dp = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(dp)}%`;
}
/** Vol/OI ratio: 3 dp; null-safe. */
function fmtRatio(n: number | null | undefined, dp = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(dp);
}
function buildupTone(b: string | undefined): string {
  switch (b) {
    case "LONG_BUILDUP":   return "bg-signal-strong-buy/20 text-signal-strong-buy";
    case "SHORT_COVERING": return "bg-signal-buy/15 text-signal-buy";
    case "SHORT_BUILDUP":  return "bg-signal-strong-sell/20 text-signal-strong-sell";
    case "LONG_UNWINDING": return "bg-signal-sell/15 text-signal-sell";
    default:               return "bg-secondary/40 text-muted-foreground";
  }
}
function buildupShort(b: string | undefined): string {
  switch (b) {
    case "LONG_BUILDUP":   return "LB";
    case "SHORT_COVERING": return "SC";
    case "SHORT_BUILDUP":  return "SB";
    case "LONG_UNWINDING": return "LU";
    default:               return "—";
  }
}
function fmtGreek(n: number | null | undefined, dp = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(dp);
}

/**
 * Renders an inline warning when the underlying is on NSE's F&O ban list
 * (MWPL breached → fresh F&O positions are blocked, square-off only).
 * The warning is critical to surface here because traders open the option
 * chain specifically to evaluate fresh entries — that decision changes
 * entirely if the symbol is banned.
 *
 * Indices (NIFTY/BANKNIFTY/etc.) can never be banned, but the API will
 * simply not contain them in the list, so a single membership check works
 * for all underlyings without special-casing.
 */
function FnoBanBanner({ underlying }: { underlying: string }) {
  const { data, isLoading } = useGetFnoBanList({
    query: {
      refetchInterval: 15 * 60 * 1000,
      refetchIntervalInBackground: false,
      queryKey: getGetFnoBanListQueryKey(),
      staleTime: 5 * 60 * 1000,
    },
  });
  // While the very first request is in flight there's nothing useful to
  // say — the data may arrive in <1s. Suppressing during loading avoids
  // a flicker between three banner states on every chain switch.
  if (isLoading || !data) return null;

  // Indices (NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, NIFTYNXT50…) are
  // never restricted by the F&O ban mechanism, so neither the "banned"
  // nor the "status unknown" notice is meaningful for them.
  const u = underlying.toUpperCase();
  const isIndex = /^(NIFTY|BANKNIFTY|FINNIFTY|MIDCPNIFTY|NIFTYNXT50|BANKEX|SENSEX)$/.test(u);
  if (isIndex) return null;

  // Upstream NSE archive is unreachable. We must not silently say
  // "no ban" because we genuinely do not know — surface that fact.
  // Also treat LAST_KNOWN_STALE as unknown — stale data cannot authorize ban decisions.
  if (!data || data.status === "UNAVAILABLE" || !data.canAuthorizeAdmission) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div className="text-[11px] font-mono text-amber-200/90 leading-relaxed">
          <span className="font-bold uppercase tracking-wider text-amber-400">Ban status unavailable</span>
          {" — "}NSE archive unreachable; cannot verify whether {u} is restricted right now. Treat with caution and check your broker terminal before placing fresh F&amp;O positions.
        </div>
      </div>
    );
  }

  // Only check ban status when canAuthorizeAdmission=true (CURRENT state).
  const banned = data.canAuthorizeAdmission && data.symbols.includes(u);
  if (!banned) return null;
  return (
    <div className="rounded-md border-2 border-signal-strong-sell bg-signal-strong-sell/10 px-4 py-3 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-signal-strong-sell shrink-0 mt-0.5" />
      <div className="text-xs font-mono">
        <div className="font-bold uppercase tracking-wider text-signal-strong-sell mb-1">
          {u} is on the F&amp;O ban list
        </div>
        <div className="text-foreground/80 leading-relaxed">
          Market-Wide Position Limit breached. Fresh F&amp;O positions are
          <span className="font-bold text-signal-strong-sell"> blocked </span>
          by the exchange — only square-off / reduction trades are allowed
          until the breach is cured. Opening a new position will incur a
          penalty.
        </div>
      </div>
    </div>
  );
}

export default function OptionChainPage() {
  const params = useParams<{ underlying?: string }>();
  const [, setLocation] = useLocation();
  const underlying = (params.underlying ?? "NIFTY").toUpperCase();
  const [expiry, setExpiry] = useState<string | undefined>(undefined);

  // Reset expiry when underlying changes so we re-fetch the nearest one
  useEffect(() => { setExpiry(undefined); }, [underlying]);

  const chainParams = expiry ? { expiry } : undefined;

  // ── Adaptive live cadence ─────────────────────────────────────────
  // The market status comes from the *server* (`analytics.marketStatus`)
  // so cadence selection is holiday-aware via NSE's published holiday
  // list — a client-only weekday/clock check would falsely flip to OPEN
  // on Diwali/Holi/etc. We default to the conservative 60s cadence
  // until the first analytics response arrives, then re-poll at 15s
  // whenever the server reports OPEN. React Query picks up
  // `refetchInterval` changes on the next scheduled tick, so this
  // converges within at most one poll cycle.
  const analyticsQ = useGetOptionAnalytics(
    underlying,
    chainParams,
    { query: {
        // Refetch interval is read from the *previous* analytics response
        // so it tracks the server's holiday-aware status without ever
        // disagreeing with it. `query.data` is `undefined` on first load
        // → we conservatively poll at 60s until we know better.
        refetchInterval: (query) => (query.state.data?.marketStatus === "open" ? 15_000 : 60_000),
        refetchIntervalInBackground: false,
        retry: 0,
        queryKey: getGetOptionAnalyticsQueryKey(underlying, chainParams),
      } },
  );
  const analytics = analyticsQ.data;
  const marketStatus = analytics?.marketStatus ?? null;
  const refetchInterval = marketStatus === "open" ? 15_000 : 60_000;

  const chainQ = useGetOptionChain(
    underlying,
    chainParams,
    { query: {
        refetchInterval,
        // Pause polling while the user has switched to another browser tab so
        // we're not burning Kite quota and CPU on a hidden chart.
        refetchIntervalInBackground: false,
        retry: 0,
        queryKey: getGetOptionChainQueryKey(underlying, chainParams),
      } },
  );

  // Last successful fetch timestamp (for the "updated Ns ago" pulse).
  // We tick a 1 s clock only while the page is mounted; React Query's
  // own `dataUpdatedAt` is the source of truth.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(t => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const chain = chainQ.data;
  const [showGreeks, setShowGreeks] = useState(false);
  const [strikeFilter, setStrikeFilter] = useState<StrikeFilter>("atm10");
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [marketReadOpen, setMarketReadOpen] = useState(true);

  // ── "Jump to ATM" floating button ─────────────────────────────────
  // The chain table has 30+ strikes and the scroll container is clamped to
  // ~70vh, so the ATM row often sits well off-screen — especially on long
  // chains with deep ITM/OTM coverage. Track whether the ATM row is
  // currently visible inside the scroll container, and offer a one-click
  // jump back when it's drifted out of view.
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const [atmDirection, setAtmDirection] = useState<"above" | "below" | "visible">("visible");

  const checkAtmVisibility = useCallback(() => {
    const scroller = tableScrollRef.current;
    if (!scroller) return;
    const atmRow = scroller.querySelector<HTMLTableRowElement>('tr[data-atm-row="true"]');
    if (!atmRow) { setAtmDirection("visible"); return; }
    const sRect = scroller.getBoundingClientRect();
    const rRect = atmRow.getBoundingClientRect();
    // The thead is `position: sticky` so the top portion of the scroll
    // container is permanently obscured by the frozen header. Treat that
    // strip as "not really visible" so we don't claim the ATM row is in
    // view when it's actually hiding behind the header.
    const headerH = scroller.querySelector<HTMLTableSectionElement>("thead")?.getBoundingClientRect().height ?? 0;
    const visibleTop = sRect.top + headerH;
    const visibleBottom = sRect.bottom;
    if (rRect.bottom <= visibleTop) setAtmDirection("above");
    else if (rRect.top >= visibleBottom) setAtmDirection("below");
    else setAtmDirection("visible");
  }, []);

  // Re-check on scroll (rAF-throttled implicitly by browser scroll events),
  // on resize, and whenever the chain data changes (rebuilds the row set).
  useEffect(() => {
    const scroller = tableScrollRef.current;
    if (!scroller) return;
    scroller.addEventListener("scroll", checkAtmVisibility, { passive: true });
    window.addEventListener("resize", checkAtmVisibility);
    checkAtmVisibility();
    return () => {
      scroller.removeEventListener("scroll", checkAtmVisibility);
      window.removeEventListener("resize", checkAtmVisibility);
    };
  }, [checkAtmVisibility, chain]);

  const scrollToAtm = useCallback(() => {
    const scroller = tableScrollRef.current;
    if (!scroller) return;
    const atmRow = scroller.querySelector<HTMLTableRowElement>('tr[data-atm-row="true"]');
    if (!atmRow) return;
    const headerH = scroller.querySelector<HTMLTableSectionElement>("thead")?.getBoundingClientRect().height ?? 0;
    // Center the ATM row in the visible area BELOW the sticky header.
    const target = atmRow.offsetTop - headerH - (scroller.clientHeight - headerH - atmRow.offsetHeight) / 2;
    scroller.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }, []);

  const maxOi = useMemo(() => {
    if (!chain) return 0;
    let m = 0;
    for (const r of chain.rows) {
      if (r.ce?.oi && r.ce.oi > m) m = r.ce.oi;
      if (r.pe?.oi && r.pe.oi > m) m = r.pe.oi;
    }
    return m;
  }, [chain]);

  // ── R1/R2/R3 (call writing = resistance) and S1/S2/S3 (put writing =
  //    support) tier maps. Built off the analytics endpoint's already-
  //    sorted top-OI clusters so the ranking on the page matches the
  //    bias card and updates automatically every refetch — i.e. as
  //    writers add or unwind during the session, R1/S1 will drift
  //    along with them. Keyed by strike → tier label for O(1) row
  //    lookups inside the table render. */
  const resistanceTiers = useMemo(() => {
    const m = new Map<number, "R1" | "R2" | "R3">();
    const top = analytics?.topResistance?.slice(0, 3) ?? [];
    top.forEach((c, i) => {
      const tier = (["R1", "R2", "R3"] as const)[i];
      if (tier) m.set(c.strike, tier);
    });
    return m;
  }, [analytics]);
  const supportTiers = useMemo(() => {
    const m = new Map<number, "S1" | "S2" | "S3">();
    const top = analytics?.topSupport?.slice(0, 3) ?? [];
    top.forEach((c, i) => {
      const tier = (["S1", "S2", "S3"] as const)[i];
      if (tier) m.set(c.strike, tier);
    });
    return m;
  }, [analytics]);

  const filteredRows = useMemo(() => {
    if (!chain) return [];
    return applyStrikeFilter({
      rows: chain.rows,
      filter: strikeFilter,
      atmStrike: chain.atmStrike,
      maxOi,
    });
  }, [chain, strikeFilter, maxOi]);

  const sortedRows = useMemo(() => {
    if (!sortCol || !filteredRows.length) return filteredRows;
    const sorted = [...filteredRows];
    sorted.sort((a, b) => {
      let va = 0, vb = 0;
      switch (sortCol) {
        case "ce_oi": va = a.ce?.oi ?? 0; vb = b.ce?.oi ?? 0; break;
        case "ce_chgOi": va = a.ce?.chgOi ?? 0; vb = b.ce?.chgOi ?? 0; break;
        case "ce_vol": va = a.ce?.volume ?? 0; vb = b.ce?.volume ?? 0; break;
        case "ce_iv": va = a.ce?.iv ?? 0; vb = b.ce?.iv ?? 0; break;
        case "ce_ltp": va = a.ce?.ltp ?? 0; vb = b.ce?.ltp ?? 0; break;
        case "pe_oi": va = a.pe?.oi ?? 0; vb = b.pe?.oi ?? 0; break;
        case "pe_chgOi": va = a.pe?.chgOi ?? 0; vb = b.pe?.chgOi ?? 0; break;
        case "pe_vol": va = a.pe?.volume ?? 0; vb = b.pe?.volume ?? 0; break;
        case "pe_iv": va = a.pe?.iv ?? 0; vb = b.pe?.iv ?? 0; break;
        case "pe_ltp": va = a.pe?.ltp ?? 0; vb = b.pe?.ltp ?? 0; break;
        case "strike": va = a.strike; vb = b.strike; break;
        default: return 0;
      }
      return sortDir === "asc" ? va - vb : vb - va;
    });
    return sorted;
  }, [filteredRows, sortCol, sortDir]);

  const handleSort = useCallback((col: string) => {
    if (sortCol === col) {
      if (sortDir === "desc") setSortDir("asc");
      else { setSortCol(null); setSortDir("desc"); }
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  }, [sortCol, sortDir]);

  const lastUpdate = chainQ.dataUpdatedAt;
  const secondsSinceUpdate = lastUpdate ? Math.max(0, Math.floor((Date.now() - lastUpdate) / 1000)) : null;
  // T009: when analytics has been fetched, did NOT error, but came back
  // empty (e.g. chain fetched OK but every strike row was filtered out, or
  // upstream returned no rows), surface an explicit "no data" state on the
  // four summary cards instead of an indefinite Skeleton that looks like
  // loading. Excluding `isError` is important: a failed fetch should NOT be
  // labelled "No live chain data" (which implies the upstream successfully
  // returned an empty payload). Errors render as "—" without misleading copy.
  const analyticsEmpty = analyticsQ.isFetched && !analyticsQ.isError && !analytics;
  const analyticsErrored = analyticsQ.isError && !analytics;

  const status: "loading" | "error" | "ready" =
    chain ? "ready"
      : chainQ.isError || chainQ.isFetched ? "error"
      : "loading";

  // ── Picker state ────────────────────────────────────────────────
  const currentEntry = findFno(underlying);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Close picker when clicking outside or pressing Esc
  useEffect(() => {
    if (!pickerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { setPickerOpen(false); setSearchQ(""); }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [pickerOpen]);

  const filteredEntries = useMemo<FnoEntry[]>(() => {
    const q = searchQ.trim().toUpperCase();
    if (!q) return FNO_ALL;
    return FNO_ALL.filter(
      e => e.sym.includes(q) || e.label.toUpperCase().includes(q) || e.sector.toUpperCase().includes(q),
    );
  }, [searchQ]);

  const groupedEntries = useMemo(() => groupBySector(filteredEntries), [filteredEntries]);

  function go(sym: string) {
    setLocation(`/option-chain/${sym}`);
    setPickerOpen(false);
    setSearchQ("");
  }

  return (
    <div className="w-full px-4 py-4 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-end gap-3 justify-between">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight font-mono">
              Option Chain
              <span className="ml-3 px-2 py-0.5 text-[11px] rounded border border-primary/40 bg-primary/10 text-primary uppercase tracking-wider">
                {currentEntry?.kind ?? "—"}
              </span>
            </h1>
            <DataSourceBadge
              source={chain?.source === "kite" ? "kite" : "mixed"}
              status={chain?.source === "kite" ? "live" : "delayed"}
              refreshMs={15_000}
              lastUpdated={chain?.generatedAt ?? null}
              note="NSE option chain · 15s cache"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Live NSE OI for <b className="text-foreground/90 font-mono">{currentEntry?.label ?? underlying}</b>
            {currentEntry?.sector ? <> · <span className="text-foreground/70">{currentEntry.sector}</span></> : null}
            {" · "}OI per strike (CE left, PE right) · ATM highlighted · R1-R3 = top call-writing strikes (resistance), S1-S3 = top put-writing strikes (support)
          </p>
          <div className="mt-1.5 flex items-center gap-2 text-[10px] font-mono flex-wrap">
            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${
              marketStatus == null ? "border-border bg-secondary/40 text-muted-foreground" :
              marketStatus === "open" ? "border-signal-strong-buy/40 bg-signal-strong-buy/15 text-signal-strong-buy" :
              marketStatus === "pre_open" ? "border-amber-500/40 bg-amber-500/15 text-amber-500" :
              "border-border bg-secondary/40 text-muted-foreground"
            }`}>
              <Radio className={`w-2.5 h-2.5 ${marketStatus === "open" ? "animate-pulse" : ""}`} />
              {marketStatus == null ? "—" : marketStatus === "open" ? "MARKET OPEN" : marketStatus === "pre_open" ? "PRE-OPEN" : "MARKET CLOSED"}
            </span>
            {chain && (
              <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${
                chain.source === "kite"
                  ? "border-signal-strong-buy/30 bg-signal-strong-buy/10 text-signal-strong-buy"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-400"
              }`}>
                <Database className="w-2.5 h-2.5" />
                {chain.source === "kite" ? "KITE LIVE" : chain.source === "NSE" ? "NSE DIRECT" : chain.source?.toUpperCase() ?? "UNKNOWN"}
              </span>
            )}
            <span className="text-muted-foreground">
              {refetchInterval / 1000}s cadence
              {secondsSinceUpdate != null && (
                <> · {secondsSinceUpdate < 5 ? (
                  <span className="text-signal-strong-buy">just now</span>
                ) : secondsSinceUpdate > 30 ? (
                  <span className="text-amber-400">{secondsSinceUpdate}s ago</span>
                ) : (
                  <>{secondsSinceUpdate}s ago</>
                )}</>
              )}
              {chainQ.isFetching && lastUpdate ? " · refreshing…" : ""}
            </span>
            {chain?.provenance?.fallbackUsed && (
              <span
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400"
                title={
                  chain.provenance.sourceProvider === "nse"
                    ? "NSE fallback — Kite unavailable. Display only; not used for official signals or trades."
                    : "Fallback data — Kite unavailable. Display only; not used for official signals or trades."
                }
              >
                <AlertTriangle className="w-2.5 h-2.5" />
                {chain.provenance.sourceProvider === "nse" ? "NSE FALLBACK" : "FALLBACK"} · DISPLAY ONLY
              </span>
            )}
            {chain?.provenance?.isStale && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400">
                <AlertTriangle className="w-2.5 h-2.5" />
                STALE
                {chain.provenance.freshnessSec != null ? ` · ${chain.provenance.freshnessSec}s old` : ""}
              </span>
            )}
            {chain?.provenance != null &&
              chain.provenance.legCount != null &&
              chain.provenance.oiLegCount != null &&
              chain.provenance.legCount > 0 &&
              chain.provenance.oiLegCount < chain.provenance.legCount && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400"
                  title="Some strikes have no open-interest data."
                >
                  <AlertTriangle className="w-2.5 h-2.5" />
                  PARTIAL OI {chain.provenance.oiLegCount}/{chain.provenance.legCount}
                </span>
              )}
          </div>
          {chain?.provenance?.fallbackUsed && (
            <p className="mt-1 text-[10px] font-mono text-amber-400/90">
              {chain.provenance.sourceProvider === "nse"
                ? "NSE fallback — Kite unavailable. This chain is shown for reference only and does NOT feed official signals or paper trades."
                : "Fallback source — Kite unavailable. This chain is shown for reference only and does NOT feed official signals or paper trades."}
            </p>
          )}
        </div>

        {/* Search picker trigger */}
        <div className="relative w-full sm:w-[340px]">
          <button
            onClick={() => { setPickerOpen(o => !o); setTimeout(() => searchRef.current?.focus(), 30); }}
            className="w-full flex items-center gap-2 px-3 py-2 text-xs font-mono rounded border border-border bg-card hover-row text-left"
          >
            <Search className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="flex-1 text-foreground/80 truncate">
              Search any of <b className="text-primary">{FNO_ALL.length}</b> F&amp;O underlyings…
            </span>
            {pickerOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {pickerOpen && (
            <div className="absolute z-50 right-0 mt-1.5 w-[min(640px,95vw)] max-h-[70vh] overflow-y-auto rounded-md border border-border bg-popover shadow-2xl">
              <div className="sticky top-0 bg-popover border-b border-border p-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2 top-1/2 -translate-y-1/2" />
                  <input
                    ref={searchRef}
                    value={searchQ}
                    onChange={e => setSearchQ(e.target.value)}
                    placeholder="Type symbol, name or sector (e.g. RELIANCE / banking / pharma)…"
                    className="w-full pl-7 pr-2 py-1.5 text-xs font-mono bg-background border border-border rounded focus:outline-none focus:border-primary"
                  />
                </div>
                <div className="text-[10px] text-muted-foreground font-mono mt-1.5 uppercase">
                  {filteredEntries.length} results · ESC to close
                </div>
              </div>

              <div className="p-2 space-y-3">
                {groupedEntries.map(([sector, entries]) => (
                  <div key={sector}>
                    <div className="text-[10px] uppercase font-mono text-muted-foreground/80 px-1 mb-1 sticky top-[46px]">
                      {sector} <span className="text-muted-foreground/50">· {entries.length}</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                      {entries.map(e => (
                        <button
                          key={e.sym}
                          onClick={() => go(e.sym)}
                          className={`text-left px-2 py-1.5 rounded text-[11px] font-mono border transition-colors ${
                            underlying === e.sym
                              ? "border-primary bg-primary/15 text-primary"
                              : "border-transparent hover:border-border hover-row text-foreground/85"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-bold truncate">{e.sym}</span>
                            <span className={`text-[9px] px-1 rounded ${e.kind === "INDEX" ? "bg-primary/15 text-primary" : "bg-secondary/40 text-muted-foreground"}`}>
                              {e.kind === "INDEX" ? "IDX" : "EQ"}
                            </span>
                          </div>
                          <div className="text-[10px] text-muted-foreground truncate">{e.label}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                {filteredEntries.length === 0 && (
                  <div className="text-xs text-muted-foreground font-mono text-center py-6">
                    No F&amp;O underlying matches "{searchQ}".
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <FnoBanBanner underlying={underlying} />

      {/* Quick presets row */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase font-mono text-muted-foreground mr-1">Quick:</span>
        {QUICK_PRESETS.map(p => (
          <button
            key={p.sym}
            onClick={() => go(p.sym)}
            className={`px-2.5 py-1 text-[11px] font-mono rounded border transition-colors ${
              underlying === p.sym
                ? "border-primary bg-primary/15 text-primary font-bold"
                : "border-border bg-card hover-row text-foreground/70"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Analytics data-source chip — P1 unified vocabulary. Applies to
          all 6 cards below (Spot / PCR / Max Pain / ATM IV / Total OI /
          Bias). Live Kite chain → KITE_TRADE_GRADE; NSE archive fallback
          → INFO_ONLY (never trade-grade); stale/missing → UNAVAILABLE. */}
      <div className="flex items-center gap-2 flex-wrap -mb-1">
        <span className="text-[10px] uppercase text-muted-foreground font-mono tracking-wider">
          Analytics source:
        </span>
        <UnifiedGradeChip
          chipId="option-chain-analytics"
          source={
            chain?.source === "kite"
              ? "kite"
              : chain?.provenance?.sourceProvider === "nse"
                ? "nse_archive"
                : "missing"
          }
          runtime={{
            hasData: Boolean(chain && analytics),
            asOf: analytics?.generatedAt ?? chain?.generatedAt ?? null,
            isStale: chain?.provenance?.isStale ?? null,
            fallbackUsed: chain?.provenance?.fallbackUsed ?? false,
          }}
          note="PCR / Max Pain / ATM IV / Total OI / Bias are all derived from the same live option chain. Kite live is the only trade-grade path; NSE archive is display-only fallback."
          warning={
            chain?.provenance?.fallbackUsed
              ? "Kite unavailable — showing NSE archive fallback. Not trade-grade."
              : chain?.provenance?.isStale
                ? "Chain is past its freshness budget."
                : undefined
          }
        />
      </div>

      {/* Spot + Analytics summary */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <Card className="bg-card border-border">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground font-mono">Spot</div>
            <div className="text-xl font-bold font-mono tabular-nums">
              {chain ? fmt(chain.spot) : <Skeleton className="h-6 w-20" />}
            </div>
            {chain && (
              <div className="text-[11px] text-muted-foreground font-mono">
                ATM {fmt(chain.atmStrike, 0)} · step {chain.strikeStep}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground font-mono">PCR (OI)</div>
            <div className={`text-xl font-bold font-mono tabular-nums ${
              !analytics ? "" :
              analytics.pcrOi >= 1.3 ? "text-signal-strong-buy" :
              analytics.pcrOi <= 0.7 ? "text-signal-strong-sell" : "text-foreground"
            }`}>
              {analytics ? analytics.pcrOi.toFixed(2) : analyticsEmpty ? <span className="text-muted-foreground">—</span> : <Skeleton className="h-6 w-12" />}
            </div>
            <div className="text-[11px] text-muted-foreground font-mono">
              {analytics ? `Vol PCR ${analytics.pcrVolume.toFixed(2)}`
                : analyticsErrored ? "Analytics fetch failed"
                : analyticsEmpty ? "No live chain data"
                : "Vol PCR —"}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground font-mono">Max Pain</div>
            <div className="text-xl font-bold font-mono tabular-nums">
              {analytics ? fmt(analytics.maxPain, 0) : analyticsEmpty ? <span className="text-muted-foreground">—</span> : <Skeleton className="h-6 w-16" />}
            </div>
            {analytics && chain ? (
              <div className={`text-[11px] font-mono ${chain.spot > analytics.maxPain ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>
                {chain.spot > analytics.maxPain ? "+" : ""}
                {(((chain.spot - analytics.maxPain) / analytics.maxPain) * 100).toFixed(2)}% vs spot
              </div>
            ) : analyticsErrored ? (
              <div className="text-[11px] text-muted-foreground font-mono">Analytics fetch failed</div>
            ) : analyticsEmpty ? (
              <div className="text-[11px] text-muted-foreground font-mono">No live chain data</div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground font-mono">ATM IV</div>
            <div className="text-xl font-bold font-mono tabular-nums">
              {analytics?.atmIv != null ? `${analytics.atmIv.toFixed(2)}%`
                : analytics ? "—"
                : analyticsEmpty ? <span className="text-muted-foreground">—</span>
                : <Skeleton className="h-6 w-12" />}
            </div>
            <div className="text-[11px] text-muted-foreground font-mono space-y-0.5">
              {analytics ? (
                <>
                  <div>{analytics.ivPercentile != null ? `IV%ile ${analytics.ivPercentile}` : "Building IV history…"}</div>
                  {analytics.ivRank != null && <div>IV Rank {analytics.ivRank}</div>}
                </>
              ) : analyticsErrored ? (
                <div>Analytics fetch failed</div>
              ) : analyticsEmpty ? (
                <div>No live chain data</div>
              ) : (
                <div>Building IV history…</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground font-mono">Total OI</div>
            <div className="text-sm font-bold font-mono tabular-nums leading-tight">
              <span className="text-signal-strong-buy">{analytics ? fmtKL(analytics.totalCallOi) : "—"}</span>
              <span className="text-muted-foreground"> / </span>
              <span className="text-signal-strong-sell">{analytics ? fmtKL(analytics.totalPutOi) : "—"}</span>
            </div>
            <div className="text-[10px] text-muted-foreground font-mono">
              {analytics ? "CE / PE"
                : analyticsErrored ? "Analytics fetch failed"
                : analyticsEmpty ? "No live chain data"
                : "CE / PE"}
            </div>
            {analytics && (
              <div className="text-[11px] font-mono mt-1">
                {/* B2.2-D-OC-1: null OI-added must be neutral, not green (JS: null >= 0 → true via ?? 0). */}
                <span className={analytics.callOiAdded == null ? "text-muted-foreground" : analytics.callOiAdded >= 0 ? "text-signal-strong-buy" : "text-signal-strong-sell"}>
                  CE Δ {fmtKL(analytics.callOiAdded)}
                </span>
                <span className="text-muted-foreground"> · </span>
                <span className={analytics.putOiAdded == null ? "text-muted-foreground" : analytics.putOiAdded >= 0 ? "text-signal-strong-buy" : "text-signal-strong-sell"}>
                  PE Δ {fmtKL(analytics.putOiAdded)}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardContent className="p-3">
            <div className="text-[10px] uppercase text-muted-foreground font-mono">Bias</div>
            {analytics ? (
              <Badge className={
                analytics.bias === "BULLISH" ? "bg-signal-strong-buy/20 text-signal-strong-buy border-signal-strong-buy/40" :
                analytics.bias === "BEARISH" ? "bg-signal-strong-sell/20 text-signal-strong-sell border-signal-strong-sell/40" :
                "bg-secondary/40 text-muted-foreground border-border/40"
              }>
                {analytics.bias === "BULLISH" && <TrendingUp className="w-3 h-3 mr-1 inline" />}
                {analytics.bias === "BEARISH" && <TrendingDown className="w-3 h-3 mr-1 inline" />}
                {analytics.bias === "NEUTRAL" && <Activity className="w-3 h-3 mr-1 inline" />}
                {analytics.bias}
              </Badge>
            ) : <Skeleton className="h-6 w-20" />}
            {analytics?.topResistance?.[0] && (
              <div className="text-[11px] text-muted-foreground font-mono mt-1">
                <Target className="w-3 h-3 inline mr-1" />
                R1 {fmt(analytics.topResistance[0].strike, 0)} · S1 {analytics.topSupport?.[0]?.strike != null ? fmt(analytics.topSupport[0].strike, 0) : "—"}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Market Read — structured bias card with confidence + reasons + invalidation */}
      {analytics && (
        <Card className={`border ${
          analytics.bias === "BULLISH" ? "border-signal-strong-buy/30 bg-signal-strong-buy/[0.03]" :
          analytics.bias === "BEARISH" ? "border-signal-strong-sell/30 bg-signal-strong-sell/[0.03]" :
          "border-border bg-card/50"
        }`}>
          <CardContent className="p-4 space-y-3">
            <button
              onClick={() => setMarketReadOpen(o => !o)}
              className="w-full flex items-center justify-between gap-2"
            >
              <div className="flex items-center gap-3">
                <Shield className={`w-4 h-4 ${
                  analytics.bias === "BULLISH" ? "text-signal-strong-buy" :
                  analytics.bias === "BEARISH" ? "text-signal-strong-sell" :
                  "text-muted-foreground"
                }`} />
                <span className="text-xs uppercase font-mono tracking-wider text-muted-foreground">Market Read</span>
                <Badge className={
                  analytics.bias === "BULLISH" ? "bg-signal-strong-buy/20 text-signal-strong-buy border-signal-strong-buy/40" :
                  analytics.bias === "BEARISH" ? "bg-signal-strong-sell/20 text-signal-strong-sell border-signal-strong-sell/40" :
                  "bg-secondary/40 text-muted-foreground border-border/40"
                }>
                  {analytics.bias === "BULLISH" && <TrendingUp className="w-3 h-3 mr-1 inline" />}
                  {analytics.bias === "BEARISH" && <TrendingDown className="w-3 h-3 mr-1 inline" />}
                  {analytics.bias === "NEUTRAL" && <Activity className="w-3 h-3 mr-1 inline" />}
                  {analytics.bias}
                </Badge>
                {analytics.confidenceScore != null && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-16 h-1.5 rounded-full bg-secondary/60 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          analytics.confidenceScore >= 70 ? "bg-signal-strong-buy" :
                          analytics.confidenceScore >= 40 ? "bg-amber-500" :
                          "bg-signal-strong-sell"
                        }`}
                        style={{ width: `${analytics.confidenceScore}%` }}
                      />
                    </div>
                    <span className={`text-[10px] font-mono font-bold ${
                      analytics.confidenceScore >= 70 ? "text-signal-strong-buy" :
                      analytics.confidenceScore >= 40 ? "text-amber-500" :
                      "text-signal-strong-sell"
                    }`}>
                      {analytics.confidenceScore}%
                    </span>
                  </div>
                )}
              </div>
              <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${marketReadOpen ? "rotate-90" : ""}`} />
            </button>

            {marketReadOpen && (
              <div className="space-y-2.5 pt-1">
                {analytics.marketReadReasons && analytics.marketReadReasons.length > 0 && (
                  <div className="space-y-1.5">
                    {analytics.marketReadReasons.map((r, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs font-mono">
                        <span className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                          r.impact === "BULLISH" ? "bg-signal-strong-buy" :
                          r.impact === "BEARISH" ? "bg-signal-strong-sell" :
                          "bg-muted-foreground"
                        }`} />
                        <div>
                          <span className="text-foreground/60 text-[10px] uppercase">{r.signal}: </span>
                          <span className="text-foreground/85">{r.detail}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {analytics.invalidation && (
                  <div className="flex items-start gap-2 pt-1 border-t border-border/50 text-[11px] font-mono text-amber-400/80">
                    <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                    <span>{analytics.invalidation}</span>
                  </div>
                )}
                {analytics.interpretation && (
                  <div className="text-[10px] font-mono text-muted-foreground pt-1 border-t border-border/50">
                    {analytics.interpretation}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Key Levels (R1-R3 / S1-S3) ──────────────────────────────────
            R1/R2/R3 = top three call-writing strikes (highest CE OI):
            where call writers have stacked positions, so price tends to
            face supply on rallies. S1/S2/S3 = top three put-writing
            strikes (highest PE OI): where put writers have committed
            capital, providing demand on dips. The chgOi tag tells the
            user whether writers are *adding* fresh OI today (active
            level being defended) or unwinding (level weakening). The
            ranking refreshes every chain poll, so the levels move
            naturally with the live market. */}
      {analytics && (analytics.topResistance?.length || analytics.topSupport?.length) ? (
        <Card className="bg-card border-border">
          <CardContent className="p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase text-muted-foreground font-mono tracking-wider">Key Levels — option-writing clusters</div>
              {chain && (
                <div className="text-[10px] text-muted-foreground font-mono">
                  Spot {fmt(chain.spot, chain.spot >= 1000 ? 0 : 2)}
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {/* RESISTANCE column (R1/R2/R3) */}
              <div className="space-y-1">
                <div className="text-[10px] font-mono uppercase text-signal-strong-sell flex items-center gap-1">
                  <TrendingDown className="w-3 h-3" /> Resistance · top call writers
                </div>
                {(analytics.topResistance ?? []).slice(0, 3).map((c, i) => {
                  const tier = (["R1", "R2", "R3"] as const)[i];
                  const dist = chain ? ((c.strike - chain.spot) / chain.spot) * 100 : null;
                  return (
                    <div key={c.strike} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-signal-strong-sell/[0.06] border border-signal-strong-sell/20 font-mono text-[11px]">
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          i === 0 ? "bg-signal-strong-sell/30 text-signal-strong-sell" :
                          i === 1 ? "bg-signal-strong-sell/20 text-signal-strong-sell" :
                          "bg-signal-strong-sell/15 text-signal-strong-sell/80"
                        }`}>{tier}</span>
                        <span className="font-bold tabular-nums">{c.strike}</span>
                        {dist != null && (
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            {dist >= 0 ? "+" : ""}{dist.toFixed(2)}%
                          </span>
                        )}
                        {(c as { strength?: string }).strength && (
                          <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${
                            (c as { strength?: string }).strength === "STRONG" ? "bg-signal-strong-sell/25 text-signal-strong-sell" :
                            (c as { strength?: string }).strength === "MEDIUM" ? "bg-amber-500/20 text-amber-400" :
                            "bg-secondary/40 text-muted-foreground"
                          }`}>
                            {(c as { strength?: string }).strength}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="tabular-nums text-foreground/80" title="Total CE OI">OI {fmtKL(c.oi)}</span>
                        {c.chgOi != null && (
                          <span className={`tabular-nums text-[10px] ${c.chgOi > 0 ? "text-signal-strong-sell" : c.chgOi < 0 ? "text-signal-strong-buy" : "text-muted-foreground"}`}
                                title={c.chgOi > 0 ? "Writers adding — level being defended" : c.chgOi < 0 ? "Writers unwinding — level weakening" : "No change"}>
                            Δ {c.chgOi > 0 ? "+" : ""}{fmtKL(c.chgOi)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {(!analytics.topResistance || analytics.topResistance.length === 0) && (
                  <div className="text-[10px] text-muted-foreground font-mono italic px-1">No call-side OI clusters in this chain.</div>
                )}
              </div>

              {/* SUPPORT column (S1/S2/S3) */}
              <div className="space-y-1">
                <div className="text-[10px] font-mono uppercase text-signal-strong-buy flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Support · top put writers
                </div>
                {(analytics.topSupport ?? []).slice(0, 3).map((c, i) => {
                  const tier = (["S1", "S2", "S3"] as const)[i];
                  const dist = chain ? ((c.strike - chain.spot) / chain.spot) * 100 : null;
                  return (
                    <div key={c.strike} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded bg-signal-strong-buy/[0.06] border border-signal-strong-buy/20 font-mono text-[11px]">
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          i === 0 ? "bg-signal-strong-buy/30 text-signal-strong-buy" :
                          i === 1 ? "bg-signal-strong-buy/20 text-signal-strong-buy" :
                          "bg-signal-strong-buy/15 text-signal-strong-buy/80"
                        }`}>{tier}</span>
                        <span className="font-bold tabular-nums">{c.strike}</span>
                        {dist != null && (
                          <span className="text-[10px] text-muted-foreground tabular-nums">
                            {dist >= 0 ? "+" : ""}{dist.toFixed(2)}%
                          </span>
                        )}
                        {(c as { strength?: string }).strength && (
                          <span className={`text-[9px] px-1 py-0.5 rounded font-bold ${
                            (c as { strength?: string }).strength === "STRONG" ? "bg-signal-strong-buy/25 text-signal-strong-buy" :
                            (c as { strength?: string }).strength === "MEDIUM" ? "bg-amber-500/20 text-amber-400" :
                            "bg-secondary/40 text-muted-foreground"
                          }`}>
                            {(c as { strength?: string }).strength}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="tabular-nums text-foreground/80" title="Total PE OI">OI {fmtKL(c.oi)}</span>
                        {c.chgOi != null && (
                          <span className={`tabular-nums text-[10px] ${c.chgOi > 0 ? "text-signal-strong-buy" : c.chgOi < 0 ? "text-signal-strong-sell" : "text-muted-foreground"}`}
                                title={c.chgOi > 0 ? "Writers adding — level being defended" : c.chgOi < 0 ? "Writers unwinding — level weakening" : "No change"}>
                            Δ {c.chgOi > 0 ? "+" : ""}{fmtKL(c.chgOi)}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {(!analytics.topSupport || analytics.topSupport.length === 0) && (
                  <div className="text-[10px] text-muted-foreground font-mono italic px-1">No put-side OI clusters in this chain.</div>
                )}
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground font-mono">
              Δ shows today's net OI change at that strike. Positive on the resistance side = call writers adding (level holding); positive on the support side = put writers adding (floor being built). Levels re-rank automatically as live OI shifts.
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Expiry selector */}
      {chain && chain.expiries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase text-muted-foreground font-mono">Expiry:</span>
          {chain.expiries.slice(0, 8).map(e => (
            <button
              key={e}
              onClick={() => setExpiry(e)}
              className={`px-2.5 py-1 text-[11px] font-mono rounded border transition-colors ${
                e === chain.expiry
                  ? "border-primary bg-primary/15 text-primary font-bold"
                  : "border-border bg-card hover-row text-foreground/70"
              }`}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {/* Status messages */}
      {status === "error" && (() => {
        const errAny = chainQ.error as { response?: { data?: { detail?: string; kiteAuthenticated?: boolean } } } | undefined;
        const detail = errAny?.response?.data?.detail;
        const kiteOn = errAny?.response?.data?.kiteAuthenticated;
        return (
          <Card className="bg-card border-signal-strong-sell/30">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center gap-2 text-sm font-mono text-signal-strong-sell">
                Option chain unavailable for <b>{underlying}</b>
                <span className={`px-1.5 py-0.5 rounded text-[10px] uppercase ${kiteOn ? "bg-signal-strong-buy/20 text-signal-strong-buy" : "bg-signal-strong-sell/20 text-signal-strong-sell"}`}>
                  Kite: {kiteOn ? "connected" : "not connected"}
                </span>
              </div>
              {detail && <div className="text-xs text-foreground/80">{detail}</div>}
              {!kiteOn && (
                <ul className="text-xs text-muted-foreground list-disc list-inside space-y-0.5">
                  <li>Open the <b>Live Feed</b> tab and click <b>Connect Kite</b> (daily login, ~30 seconds).</li>
                  <li>If you see "Not a valid https redirect URL" in Kite, publish this app first so the redirect URL becomes a real subdomain (replace <code className="px-1 bg-secondary/40 rounded">&lt;your-app&gt;</code> with your actual Replit subdomain in your Kite app settings).</li>
                  <li>Alternative: deploy to an Indian-region host (Mumbai/Bengaluru) — NSE will then respond directly.</li>
                </ul>
              )}
              <div className="text-[11px] text-muted-foreground font-mono pt-1">
                Page auto-refreshes every 30s · use the search above to try a different underlying.
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {/* Chain table */}
      {status === "loading" && (
        <div className="space-y-2">
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      )}

      {chain && (
        <>
          {/* Strike filter + Greeks toggle + summary */}
          <div className="flex flex-wrap items-center gap-2 -mb-1">
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-[10px] uppercase font-mono text-muted-foreground">Strikes:</span>
              {([
                { v: "atm5" as const, l: "ATM±5" },
                { v: "atm10" as const, l: "ATM±10" },
                { v: "all" as const, l: "All" },
                { v: "highOi" as const, l: "High OI" },
                { v: "unusual" as const, l: "Unusual Vol" },
                { v: "oiSpike" as const, l: "OI Spike" },
              ]).map(f => (
                <button
                  key={f.v}
                  onClick={() => setStrikeFilter(f.v)}
                  className={`px-2 py-0.5 text-[10px] font-mono rounded border transition-colors ${
                    strikeFilter === f.v
                      ? "border-primary bg-primary/15 text-primary font-bold"
                      : "border-border bg-card hover-row text-foreground/70"
                  }`}
                  title={
                    f.v === "highOi" ? "Show strikes with OI ≥ 30% of max" :
                    f.v === "unusual" ? "Volume anomaly: Vol/OI ratio ≥ 1.5 — fresh trading activity vs. existing positions" :
                    f.v === "oiSpike" ? "Unusual OI Buildup: |ΔOI/OI| ≥ 15% AND OI ≥ 5,000 — aggressive position building or unwinding today" :
                    undefined
                  }
                >
                  {f.l}
                </button>
              ))}
              <span className="text-[10px] text-muted-foreground font-mono ml-1">
                {sortedRows.length}{chain ? `/${chain.rows.length}` : ""} strikes
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 -mb-1">
            <div className="flex items-center gap-2 text-[11px] font-mono">
              <button
                onClick={() => setShowGreeks(g => !g)}
                className={`px-2.5 py-1 rounded border transition-colors ${
                  showGreeks
                    ? "border-primary bg-primary/15 text-primary font-bold"
                    : "border-border bg-card hover-row text-foreground/70"
                }`}
              >
                {showGreeks ? "Hide Greeks" : "Show Greeks (Δ Γ Θ V)"}
              </button>
              <span className="text-muted-foreground">
                Black-Scholes · r=6.75% · {chain?.source === "kite" ? "IV solved per leg from market price" : "IV from exchange feed"}
              </span>
              {/* Greeks are DERIVED — Black-Scholes on top of the live chain.
                  Even when the chain is Kite trade-grade the Greeks themselves
                  are info-only computed values, not decisioning quotes. */}
              <UnifiedGradeChip
                chipId="option-chain-greeks"
                source="computed"
                runtime={{
                  hasData: Boolean(chain),
                  asOf: chain?.generatedAt ?? null,
                }}
                note="Greeks (Δ Γ Θ V) are Black-Scholes derivations, r=6.75%. Informational — never a direct trade-decisioning input."
              />
              {/* Download — credentialed by cookie. Includes the active expiry
                  so the file matches what's currently on screen. */}
              <a
                href={`/api/options/chain/${underlying}/export?format=csv${chain.expiry ? `&expiry=${encodeURIComponent(chain.expiry)}` : ""}`}
                className="px-2.5 py-1 rounded border border-border bg-card hover:border-primary/60 hover:text-primary transition-colors"
                download
                title="Download the current chain (with Greeks) as CSV"
              >
                ↓ CSV
              </a>
              <a
                href={`/api/options/chain/${underlying}/export?format=json${chain.expiry ? `&expiry=${encodeURIComponent(chain.expiry)}` : ""}`}
                className="px-2.5 py-1 rounded border border-border bg-card hover:border-primary/60 hover:text-primary transition-colors"
                download
                title="Download the current chain as JSON"
              >
                ↓ JSON
              </a>
            </div>
            {chain && (() => {
              const atmRow = chain.rows.find(r => r.strike === chain.atmStrike);
              if (!atmRow) return null;
              return (
                <div className="text-[11px] font-mono text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <span>ATM Δ:
                    <span className="text-signal-strong-buy ml-1">CE {fmtGreek(atmRow.ce?.delta, 3)}</span>
                    <span className="text-signal-strong-sell ml-1">PE {fmtGreek(atmRow.pe?.delta, 3)}</span>
                  </span>
                  <span>Θ/day:
                    <span className="text-signal-strong-sell ml-1">CE {fmtGreek(atmRow.ce?.theta, 2)}</span>
                    <span className="text-signal-strong-sell ml-1">PE {fmtGreek(atmRow.pe?.theta, 2)}</span>
                  </span>
                  <span>V:
                    <span className="text-foreground/70 ml-1">CE {fmtGreek(atmRow.ce?.vega, 2)}</span>
                    <span className="text-foreground/70 ml-1">PE {fmtGreek(atmRow.pe?.vega, 2)}</span>
                  </span>
                </div>
              );
            })()}
          </div>

          {/*
            Container scrolls in BOTH directions internally (max-height clamps
            it to ~70% of the viewport, overflow-auto enables both axes). This
            is what makes the sticky thead actually freeze — `position: sticky`
            sticks to the nearest scroll ancestor, so the ancestor must
            actually scroll vertically. Without the height clamp the page
            itself was the scroll context and `top-0` had nothing to anchor
            against, so the header drifted off-screen with the rest of the
            table on long chains. `z-20` keeps the frozen header above the
            ITM-tinted body cells (which have their own background) so the
            row labels never bleed through during scroll.
          */}
          <div className="relative">
          <div ref={tableScrollRef} className="overflow-auto rounded border border-border max-h-[calc(100vh-260px)]">
            <table className="w-full text-xs font-mono">
              <thead className="bg-card sticky top-0 z-20 shadow-[0_1px_0_0_hsl(var(--border))]">
                {(() => {
                  // Column count per side — keep both halves balanced so the
                  // CALLS / PUTS top-banner spans the right cells. Always-on:
                  // OI, Δ OI, Vol, V/O, IV, LTP, %Chg, B = 8.
                  // Greeks toggle adds 4 (Δ Γ Θ V) and 2 (Intrinsic, TimeVal).
                  const sideCols = showGreeks ? 8 + 4 + 2 : 8;
                  return (
                    <tr className="text-muted-foreground border-b border-border">
                      <th colSpan={sideCols} className="text-center text-signal-strong-buy py-1 border-r border-border bg-signal-strong-buy/[0.04]">
                        CALLS
                      </th>
                      <th className="text-center text-foreground py-1 px-3">STRIKE</th>
                      <th colSpan={sideCols} className="text-center text-signal-strong-sell py-1 border-l border-border bg-signal-strong-sell/[0.04]">
                        PUTS
                      </th>
                    </tr>
                  );
                })()}
                <tr className="text-muted-foreground border-b border-border bg-card/50 text-[11px]">
                  {(() => {
                    const SortTh = ({ col, children, title: t, className: cls = "text-right" }: { col: string; children: React.ReactNode; title?: string; className?: string }) => (
                      <th
                        className={`px-2 py-1.5 cursor-pointer hover:text-foreground select-none ${cls}`}
                        title={t}
                        onClick={() => handleSort(col)}
                      >
                        <span className="inline-flex items-center gap-0.5">
                          {children}
                          {sortCol === col && <span className="text-primary">{sortDir === "desc" ? "▼" : "▲"}</span>}
                        </span>
                      </th>
                    );
                    return (
                      <>
                        <SortTh col="ce_oi" title="Call-side Open Interest — total outstanding contracts">OI</SortTh>
                        <SortTh col="ce_chgOi" title="Day-over-day OI change (absolute) and OI % below. Positive = new contracts written, negative = unwinding">Δ OI</SortTh>
                        <SortTh col="ce_vol" title="Call-side volume — contracts traded today">Vol</SortTh>
                        <th className="px-2 py-1 text-right" title="Volume / OI — values > 1.0 indicate unusual fresh activity relative to outstanding positions">V/O</th>
                        <SortTh col="ce_iv" title="Implied Volatility — market's expectation of annualised price movement, solved from option premium via Black-Scholes">IV</SortTh>
                        {showGreeks && <th className="px-2 py-1 text-right" title="Delta (Δ) — option price change per ₹1 spot move. CE: 0→1, PE: -1→0. ATM ≈ ±0.5">Δ</th>}
                        {showGreeks && <th className="px-2 py-1 text-right" title="Gamma (Γ) — rate of delta change per ₹1 spot move. Highest at ATM, near-zero deep ITM/OTM">Γ</th>}
                        {showGreeks && <th className="px-2 py-1 text-right" title="Theta (Θ) — premium decay per calendar day. Always negative for long options. Accelerates near expiry">Θ</th>}
                        {showGreeks && <th className="px-2 py-1 text-right" title="Vega (V) — premium change per 1% rise in IV. Higher at ATM and longer-dated options">V</th>}
                        {showGreeks && <th className="px-2 py-1 text-right" title="Intrinsic value — max(0, Spot−Strike) for CE, max(0, Strike−Spot) for PE">Int</th>}
                        {showGreeks && <th className="px-2 py-1 text-right" title="Time value = LTP − Intrinsic. Pure optionality premium that decays to zero at expiry">TV</th>}
                        <SortTh col="ce_ltp" title="Last Traded Price — most recent trade price for this CE option">LTP</SortTh>
                        <th className="px-2 py-1 text-right" title="LTP day-over-day % change vs prev close (Kite-only)">%Δ</th>
                        <th className="px-2 py-1 text-center border-r border-border" title="OI Buildup — LB=Long Buildup, SB=Short Buildup, SC=Short Covering, LU=Long Unwinding. Based on price+OI change direction">B</th>
                        <SortTh col="strike" className="text-center" title="Strike price — exercise price of the option contract">Strike</SortTh>
                        <th className="px-2 py-1 text-center border-l border-border" title="OI Buildup — LB=Long Buildup, SB=Short Buildup, SC=Short Covering, LU=Long Unwinding">B</th>
                        <th className="px-2 py-1 text-right" title="LTP day-over-day % change vs prev close (Kite-only)">%Δ</th>
                        <SortTh col="pe_ltp" title="Last Traded Price — most recent trade price for this PE option">LTP</SortTh>
                        {showGreeks && <th className="px-2 py-1 text-right" title="Time value">TV</th>}
                        {showGreeks && <th className="px-2 py-1 text-right" title="Intrinsic">Int</th>}
                        {showGreeks && <th className="px-2 py-1 text-right" title="Vega">V</th>}
                        {showGreeks && <th className="px-2 py-1 text-right" title="Theta">Θ</th>}
                        {showGreeks && <th className="px-2 py-1 text-right" title="Gamma">Γ</th>}
                        {showGreeks && <th className="px-2 py-1 text-right" title="Delta">Δ</th>}
                        <SortTh col="pe_iv" title="Implied Volatility — market's expectation of annualised price movement">IV</SortTh>
                        <th className="px-2 py-1 text-right" title="Volume / OI — unusual activity proxy">V/O</th>
                        <SortTh col="pe_vol" title="Put-side volume — contracts traded today">Vol</SortTh>
                        <SortTh col="pe_chgOi" title="Day-over-day OI change">Δ OI</SortTh>
                        <SortTh col="pe_oi" title="Put-side Open Interest">OI</SortTh>
                      </>
                    );
                  })()}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => (
                  <Row
                    key={r.strike}
                    row={r}
                    atm={chain.atmStrike}
                    spot={chain.spot}
                    maxOi={maxOi}
                    showGreeks={showGreeks}
                    resistanceTier={resistanceTiers.get(r.strike) ?? null}
                    supportTier={supportTiers.get(r.strike) ?? null}
                  />
                ))}
              </tbody>
            </table>
          </div>
            {/*
              "Jump to ATM" floating pill. Anchored INSIDE the relative
              wrapper so it sits over the scroll container, not over the
              page below. The arrow points the way the chain has to scroll
              to bring ATM back: ↑ when you've scrolled down past it,
              ↓ when you're still above it. Pinned to the side that's
              furthest from the user's current cursor focus area (top-right
              when ATM is above; bottom-right when it's below) so it never
              covers the strike row the user is actually reading.
            */}
            {atmDirection !== "visible" && chain && (
              <button
                type="button"
                onClick={scrollToAtm}
                className={`absolute right-4 z-30 flex items-center gap-1.5 rounded-full
                  bg-primary text-primary-foreground px-3 py-1.5 text-[11px] font-mono font-bold
                  shadow-lg ring-1 ring-primary/40 hover:bg-primary/90 transition
                  ${atmDirection === "above" ? "top-16" : "bottom-4"}`}
                title={`Scroll to ATM strike ${fmt(chain.atmStrike, 0)}`}
              >
                {atmDirection === "above"
                  ? <ArrowUp className="w-3.5 h-3.5" />
                  : <ArrowDown className="w-3.5 h-3.5" />}
                <span>Jump to ATM {fmt(chain.atmStrike, 0)}</span>
              </button>
            )}
          </div>

          {/* Buildup legend */}
          <div className="flex flex-wrap gap-3 text-[11px] font-mono">
            <span className="text-muted-foreground">OI Buildup:</span>
            <span className={`px-1.5 py-0.5 rounded ${buildupTone("LONG_BUILDUP")}`}>LB · Long Buildup</span>
            <span className={`px-1.5 py-0.5 rounded ${buildupTone("SHORT_COVERING")}`}>SC · Short Covering</span>
            <span className={`px-1.5 py-0.5 rounded ${buildupTone("SHORT_BUILDUP")}`}>SB · Short Buildup</span>
            <span className={`px-1.5 py-0.5 rounded ${buildupTone("LONG_UNWINDING")}`}>LU · Long Unwinding</span>
          </div>

          <div className="text-[11px] text-muted-foreground font-mono">
            Source: {chain.source} ·{" "}
            {analytics && `Updated ${formatDistanceToNow(new Date(analytics.generatedAt), { addSuffix: true })}`}
            {chain.lotSize && ` · Lot size ${chain.lotSize}`}
          </div>
        </>
      )}
    </div>
  );
}

function Row({ row, atm, spot, maxOi, showGreeks, resistanceTier, supportTier }: {
  row: OptionChainStrikeRow;
  atm: number;
  spot: number;
  maxOi: number;
  showGreeks: boolean;
  /** R1/R2/R3 if this strike is one of the top three call-writing
   *  clusters (resistance), else null. Updates every analytics refetch. */
  resistanceTier: "R1" | "R2" | "R3" | null;
  /** S1/S2/S3 if this strike is one of the top three put-writing
   *  clusters (support), else null. Updates every analytics refetch. */
  supportTier: "S1" | "S2" | "S3" | null;
}) {
  const isAtm = row.strike === atm;
  const isMaxPain = !!row.isMaxPain;
  const ce = row.ce, pe = row.pe;

  // CE OI bar (greenish, anchored right)
  const ceBar = ce?.oi && maxOi > 0 ? (ce.oi / maxOi) * 100 : 0;
  const peBar = pe?.oi && maxOi > 0 ? (pe.oi / maxOi) * 100 : 0;

  // ITM tint: CE in-the-money when strike < spot; PE in-the-money when strike > spot
  const ceItm = row.strike < spot;
  const peItm = row.strike > spot;

  // Per-side helpers — colour the LTP %Chg cell green/red, neutral on null.
  function pctTone(p: number | null | undefined): string {
    if (p == null || !Number.isFinite(p)) return "text-muted-foreground/60";
    if (p > 0) return "text-signal-strong-buy";
    if (p < 0) return "text-signal-strong-sell";
    return "text-foreground/60";
  }
  // Strike row tint: ATM > MaxPain (so when both coincide ATM wins). MaxPain
  // gets a distinct amber accent so it never reads as another "buy" tint.
  const rowTint = isAtm
    ? "bg-primary/[0.12] font-bold ring-1 ring-inset ring-primary/20"
    : isMaxPain ? "bg-amber-500/[0.06]" : "";

  return (
    <tr data-atm-row={isAtm ? "true" : undefined} className={`border-b border-border/30 hover-row ${rowTint}`}>
      {/* ── CALL side ─────────────────────────── */}
      <td className={`px-2 py-1.5 text-right tabular-nums relative ${ceItm ? "bg-signal-strong-buy/[0.04]" : ""}`}>
        <div
          className="absolute right-0 top-0 bottom-0 bg-signal-strong-buy/15"
          style={{ width: `${ceBar}%` }}
          aria-hidden
        />
        <span className="relative">{fmtKL(ce?.oi)}</span>
      </td>
      <td className={`px-2 py-1.5 text-right tabular-nums ${ceItm ? "bg-signal-strong-buy/[0.04]" : ""} ${(ce?.chgOi ?? 0) > 0 ? "text-signal-strong-buy" : (ce?.chgOi ?? 0) < 0 ? "text-signal-strong-sell" : ""}`}>
        <div className="leading-tight">{ce?.chgOi != null && ce.chgOi > 0 ? "+" : ""}{fmtKL(ce?.chgOi)}</div>
        <div className="text-[9px] opacity-70 leading-tight">{fmtPct(ce?.oiChgPct, 1)}</div>
      </td>
      <td className={`px-2 py-1.5 text-right tabular-nums ${ceItm ? "bg-signal-strong-buy/[0.04]" : ""}`}>{fmtKL(ce?.volume)}</td>
      <td className={`px-2 py-1.5 text-right tabular-nums text-foreground/70 ${ceItm ? "bg-signal-strong-buy/[0.04]" : ""}`} title="Volume / OI">{fmtRatio(ce?.volOiRatio)}</td>
      <td className={`px-2 py-1.5 text-right tabular-nums ${ceItm ? "bg-signal-strong-buy/[0.04]" : ""}`}>{ce?.iv ? ce.iv.toFixed(1) : "—"}</td>
      {showGreeks && <td className={`px-2 py-1.5 text-right tabular-nums ${ceItm ? "bg-signal-strong-buy/[0.04]" : ""}`}>{fmtGreek(ce?.delta, 3)}</td>}
      {showGreeks && <td className={`px-2 py-1.5 text-right tabular-nums ${ceItm ? "bg-signal-strong-buy/[0.04]" : ""}`}>{fmtGreek(ce?.gamma, 5)}</td>}
      {showGreeks && <td className={`px-2 py-1.5 text-right tabular-nums text-signal-strong-sell ${ceItm ? "bg-signal-strong-buy/[0.04]" : ""}`}>{fmtGreek(ce?.theta, 2)}</td>}
      {showGreeks && <td className={`px-2 py-1.5 text-right tabular-nums ${ceItm ? "bg-signal-strong-buy/[0.04]" : ""}`}>{fmtGreek(ce?.vega, 2)}</td>}
      {showGreeks && (
        <td className={`px-2 py-1.5 text-right tabular-nums ${ceItm ? "bg-signal-strong-buy/[0.04]" : ""}`} title={ce?.intrinsicPct != null ? `${ce.intrinsicPct.toFixed(0)}% of LTP is intrinsic` : undefined}>
          <div className="leading-tight">{fmt(ce?.intrinsic)}</div>
          {ce?.intrinsicPct != null && <div className="text-[9px] opacity-70 leading-tight">{ce.intrinsicPct.toFixed(0)}%</div>}
        </td>
      )}
      {showGreeks && <td className={`px-2 py-1.5 text-right tabular-nums text-foreground/80 ${ceItm ? "bg-signal-strong-buy/[0.04]" : ""}`}>{fmt(ce?.timeValue)}</td>}
      <td className={`px-2 py-1.5 text-right tabular-nums font-bold ${ceItm ? "bg-signal-strong-buy/[0.04]" : ""}`}>{fmt(ce?.ltp)}</td>
      <td className={`px-2 py-1.5 text-right tabular-nums ${pctTone(ce?.ltpChgPct)} ${ceItm ? "bg-signal-strong-buy/[0.04]" : ""}`}>{fmtPct(ce?.ltpChgPct, 1)}</td>
      <td className={`px-2 py-1.5 text-center border-r border-border ${ceItm ? "bg-signal-strong-buy/[0.04]" : ""}`}>
        <span className={`px-1 rounded text-[9px] font-bold ${buildupTone(ce?.oiBuildup)}`}>{buildupShort(ce?.oiBuildup)}</span>
      </td>

      {/* ── Strike — ATM, MaxPain, per-strike PCR, R/S tier ──────────
            R-tier (red) marks one of the top-3 call-writing strikes →
            resistance. S-tier (green) marks one of the top-3 put-writing
            strikes → support. Tier intensity: 1 brightest, 3 dimmest. */}
      <td className={`px-2 py-1.5 text-center tabular-nums ${
        resistanceTier ? "bg-signal-strong-sell/[0.05]" :
        supportTier ? "bg-signal-strong-buy/[0.05]" :
        ""
      } ${isAtm ? "text-primary" : isMaxPain ? "text-amber-500" : "text-foreground"}`}>
        <div className={`leading-tight font-bold ${isAtm || isMaxPain ? "text-[12px]" : ""}`}>{row.strike}</div>
        <div className="flex items-center justify-center gap-1 leading-tight mt-0.5 flex-wrap">
          {isAtm && <span className="text-[8px] px-1 rounded bg-primary/20 text-primary font-bold">ATM</span>}
          {isMaxPain && <span className="text-[8px] px-1 rounded bg-amber-500/25 text-amber-500 font-bold" title="Max-Pain strike">MP</span>}
          {resistanceTier && (
            <span
              className={`text-[8px] px-1 rounded font-bold ${
                resistanceTier === "R1" ? "bg-signal-strong-sell/35 text-signal-strong-sell" :
                resistanceTier === "R2" ? "bg-signal-strong-sell/25 text-signal-strong-sell" :
                "bg-signal-strong-sell/15 text-signal-strong-sell/85"
              }`}
              title={`${resistanceTier} — top call-writing cluster (resistance). Re-ranks live as OI shifts.`}
            >{resistanceTier}</span>
          )}
          {supportTier && (
            <span
              className={`text-[8px] px-1 rounded font-bold ${
                supportTier === "S1" ? "bg-signal-strong-buy/35 text-signal-strong-buy" :
                supportTier === "S2" ? "bg-signal-strong-buy/25 text-signal-strong-buy" :
                "bg-signal-strong-buy/15 text-signal-strong-buy/85"
              }`}
              title={`${supportTier} — top put-writing cluster (support). Re-ranks live as OI shifts.`}
            >{supportTier}</span>
          )}
          {row.pcrOi != null && (
            <span className={`text-[9px] font-mono ${
              row.pcrOi >= 1.3 ? "text-signal-strong-buy" :
              row.pcrOi <= 0.7 ? "text-signal-strong-sell" : "text-muted-foreground"
            }`} title="Per-strike PCR by OI (PE OI / CE OI)">
              {row.pcrOi.toFixed(2)}
            </span>
          )}
        </div>
      </td>

      {/* ── PUT side ─────────────────────────── */}
      <td className={`px-2 py-1.5 text-center border-l border-border ${peItm ? "bg-signal-strong-sell/[0.04]" : ""}`}>
        <span className={`px-1 rounded text-[9px] font-bold ${buildupTone(pe?.oiBuildup)}`}>{buildupShort(pe?.oiBuildup)}</span>
      </td>
      <td className={`px-2 py-1.5 text-right tabular-nums ${pctTone(pe?.ltpChgPct)} ${peItm ? "bg-signal-strong-sell/[0.04]" : ""}`}>{fmtPct(pe?.ltpChgPct, 1)}</td>
      <td className={`px-2 py-1.5 text-right tabular-nums font-bold ${peItm ? "bg-signal-strong-sell/[0.04]" : ""}`}>{fmt(pe?.ltp)}</td>
      {showGreeks && <td className={`px-2 py-1.5 text-right tabular-nums text-foreground/80 ${peItm ? "bg-signal-strong-sell/[0.04]" : ""}`}>{fmt(pe?.timeValue)}</td>}
      {showGreeks && (
        <td className={`px-2 py-1.5 text-right tabular-nums ${peItm ? "bg-signal-strong-sell/[0.04]" : ""}`} title={pe?.intrinsicPct != null ? `${pe.intrinsicPct.toFixed(0)}% of LTP is intrinsic` : undefined}>
          <div className="leading-tight">{fmt(pe?.intrinsic)}</div>
          {pe?.intrinsicPct != null && <div className="text-[9px] opacity-70 leading-tight">{pe.intrinsicPct.toFixed(0)}%</div>}
        </td>
      )}
      {showGreeks && <td className={`px-2 py-1.5 text-right tabular-nums ${peItm ? "bg-signal-strong-sell/[0.04]" : ""}`}>{fmtGreek(pe?.vega, 2)}</td>}
      {showGreeks && <td className={`px-2 py-1.5 text-right tabular-nums text-signal-strong-sell ${peItm ? "bg-signal-strong-sell/[0.04]" : ""}`}>{fmtGreek(pe?.theta, 2)}</td>}
      {showGreeks && <td className={`px-2 py-1.5 text-right tabular-nums ${peItm ? "bg-signal-strong-sell/[0.04]" : ""}`}>{fmtGreek(pe?.gamma, 5)}</td>}
      {showGreeks && <td className={`px-2 py-1.5 text-right tabular-nums ${peItm ? "bg-signal-strong-sell/[0.04]" : ""}`}>{fmtGreek(pe?.delta, 3)}</td>}
      <td className={`px-2 py-1.5 text-right tabular-nums ${peItm ? "bg-signal-strong-sell/[0.04]" : ""}`}>{pe?.iv ? pe.iv.toFixed(1) : "—"}</td>
      <td className={`px-2 py-1.5 text-right tabular-nums text-foreground/70 ${peItm ? "bg-signal-strong-sell/[0.04]" : ""}`} title="Volume / OI">{fmtRatio(pe?.volOiRatio)}</td>
      <td className={`px-2 py-1.5 text-right tabular-nums ${peItm ? "bg-signal-strong-sell/[0.04]" : ""}`}>{fmtKL(pe?.volume)}</td>
      <td className={`px-2 py-1.5 text-right tabular-nums ${peItm ? "bg-signal-strong-sell/[0.04]" : ""} ${(pe?.chgOi ?? 0) > 0 ? "text-signal-strong-buy" : (pe?.chgOi ?? 0) < 0 ? "text-signal-strong-sell" : ""}`}>
        <div className="leading-tight">{pe?.chgOi != null && pe.chgOi > 0 ? "+" : ""}{fmtKL(pe?.chgOi)}</div>
        <div className="text-[9px] opacity-70 leading-tight">{fmtPct(pe?.oiChgPct, 1)}</div>
      </td>
      <td className={`px-2 py-1.5 text-right tabular-nums relative ${peItm ? "bg-signal-strong-sell/[0.04]" : ""}`}>
        <div
          className="absolute left-0 top-0 bottom-0 bg-signal-strong-sell/15"
          style={{ width: `${peBar}%` }}
          aria-hidden
        />
        <span className="relative">{fmtKL(pe?.oi)}</span>
      </td>
    </tr>
  );
}
