/**
 * Indices Tab — dedicated dashboard for Indian indices, global benchmarks
 * and commodities with the full per-instrument fact pack
 * (LTP / OHLC / change / 52w extrema / prev OHLC / EMAs 9-200 / VWAP /
 *  VAH-VAL-POC / 3 supports + 3 resistances).
 *
 * Layout:
 *   - Three clickable section chips at the top (India · Global · Commodities)
 *     with instrument counts; defaults to India.
 *   - The active section renders a 2-column (xl: 3-col on very wide screens)
 *     grid of always-expanded instrument cards. No expand/collapse.
 *
 * Each card surfaces, in order of trader importance:
 *   1. Header — name, symbol, source pill, LTP, %Δ / Δabs
 *   2. Day-range bar — LTP position between session Low and High (% used)
 *   3. 52W-range bar — LTP position between 52W Low and 52W High (% used)
 *   4. Session + Previous OHLC strip + VWAP
 *   5. Daily-EMA cascade (9 / 20 / 50 / 100 / 200) with above/below arrows
 *   6. Market profile band (VAL / POC / VAH) + classic Pivot
 *   7. Pivot ladder — horizontal S3-R3 scale with LTP marker and the
 *      auto-computed distance to the nearest level
 *   8. Optional notes row (proxy disclosures, partial-data warnings)
 *
 * Visual cues:
 *   - Card left border tinted green (positive day change) / red (negative)
 *   - LTP gets a coloured underline when above (green) / below (red) VWAP
 *   - EMA rows show ↑/↓ + colour vs current price
 *   - Pivot-ladder marker shifts horizontally with LTP and is shaded by
 *     position relative to the central pivot
 *   - S/R values shade green/red when LTP is within 0.4% of any level
 *
 * Data: refreshes every 5 seconds via the typed React-Query hook against
 * /api/indices. Indian-index LTPs come from the live broker session when
 * one is authenticated (a small "live" pill is shown), otherwise from
 * Yahoo (~15 min delayed, with a "delayed" pill).
 */

import { useEffect, useMemo, useState } from "react";
import { useGetIndicesBoard, getGetIndicesBoardQueryKey } from "@workspace/api-client-react";
import type { IndexBoardItem, IndexAnalyticsProvenance } from "@workspace/api-client-react";
import { Activity, Globe2, Flame, AlertTriangle, Building2, DollarSign } from "lucide-react";

type Cat = "INDIA" | "GLOBAL" | "COMMODITY" | "ADR" | "FX";

const SECTIONS: { key: Cat; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "INDIA",     label: "India",        icon: Activity   },
  { key: "GLOBAL",    label: "Global",       icon: Globe2     },
  { key: "COMMODITY", label: "Commodities",  icon: Flame      },
  { key: "ADR",       label: "Indian ADRs",  icon: Building2  },
  { key: "FX",        label: "FX / Macro",   icon: DollarSign },
];

