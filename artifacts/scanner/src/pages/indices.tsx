/**
 * Indices Tab — dedicated dashboard for Indian indices, global benchmarks
 * and commodities with the full per-instrument fact pack
 * (LTP / OHLC / change / 52w extrema / prev OHLC / EMAs 9-200 / VWAP /
 *  VAH-VAL-POC / 3 supports + 3 resistances).
 *
 * Layout:
 *   - Three fixed sections stacked top-to-bottom: India · Global · Commodities
 *   - Each section is a grid of always-expanded instrument cards so the
 *     full fact pack is visible without any click — the user explicitly
 *     wanted no expand/collapse.
 *
 * Visual cues (per spec):
 *   - Green for positive %change, red for negative
 *   - LTP gets a coloured underline when above (green) / below (red) VWAP
 *   - EMA cells get a directional arrow + colour vs price
 *   - S/R bands shade when LTP is within 0.4% of any level
 *
 * Data: refreshes every 5 seconds via the typed React-Query hook against
 * /api/indices. Indian-index LTPs come from the live Kite session when
 * one is authenticated (a small "live" pill is shown), otherwise from
 * Yahoo (~15 min delayed, with a "delayed" pill).
 */

import { useMemo, useState } from "react";
import { useGetIndicesBoard, getGetIndicesBoardQueryKey } from "@workspace/api-client-react";
import type { IndexBoardItem } from "@workspace/api-client-react";
import { Activity, Globe2, Flame, AlertTriangle } from "lucide-react";

type Cat = "INDIA" | "GLOBAL" | "COMMODITY";

const SECTIONS: { key: Cat; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "INDIA",     label: "India",       icon: Activity },
  { key: "GLOBAL",    label: "Global",      icon: Globe2   },
  { key: "COMMODITY", label: "Commodities", icon: Flame    },
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

/** Returns true if `price` is within `tolPct` of `level` (default 0.4%). */
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

function srBandClass(price: number | undefined, level: number | undefined, kind: "support" | "resistance"): string {
  if (!isNear(price, level)) return "";
  return kind === "support"
    ? "ring-1 ring-emerald-500/60 bg-emerald-500/10"
    : "ring-1 ring-rose-500/60 bg-rose-500/10";
}

