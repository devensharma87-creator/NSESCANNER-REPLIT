/**
 * Indices Tab — dedicated dashboard for Indian indices, global benchmarks
 * and commodities with the full per-instrument fact pack
 * (LTP / OHLC / change / 52w extrema / prev OHLC / EMAs 9-200 / VWAP /
 *  VAH-VAL-POC / 3 supports + 3 resistances).
 *
 * Layout:
 *   - Three top filter chips: India · Global · Commodities
 *   - Compact table view (Name, LTP, %ΔΔ, VWAP, EMA20)
 *   - Click a row to expand into a detail card with full OHLC / prev OHLC
 *     / all five EMAs / market-profile band / S1-S3 + R1-R3
 *
 * Visual cues (per spec):
 *   - Green for positive %change, red for negative
 *   - LTP gets a coloured underline when above (green) / below (red) VWAP
 *   - EMA cells get an outline when price is above (bull) / below (bear) EMA
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
import { ChevronDown, ChevronRight, Activity, Globe2, Flame, AlertTriangle } from "lucide-react";

type Cat = "INDIA" | "GLOBAL" | "COMMODITY";

const CATEGORY_TABS: { key: Cat; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
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

/** Returns "near" if `price` is within `tolPct` of `level` (default 0.4%). */
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

function emaCellClass(price: number | undefined, emaVal: number | undefined): string {
  if (price == null || emaVal == null) return "border-transparent";
  return price >= emaVal
    ? "border-emerald-500/40 bg-emerald-500/5"
    : "border-rose-500/40 bg-rose-500/5";
}

function srBandClass(price: number | undefined, level: number | undefined, kind: "support" | "resistance"): string {
  if (!isNear(price, level)) return "";
  return kind === "support"
    ? "ring-1 ring-emerald-500/60 bg-emerald-500/10"
    : "ring-1 ring-rose-500/60 bg-rose-500/10";
}