function fmt(n: number | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function pct(n: number | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(digits)}%`;
}

function isNear(price: number | undefined, level: number | undefined, tolPct = 0.4): boolean {
  if (price == null || level == null || level === 0) return false;
  return Math.abs(price - level) / level * 100 <= tolPct;
}

function changeColor(n: number | undefined): string {
  if (n == null) return "text-muted-foreground";
  if (n > 0) return "text-emerald-500";
  if (n < 0) return "text-rose-500";
  return "text-muted-foreground";
}

/** Position (0..1) of `value` between `lo` and `hi`, clamped, or null if invalid. */
function positionBetween(value: number | undefined, lo: number | undefined, hi: number | undefined): number | null {
  if (value == null || lo == null || hi == null || hi <= lo) return null;
  return Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
}

/** Find the nearest pivot level to `ltp` and return label + signed % distance. */
function nearestLevel(
  ltp: number | undefined,
  supports: number[] | undefined,
  pivot: number | undefined,
  resistances: number[] | undefined,
): { label: string; level: number; distancePct: number } | null {
  if (ltp == null || ltp === 0) return null;
  const candidates: { label: string; level: number }[] = [];
  (supports ?? []).forEach((v, i) => v != null && candidates.push({ label: `S${i + 1}`, level: v }));
  if (pivot != null) candidates.push({ label: "Pivot", level: pivot });
  (resistances ?? []).forEach((v, i) => v != null && candidates.push({ label: `R${i + 1}`, level: v }));
  if (candidates.length === 0) return null;
  let best = candidates[0]!;
  let bestAbs = Math.abs(ltp - best.level);
  for (const c of candidates) {
    const d = Math.abs(ltp - c.level);
    if (d < bestAbs) { best = c; bestAbs = d; }
  }
  return {
    label: best.label,
    level: best.level,
    distancePct: ((best.level - ltp) / ltp) * 100,
  };
}

/**
 * Markets fact-pack board — chip-tabbed view of every instrument we track:
 * Indian indices, global indices, commodities, Indian ADRs and FX/macro.
 *
 * Used standalone at `/indices` (legacy) and embedded inside the Home page.
 * When `embedded`, the page-level h1 + meta strip is replaced by a compact
 * section header so it slots cleanly into a parent layout.
 */
export default function IndicesBoard({ embedded = false }: { embedded?: boolean } = {}) {
  const [active, setActive] = useState<Cat>("INDIA");

  const { data, isLoading, error, refetch } = useGetIndicesBoard({
    query: {
      queryKey: getGetIndicesBoardQueryKey(),
      refetchInterval: 5_000,
      staleTime: 5_000,
    },
  });

  // T008: detect "stuck loading" — if the very first request hasn't returned
  // after 25s the user gets an actionable retry button instead of an
  // indefinite "Loading indices board…" message. Resets once data arrives.
  const [loadingTooLong, setLoadingTooLong] = useState(false);
  useEffect(() => {
    if (!isLoading) { setLoadingTooLong(false); return; }
    const t = setTimeout(() => setLoadingTooLong(true), 25_000);
    return () => clearTimeout(t);
  }, [isLoading]);

  const items = data?.items ?? [];
  const grouped = useMemo(() => {
    const m = new Map<Cat, IndexBoardItem[]>();
    for (const sec of SECTIONS) m.set(sec.key, []);
    for (const it of items) m.get(it.category as Cat)?.push(it);
    return m;
  }, [items]);

  const activeRows = grouped.get(active) ?? [];
  const ActiveIcon = SECTIONS.find(s => s.key === active)?.icon ?? Activity;

  return (
    <div className={embedded ? "w-full" : "w-full px-4 lg:px-6 2xl:px-8 py-6"}>
      <header className={`flex items-end justify-between gap-4 ${embedded ? "mb-3" : "mb-5"}`}>
        <div>
          {embedded ? (
            <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
              <Globe2 className="h-5 w-5 text-primary" />
              Markets — Indices, Commodities, ADRs &amp; FX
            </h2>
          ) : (
            <h1 className="text-2xl font-bold tracking-tight">Indices</h1>
          )}
          <p className="text-sm text-muted-foreground mt-1">
            Indian benchmarks, global indices, commodities, Indian ADRs and FX/macro — LTP, market profile, key levels.
          </p>
        </div>
        <div className="text-[11px] font-mono text-muted-foreground/80 text-right">
          {data?.lastUpdated && (
            <div>Updated {new Date(data.lastUpdated).toLocaleTimeString()}</div>
          )}
          {data && (
            <div className="mt-0.5">
              {data.kiteAuthenticated ? (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live (broker session active)
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/30">
                  Yahoo fallback (~15 min delayed)
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Loading / error states */}
      {isLoading && !loadingTooLong && (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          Loading indices board…
        </div>
      )}
      {isLoading && loadingTooLong && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-6 text-center text-sm text-amber-500 space-y-2">
          <div className="flex items-center justify-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            Indices board is taking longer than usual
          </div>
          <div className="text-xs text-muted-foreground">
            The upstream feed (Kite / TradingView / Yahoo) is slow to respond. You can keep waiting or retry now.
          </div>
          <button
            type="button"
            onClick={() => { setLoadingTooLong(false); refetch(); }}
            className="mt-2 px-3 py-1 rounded border border-amber-500/60 hover:bg-amber-500/10 text-xs font-mono uppercase"
          >
            Retry
          </button>
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-4 text-sm text-rose-500 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          Failed to load indices: {(error as Error).message}
        </div>
      )}

      {/* Section selector — clickable chips */}
      {!isLoading && !error && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {SECTIONS.map(tab => {
            const Icon = tab.icon;
            const isActive = tab.key === active;
            const count = grouped.get(tab.key)?.length ?? 0;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActive(tab.key)}
                data-testid={`indices-tab-${tab.key.toLowerCase()}`}
                aria-pressed={isActive}
                className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  isActive
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-foreground/70 hover:text-foreground border-border hover:border-foreground/40"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
                <span className={`text-[11px] font-mono px-1.5 py-0.5 rounded ${isActive ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Active section grid — 1 col mobile · 2 col lg · 3 col on extra-wide */}
      {!isLoading && !error && (
        <section data-testid={`indices-section-${active.toLowerCase()}`}>
          <div className="flex items-center gap-2 mb-3">
            <ActiveIcon className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              {SECTIONS.find(s => s.key === active)?.label}
            </h2>
            <div className="flex-1 border-t border-border ml-2" />
            <span className="text-[11px] font-mono text-muted-foreground">
              {activeRows.length} instrument{activeRows.length === 1 ? "" : "s"}
            </span>
          </div>

          {activeRows.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
              No instruments in this section.
            </div>
          ) : (
            <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(420px,100%),1fr))]">
              {activeRows.map(item => (
                <InstrumentCard key={item.key} item={item} />
              ))}
            </div>
          )}
        </section>
      )}

      <p className="text-xs text-muted-foreground mt-6 leading-relaxed">
        Pivots / supports / resistances are classic floor-trader levels derived from the previous session's OHLC.
        VAH / VAL / POC come from a 24-bin volume profile over the most recent ~6.5 hours of intraday bars.
        Daily EMAs are computed on closing prices and require ≥ 200 daily bars for EMA200 to populate.
      </p>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────── */