export default function IndicesPage() {
  const [active, setActive] = useState<Cat>("INDIA");

  const { data, isLoading, error } = useGetIndicesBoard({
    query: {
      queryKey: getGetIndicesBoardQueryKey(),
      refetchInterval: 5_000,
      staleTime: 5_000,
    },
  });

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
    <div className="w-full px-4 py-6 max-w-[1600px] mx-auto">
      <header className="flex items-end justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Indices</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Indian benchmarks, global indices and commodities — LTP, market profile, key levels.
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
                  Live (Kite session active)
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
      {isLoading && (
        <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
          Loading indices board…
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/5 p-4 text-sm text-rose-500 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          Failed to load indices: {(error as Error).message}
        </div>
      )}

      {/* Section selector — clickable chips for India / Global / Commodities */}
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
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${isActive ? "bg-primary-foreground/20" : "bg-muted text-muted-foreground"}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Active section — fixed grid of instrument cards */}
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
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {activeRows.map(item => (
                <InstrumentCard key={item.key} item={item} />
              ))}
            </div>
          )}
        </section>
      )}

      <p className="text-[11px] text-muted-foreground mt-6 leading-relaxed">
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
  return (
    <div
      data-testid={`indices-card-${item.key}`}
      className="rounded-lg border border-border bg-card overflow-hidden flex flex-col"
    >
      {/* Card header — name + LTP + change */}
      <div className="px-3.5 py-3 border-b border-border/70 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-sm truncate">{item.name}</div>
          <div className="text-[10px] font-mono text-muted-foreground/80 mt-0.5 flex items-center gap-1.5 flex-wrap">
            <span>{item.yahooSymbol}</span>
            {item.source === "kite" && (
              <span className="px-1 rounded bg-emerald-500/15 text-emerald-500 text-[9px] font-bold tracking-wide">LIVE</span>
            )}
            {item.source === "yahoo" && (
              <span className="px-1 rounded bg-muted text-muted-foreground text-[9px] font-bold tracking-wide">DELAYED</span>
            )}
            {item.source === null && (
              <span className="px-1 rounded bg-rose-500/15 text-rose-500 text-[9px] font-bold tracking-wide">NO DATA</span>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-mono tabular-nums text-base font-semibold leading-tight">
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
          <div className={`font-mono tabular-nums text-xs font-semibold mt-0.5 ${changeColor(item.change)}`}>
            {pct(item.changePercent)}
            <span className="ml-1 text-[10px] font-normal opacity-80">
              ({item.change != null ? (item.change > 0 ? "+" : "") + fmt(item.change) : "—"})
            </span>
          </div>
        </div>
      </div>

      {/* 3-column body — Session OHLC · Prev / 52w · Indicators */}
      <div className="grid grid-cols-3 gap-x-3 gap-y-1 px-3.5 py-3 text-xs">
        <div className="space-y-1">
          <ColTitle>Session</ColTitle>
          <Row label="O"   value={`${c}${fmt(item.open)}`} />
          <Row label="H"   value={`${c}${fmt(item.high)}`} />
          <Row label="L"   value={`${c}${fmt(item.low)}`} />
          <Row label="LTP" value={`${c}${fmt(item.ltp)}`} bold />
        </div>
        <div className="space-y-1">
          <ColTitle>Prev / 52W</ColTitle>
          <Row label="O"   value={`${c}${fmt(item.prevOpen)}`} />
          <Row label="H"   value={`${c}${fmt(item.prevHigh)}`} />
          <Row label="L"   value={`${c}${fmt(item.prevLow)}`} />
          <Row label="C"   value={`${c}${fmt(item.prevClose)}`} bold />
          <Row label="52H" value={`${c}${fmt(item.fiftyTwoWeekHigh)}`} />
          <Row label="52L" value={`${c}${fmt(item.fiftyTwoWeekLow)}`} />
        </div>
        <div className="space-y-1">
          <ColTitle>Indicators</ColTitle>
          <EmaRow label="EMA 9"   ltp={item.ltp} val={item.ema9}   currency={c} />
          <EmaRow label="EMA 20"  ltp={item.ltp} val={item.ema20}  currency={c} />
          <EmaRow label="EMA 50"  ltp={item.ltp} val={item.ema50}  currency={c} />
          <EmaRow label="EMA 100" ltp={item.ltp} val={item.ema100} currency={c} />
          <EmaRow label="EMA 200" ltp={item.ltp} val={item.ema200} currency={c} />
          <Row
            label="VWAP"
            value={`${c}${fmt(item.vwap)}`}
            bold
            valueClass={
              item.ltp != null && item.vwap != null
                ? (item.ltp >= item.vwap ? "text-emerald-500" : "text-rose-500")
                : ""
            }
          />
        </div>
      </div>

      {/* Profile + Pivot */}
      <div className="px-3.5 py-2.5 border-t border-border/70 bg-muted/20 grid grid-cols-4 gap-x-3 text-xs">
        <Row label="VAH"   value={`${c}${fmt(item.vah)}`} />
        <Row label="POC"   value={`${c}${fmt(item.poc)}`} bold />
        <Row label="VAL"   value={`${c}${fmt(item.val)}`} />
        <Row label="Pivot" value={`${c}${fmt(item.pivot)}`} bold />
      </div>

      {/* S/R bands */}
      <div className="px-3.5 py-2.5 border-t border-border/70 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <div>
          <ColTitle>Resistance</ColTitle>
          {(item.resistance ?? []).length > 0 ? (
            (item.resistance ?? []).map((r, i) => (
              <div
                key={`r${i}`}
                className={`flex items-center justify-between font-mono tabular-nums px-1.5 py-0.5 rounded ${srBandClass(item.ltp, r, "resistance")}`}
              >
                <span className="text-muted-foreground">R{i + 1}</span>
                <span>{c}{fmt(r)}</span>
              </div>
            ))
          ) : (
            <div className="text-[11px] text-muted-foreground">—</div>
          )}
        </div>
        <div>
          <ColTitle>Support</ColTitle>
          {(item.support ?? []).length > 0 ? (
            (item.support ?? []).map((s, i) => (
              <div
                key={`s${i}`}
                className={`flex items-center justify-between font-mono tabular-nums px-1.5 py-0.5 rounded ${srBandClass(item.ltp, s, "support")}`}
              >
                <span className="text-muted-foreground">S{i + 1}</span>
                <span>{c}{fmt(s)}</span>
              </div>
            ))
          ) : (
            <div className="text-[11px] text-muted-foreground">—</div>
          )}
        </div>
      </div>

      {/* Notes (partial-data warnings, proxy disclosures) */}
      {item.notes && item.notes.length > 0 && (
        <div className="px-3.5 py-2 border-t border-amber-500/30 bg-amber-500/5 text-[10px] text-amber-500 flex items-start gap-1.5">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <div className="leading-snug">{item.notes.join(" · ")}</div>
        </div>
      )}
    </div>
  );
}

function ColTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold mb-1">
      {children}
    </div>
  );
}

function Row({ label, value, valueClass = "", bold = false }: { label: string; value: string; valueClass?: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono tabular-nums truncate ${bold ? "font-semibold" : ""} ${valueClass}`}>
        {value}
      </span>
    </div>
  );
}

function EmaRow({ label, ltp, val, currency }: { label: string; ltp?: number; val?: number; currency: string }) {
  const direction =
    ltp == null || val == null
      ? null
      : ltp >= val ? "above" : "below";
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className="font-mono tabular-nums">{currency}{fmt(val)}</span>
        {direction && (
          <span
            className={`text-[8px] px-0.5 rounded leading-none font-bold ${
              direction === "above"
                ? "bg-emerald-500/15 text-emerald-500"
                : "bg-rose-500/15 text-rose-500"
            }`}
          >
            {direction === "above" ? "↑" : "↓"}
          </span>
        )}
      </span>
    </div>
  );
}