export default function IndicesPage() {
  const [active, setActive] = useState<Cat>("INDIA");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading, error } = useGetIndicesBoard({
    query: {
      queryKey: getGetIndicesBoardQueryKey(),
      refetchInterval: 5_000,
      staleTime: 5_000,
    },
  });

  const items = data?.items ?? [];
  const filtered = useMemo(
    () => items.filter(i => i.category === active),
    [items, active],
  );

  const toggle = (key: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  return (
    <div className="w-full px-4 py-6 max-w-[1400px] mx-auto">
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

      {/* Filter chips */}
      <div className="flex items-center gap-2 mb-4">
        {CATEGORY_TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = tab.key === active;
          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActive(tab.key)}
              data-testid={`indices-tab-${tab.key.toLowerCase()}`}
              className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-foreground/70 hover:text-foreground border-border hover:border-foreground/40"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          );
        })}
        <div className="ml-auto text-[11px] font-mono text-muted-foreground">
          {filtered.length} instrument{filtered.length === 1 ? "" : "s"}
        </div>
      </div>

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

      {/* Compact table */}
      {!isLoading && !error && (
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          <div className="grid grid-cols-[2fr_repeat(4,1fr)_auto] gap-4 px-4 py-2.5 bg-muted/40 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold border-b border-border">
            <div>Name</div>
            <div className="text-right">LTP</div>
            <div className="text-right">% Change</div>
            <div className="text-right">VWAP</div>
            <div className="text-right">EMA 20</div>
            <div className="w-5" />
          </div>

          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No instruments in this category.
            </div>
          )}

          {filtered.map(item => {
            const isOpen = expanded.has(item.key);
            const aboveVwap = item.ltp != null && item.vwap != null && item.ltp >= item.vwap;
            return (
              <div key={item.key} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  onClick={() => toggle(item.key)}
                  data-testid={`indices-row-${item.key}`}
                  className="w-full grid grid-cols-[2fr_repeat(4,1fr)_auto] gap-4 px-4 py-3 hover:bg-muted/30 transition-colors text-left items-center"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{item.name}</div>
                    <div className="text-[10px] font-mono text-muted-foreground/80 mt-0.5 flex items-center gap-2">
                      <span>{item.yahooSymbol}</span>
                      {item.source === "kite" && (
                        <span className="px-1 rounded bg-emerald-500/15 text-emerald-500 text-[9px]">LIVE</span>
                      )}
                      {item.source === "yahoo" && (
                        <span className="px-1 rounded bg-muted text-muted-foreground text-[9px]">DELAYED</span>
                      )}
                    </div>
                  </div>
                  <div className="text-right font-mono tabular-nums text-sm">
                    <span
                      className={
                        item.vwap != null && item.ltp != null
                          ? `border-b-2 ${aboveVwap ? "border-emerald-500/70" : "border-rose-500/70"} pb-0.5`
                          : ""
                      }
                    >
                      {item.currency}{fmt(item.ltp)}
                    </span>
                  </div>
                  <div className={`text-right font-mono tabular-nums text-sm font-semibold ${changeColor(item.change)}`}>
                    {pct(item.changePercent)}
                    <div className="text-[10px] font-normal opacity-80">
                      {item.change != null ? (item.change > 0 ? "+" : "") + fmt(item.change) : "—"}
                    </div>
                  </div>
                  <div className="text-right font-mono tabular-nums text-sm">{fmt(item.vwap)}</div>
                  <div className={`text-right font-mono tabular-nums text-sm rounded px-1.5 py-0.5 border ${emaCellClass(item.ltp, item.ema20)}`}>
                    {fmt(item.ema20)}
                  </div>
                  <div className="w-5 text-muted-foreground">
                    {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  </div>
                </button>

                {isOpen && <ExpandedDetail item={item} />}
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground mt-4 leading-relaxed">
        Pivots / supports / resistances are classic floor-trader levels derived from the previous session's OHLC.
        VAH / VAL / POC come from a 24-bin volume profile over the most recent ~6.5 hours of intraday bars.
        Daily EMAs are computed on closing prices and require ≥ 200 daily bars for EMA200 to populate.
      </p>
    </div>
  );
}

/* ───────────────────────────────────────────────────────────────────── */
/*  Expanded detail card                                                 */
/* ───────────────────────────────────────────────────────────────────── */

function ExpandedDetail({ item }: { item: IndexBoardItem }) {
  const c = item.currency;
  return (
    <div className="px-4 py-4 bg-muted/20 border-t border-border/60 grid grid-cols-1 lg:grid-cols-4 gap-4">
      {/* Today / Prev OHLC */}
      <Section title="Session OHLC">
        <Row label="Open"  value={`${c}${fmt(item.open)}`} />
        <Row label="High"  value={`${c}${fmt(item.high)}`} />
        <Row label="Low"   value={`${c}${fmt(item.low)}`} />
        <Row label="LTP"   value={`${c}${fmt(item.ltp)}`} bold />
        <Row label="Change" value={pct(item.changePercent)} valueClass={changeColor(item.change)} />
      </Section>

      <Section title="Previous Session">
        <Row label="Prev Open"  value={`${c}${fmt(item.prevOpen)}`} />
        <Row label="Prev High"  value={`${c}${fmt(item.prevHigh)}`} />
        <Row label="Prev Low"   value={`${c}${fmt(item.prevLow)}`} />
        <Row label="Prev Close" value={`${c}${fmt(item.prevClose)}`} bold />
        <Row label="52W High"   value={`${c}${fmt(item.fiftyTwoWeekHigh)}`} />
        <Row label="52W Low"    value={`${c}${fmt(item.fiftyTwoWeekLow)}`} />
      </Section>

      {/* EMAs + VWAP + Profile */}
      <Section title="Indicators (Daily EMAs · Session VWAP)">
        <EmaRow label="EMA 9"   ltp={item.ltp} val={item.ema9}   currency={c} />
        <EmaRow label="EMA 20"  ltp={item.ltp} val={item.ema20}  currency={c} />
        <EmaRow label="EMA 50"  ltp={item.ltp} val={item.ema50}  currency={c} />
        <EmaRow label="EMA 100" ltp={item.ltp} val={item.ema100} currency={c} />
        <EmaRow label="EMA 200" ltp={item.ltp} val={item.ema200} currency={c} />
        <Row label="VWAP" value={`${c}${fmt(item.vwap)}`} bold
             valueClass={
               item.ltp != null && item.vwap != null
                 ? (item.ltp >= item.vwap ? "text-emerald-500" : "text-rose-500")
                 : ""
             } />
      </Section>

      <Section title="Market Profile · Key Levels">
        <Row label="VAH" value={`${c}${fmt(item.vah)}`} />
        <Row label="POC" value={`${c}${fmt(item.poc)}`} bold />
        <Row label="VAL" value={`${c}${fmt(item.val)}`} />
        <Row label="Pivot" value={`${c}${fmt(item.pivot)}`} bold />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Resistance</div>
            {(item.resistance ?? []).map((r, i) => (
              <div key={`r${i}`} className={`flex items-center justify-between font-mono text-xs px-1.5 py-0.5 rounded ${srBandClass(item.ltp, r, "resistance")}`}>
                <span className="text-muted-foreground">R{i + 1}</span>
                <span>{c}{fmt(r)}</span>
              </div>
            ))}
            {(item.resistance ?? []).length === 0 && (
              <div className="text-[11px] text-muted-foreground">—</div>
            )}
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Support</div>
            {(item.support ?? []).map((s, i) => (
              <div key={`s${i}`} className={`flex items-center justify-between font-mono text-xs px-1.5 py-0.5 rounded ${srBandClass(item.ltp, s, "support")}`}>
                <span className="text-muted-foreground">S{i + 1}</span>
                <span>{c}{fmt(s)}</span>
              </div>
            ))}
            {(item.support ?? []).length === 0 && (
              <div className="text-[11px] text-muted-foreground">—</div>
            )}
          </div>
        </div>
      </Section>

      {/* Notes (partial-data warnings) */}
      {item.notes && item.notes.length > 0 && (
        <div className="lg:col-span-4 mt-1 flex items-start gap-2 px-3 py-2 rounded border border-amber-500/30 bg-amber-500/5 text-[11px] text-amber-500">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div className="leading-relaxed">
            <span className="font-semibold">Data notes:</span> {item.notes.join(" · ")}
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({ label, value, valueClass = "", bold = false }: { label: string; value: string; valueClass?: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono tabular-nums ${bold ? "font-semibold" : ""} ${valueClass}`}>{value}</span>
    </div>
  );
}

function EmaRow({ label, ltp, val, currency }: { label: string; ltp?: number; val?: number; currency: string }) {
  const aboveOrBelow =
    ltp == null || val == null
      ? null
      : ltp >= val ? "above" : "below";
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-2">
        <span className="font-mono tabular-nums">{currency}{fmt(val)}</span>
        {aboveOrBelow && (
          <span className={`text-[9px] px-1 py-0.5 rounded uppercase font-bold ${aboveOrBelow === "above" ? "bg-emerald-500/15 text-emerald-500" : "bg-rose-500/15 text-rose-500"}`}>
            {aboveOrBelow === "above" ? "↑" : "↓"}
          </span>
        )}
      </span>
    </div>
  );
}