/*  Instrument card — always-expanded fact pack                         */
/* ───────────────────────────────────────────────────────────────────── */

function InstrumentCard({ item }: { item: IndexBoardItem }) {
  const c = item.currency;
  const aboveVwap = item.ltp != null && item.vwap != null && item.ltp >= item.vwap;
  const upDay = (item.change ?? 0) > 0;
  const downDay = (item.change ?? 0) < 0;
  const borderTone =
    upDay   ? "border-l-4 border-l-emerald-500/70"
    : downDay ? "border-l-4 border-l-rose-500/70"
    : "border-l-4 border-l-border";

  const nearest = nearestLevel(item.ltp, item.support, item.pivot, item.resistance);

  return (
    <div
      data-testid={`indices-card-${item.key}`}
      className={`rounded-lg border border-border bg-card overflow-hidden flex flex-col ${borderTone}`}
    >
      {/* Header — name + LTP + %change */}
      <div className="px-4 py-3 border-b border-border/70 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-base leading-tight truncate">{item.name}</div>
          <div className="text-[11px] font-mono text-muted-foreground/80 mt-1 flex items-center gap-1.5 flex-wrap">
            <span>{item.yahooSymbol}</span>
            {item.source === "kite"  && <span className="px-1 rounded bg-emerald-500/15 text-emerald-500 text-[10px] font-bold tracking-wide" title="Live Zerodha tick">LIVE</span>}
            {item.source === "tv"    && (() => {
              // TradingView freshness honesty: render based on update_mode.
              //   streaming             → green "LIVE"     (true real-time)
              //   delayed_streaming_600 → amber "LIVE 10m" (live-ticking, ~10min behind)
              //   delayed_streaming_900 → amber "LIVE 15m" (live-ticking, ~15min behind)
              //   anything else         → amber "TV"       (unknown delay, but TV-sourced)
              const m = item.tvUpdateMode ?? "";
              if (m === "streaming") {
                return <span className="px-1 rounded bg-emerald-500/15 text-emerald-500 text-[10px] font-bold tracking-wide" title="Real-time TradingView tick">LIVE</span>;
              }
              const mins = m === "delayed_streaming_600" ? "10m" : m === "delayed_streaming_900" ? "15m" : "";
              return <span className="px-1 rounded bg-amber-500/15 text-amber-500 text-[10px] font-bold tracking-wide" title={`TradingView live-streaming, ${mins ? `~${mins} delayed by exchange policy` : "delay unknown"}`}>{mins ? `LIVE ${mins}` : "TV"}</span>;
            })()}
            {item.source === "yahoo" && <span className="px-1 rounded bg-muted text-muted-foreground text-[10px] font-bold tracking-wide" title="Yahoo Finance fallback (~15min delayed)">DELAYED</span>}
            {item.source === null    && <span className="px-1 rounded bg-rose-500/15 text-rose-500 text-[10px] font-bold tracking-wide">NO DATA</span>}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono tabular-nums text-xl font-bold leading-none">
            <span
              className={
                item.vwap != null && item.ltp != null
                  ? `border-b-2 ${aboveVwap ? "border-emerald-500/70" : "border-rose-500/70"} pb-0.5`
                  : ""
              }
            >
              {c}{fmt(item.ltp)}
            </span>
          </div>
          <div className={`font-mono tabular-nums text-sm font-semibold mt-1 ${changeColor(item.change)}`}>
            {pct(item.changePercent)}
            <span className="ml-1.5 text-[11px] font-normal opacity-80">
              ({item.change != null ? (item.change > 0 ? "+" : "") + fmt(item.change) : "—"})
            </span>
          </div>
        </div>
      </div>

      {/* Range bars — Day + 52W */}
      <div className="px-4 py-3 border-b border-border/70 space-y-2.5">
        <RangeBar
          title="Day Range"
          lo={item.low}
          hi={item.high}
          ltp={item.ltp}
          currency={c}
        />
        <RangeBar
          title="52W Range"
          lo={item.fiftyTwoWeekLow}
          hi={item.fiftyTwoWeekHigh}
          ltp={item.ltp}
          currency={c}
        />
      </div>

      {/* OHLC — Session + Previous side-by-side */}
      <div className="px-4 py-2.5 border-b border-border/70 grid grid-cols-2 gap-x-4 text-xs">
        <div>
          <ColTitle>Session</ColTitle>
          <KvRow k="O" v={`${c}${fmt(item.open)}`} />
          <KvRow k="H" v={`${c}${fmt(item.high)}`} />
          <KvRow k="L" v={`${c}${fmt(item.low)}`} />
          <KvRow
            k="VWAP"
            v={`${c}${fmt(item.vwap)}`}
            bold
            valueClass={
              item.ltp != null && item.vwap != null
                ? (item.ltp >= item.vwap ? "text-emerald-500" : "text-rose-500")
                : ""
            }
          />
        </div>
        <div>
          <ColTitle>Previous</ColTitle>
          <KvRow k="O" v={`${c}${fmt(item.prevOpen)}`} />
          <KvRow k="H" v={`${c}${fmt(item.prevHigh)}`} />
          <KvRow k="L" v={`${c}${fmt(item.prevLow)}`} />
          <KvRow k="C" v={`${c}${fmt(item.prevClose)}`} bold />
        </div>
      </div>

      {/* EMAs — 3-up grid so all five fit on two rows */}
      <div className="px-4 py-2.5 border-b border-border/70">
        <ColTitle>Daily EMAs (vs price)</ColTitle>
        <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-xs">
          <EmaCell label="9"   ltp={item.ltp} val={item.ema9}   currency={c} />
          <EmaCell label="20"  ltp={item.ltp} val={item.ema20}  currency={c} />
          <EmaCell label="50"  ltp={item.ltp} val={item.ema50}  currency={c} />
          <EmaCell label="100" ltp={item.ltp} val={item.ema100} currency={c} />
          <EmaCell label="200" ltp={item.ltp} val={item.ema200} currency={c} />
        </div>
      </div>

      {/* Market profile + classic pivot — single horizontal strip */}
      <div className="px-4 py-2.5 border-b border-border/70 bg-muted/20 flex items-center justify-between gap-3 text-xs">
        <ColTitle>Market Profile</ColTitle>
        <div className="flex items-center gap-3 font-mono tabular-nums">
          <ProfileStat label="VAL" value={item.val} currency={c} />
          <span className="text-muted-foreground/40">·</span>
          <ProfileStat label="POC" value={item.poc} currency={c} bold />
          <span className="text-muted-foreground/40">·</span>
          <ProfileStat label="VAH" value={item.vah} currency={c} />
          <span className="text-muted-foreground/40">|</span>
          <ProfileStat label="Pivot" value={item.pivot} currency={c} bold />
        </div>
      </div>

      {/* Pivot ladder — horizontal scale of S3..R3 with LTP marker */}
      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <ColTitle>Key Levels (Floor Pivots)</ColTitle>
          {nearest && (
            <span className="text-[11px] font-mono text-muted-foreground">
              LTP {nearest.distancePct >= 0 ? "↓" : "↑"}{Math.abs(nearest.distancePct).toFixed(2)}% to{" "}
              <span className="text-foreground font-semibold">{nearest.label}</span>
            </span>
          )}
        </div>
        <PivotLadder
          ltp={item.ltp}
          supports={item.support}
          pivot={item.pivot}
          resistances={item.resistance}
          currency={c}
        />
      </div>

      {/* Analytics provenance (chart-derived fields, separate from the quote) */}
      {item.analytics && <AnalyticsProvenanceNote analytics={item.analytics} />}

      {/* Notes (proxy disclosures, partial-data warnings) */}
      {item.notes && item.notes.length > 0 && (
        <div className="px-4 py-2 border-t border-amber-500/30 bg-amber-500/5 text-[11px] text-amber-500 flex items-start gap-1.5">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <div className="leading-snug">{item.notes.join(" · ")}</div>
        </div>
      )}
    </div>
  );
}

/** Honest provenance footer for the chart-derived analytics (52W / EMAs /
 *  pivots / VWAP). Surfaces when those numbers come from a delayed secondary
 *  feed rather than a live trusted source, and never overstates trust. */
function AnalyticsProvenanceNote({ analytics }: { analytics: IndexAnalyticsProvenance }) {
  const { trustTier, sourceProvider, delayed, missingReason, isStale, warnings } = analytics;

  if (trustTier === "unavailable") {
    return (
      <div className="px-4 py-2 border-t border-border/70 bg-muted/30 text-[11px] text-muted-foreground leading-snug">
        Analytics (52W · EMAs · pivots · VWAP): {missingReason ?? "unavailable"}.
        {warnings.length > 0 && <> {warnings.join(" · ")}</>}
      </div>
    );
  }

  const providerLabel = sourceProvider === "kite" ? "Zerodha (live)" : sourceProvider === "yahoo" ? "Yahoo (delayed)" : "secondary source";
  const tierLabel = trustTier === "authoritative" ? "Trusted" : "Reference only — not for signals/trade decisions";

  return (
    <div className="px-4 py-2 border-t border-border/70 bg-muted/30 text-[11px] text-muted-foreground leading-snug flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span className={`font-semibold px-1.5 py-0.5 rounded border ${trustTier === "authoritative" ? "text-emerald-500 border-emerald-500/30 bg-emerald-500/10" : "text-amber-500 border-amber-500/30 bg-amber-500/10"}`}>
        {tierLabel}
      </span>
      <span>Analytics source: {providerLabel}{delayed && sourceProvider !== "yahoo" ? " · delayed" : ""}.</span>
      {isStale && <span className="text-amber-500">Stale — last bar is several days old.</span>}
      {warnings.length > 0 && <span>{warnings.join(" · ")}</span>}
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────── */
/*  Sub-components                                                       */
/* ───────────────────────────────────────────────────────────────────── */

function ColTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
      {children}
    </div>
  );
}

function KvRow({ k, v, valueClass = "", bold = false }: { k: string; v: string; valueClass?: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 leading-tight">
      <span className="text-muted-foreground">{k}</span>
      <span className={`font-mono tabular-nums truncate ${bold ? "font-semibold" : ""} ${valueClass}`}>
        {v}
      </span>
    </div>
  );
}

function EmaCell({ label, ltp, val, currency }: { label: string; ltp?: number; val?: number; currency: string }) {
  const direction =
    ltp == null || val == null
      ? null
      : ltp >= val ? "above" : "below";
  const tone =
    direction === "above" ? "border-emerald-500/40 bg-emerald-500/5"
    : direction === "below" ? "border-rose-500/40 bg-rose-500/5"
    : "border-transparent";
  return (
    <div className={`flex items-center justify-between gap-1.5 px-1.5 py-0.5 rounded border ${tone}`}>
      <span className="text-muted-foreground text-[11px]">{label}</span>
      <span className="font-mono tabular-nums">{currency}{fmt(val)}</span>
      {direction && (
        <span
          className={`text-[11px] leading-none font-bold ${
            direction === "above" ? "text-emerald-500" : "text-rose-500"
          }`}
        >
          {direction === "above" ? "↑" : "↓"}
        </span>
      )}
    </div>
  );
}

function ProfileStat({ label, value, currency, bold = false }: { label: string; value?: number; currency: string; bold?: boolean }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={bold ? "font-semibold" : ""}>{currency}{fmt(value)}</span>
    </span>
  );
}

/** Day Range / 52W Range bar — visual position of LTP between lo and hi. */
function RangeBar({ title, lo, hi, ltp, currency }: { title: string; lo?: number; hi?: number; ltp?: number; currency: string }) {
  const pos = positionBetween(ltp, lo, hi);
  const posPct = pos != null ? Math.round(pos * 100) : null;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-muted-foreground uppercase tracking-wider font-semibold">{title}</span>
        {posPct != null && (
          <span className="font-mono text-muted-foreground">{posPct}% of range</span>
        )}
      </div>
      <div className="relative h-1.5 rounded-full bg-muted overflow-visible">
        {pos != null && (
          <>
            <div
              className="absolute top-0 bottom-0 left-0 rounded-full bg-gradient-to-r from-rose-500/40 via-amber-500/40 to-emerald-500/40"
              style={{ width: "100%" }}
            />
            <div
              className="absolute -top-0.5 -bottom-0.5 w-1 rounded-sm bg-foreground shadow-sm"
              style={{ left: `calc(${pos * 100}% - 2px)` }}
              aria-label={`${title} marker`}
            />
          </>
        )}
      </div>
      <div className="flex items-center justify-between text-[11px] font-mono tabular-nums text-muted-foreground mt-1">
        <span>{currency}{fmt(lo)}</span>
        <span>{currency}{fmt(hi)}</span>
      </div>
    </div>
  );
}

/** Horizontal pivot ladder — S3, S2, S1, P, R1, R2, R3 with LTP marker. */
function PivotLadder({
  ltp, supports, pivot, resistances, currency,
}: {
  ltp?: number;
  supports?: number[];
  pivot?: number;
  resistances?: number[];
  currency: string;
}) {
  // Build ordered list of levels, low → high, with labels.
  const sList = (supports ?? []).slice(0, 3);
  const rList = (resistances ?? []).slice(0, 3);
  const levels: { label: string; level: number }[] = [];
  for (let i = sList.length - 1; i >= 0; i--) {
    if (sList[i] != null) levels.push({ label: `S${i + 1}`, level: sList[i]! });
  }
  if (pivot != null) levels.push({ label: "P", level: pivot });
  for (let i = 0; i < rList.length; i++) {
    if (rList[i] != null) levels.push({ label: `R${i + 1}`, level: rList[i]! });
  }
  if (levels.length < 2) {
    return <div className="text-[11px] text-muted-foreground">Pivot levels unavailable.</div>;
  }

  const min = levels[0]!.level;
  const max = levels[levels.length - 1]!.level;
  const span = Math.max(max - min, 1e-9);
  const ltpPos = ltp != null ? Math.max(0, Math.min(1, (ltp - min) / span)) : null;

  return (
    <div>
      {/* Label row */}
      <div className="relative h-3.5">
        {levels.map((l, i) => {
          const left = ((l.level - min) / span) * 100;
          const isPivot = l.label === "P";
          const isSupp  = l.label.startsWith("S");
          const tone    = isPivot ? "text-foreground" : isSupp ? "text-emerald-500" : "text-rose-500";
          return (
            <span
              key={`lab-${i}`}
              className={`absolute -translate-x-1/2 text-[10px] font-bold uppercase ${tone}`}
              style={{ left: `${left}%` }}
            >
              {l.label}
            </span>
          );
        })}
      </div>

      {/* Track + LTP marker */}
      <div className="relative h-2 my-1">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-border" />
        {levels.map((l, i) => {
          const left = ((l.level - min) / span) * 100;
          const isPivot = l.label === "P";
          const isSupp  = l.label.startsWith("S");
          const dot     = isPivot
            ? "bg-foreground"
            : isSupp
              ? "bg-emerald-500"
              : "bg-rose-500";
          const near = isNear(ltp, l.level);
          return (
            <span
              key={`tick-${i}`}
              className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-2 w-2 rounded-full ${dot} ${near ? "ring-2 ring-foreground/40" : ""}`}
              style={{ left: `${left}%` }}
              aria-label={`${l.label} ${l.level}`}
            />
          );
        })}
        {ltpPos != null && (
          <span
            className="absolute -top-1 -bottom-1 w-0.5 bg-foreground rounded-sm shadow-md"
            style={{ left: `calc(${ltpPos * 100}% - 1px)` }}
            aria-label="LTP marker"
          />
        )}
      </div>

      {/* Value row */}
      <div className="relative h-3.5 mt-0.5">
        {levels.map((l, i) => {
          const left = ((l.level - min) / span) * 100;
          const near = isNear(ltp, l.level);
          return (
            <span
              key={`val-${i}`}
              className={`absolute -translate-x-1/2 text-[10px] font-mono tabular-nums ${near ? "text-foreground font-bold" : "text-muted-foreground"}`}
              style={{ left: `${left}%` }}
            >
              {currency}{fmt(l.level, l.level >= 1000 ? 0 : 2)}
            </span>
          );
        })}
      </div>
    </div>
  );
}
