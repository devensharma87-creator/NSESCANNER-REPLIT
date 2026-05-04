import type { IndexBoardItem, HomeIndexEnrichment } from "@workspace/api-client-react";
import { Sparkline, computeBiasScore } from "./index-tabs";

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function pctStr(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(2)}%`;
}

function changeColor(n: number | undefined): string {
  if (n == null) return "text-muted-foreground";
  if (n > 0) return "text-emerald-500";
  if (n < 0) return "text-rose-500";
  return "text-muted-foreground";
}

function isNear(price: number | undefined, level: number | undefined, tolPct = 0.4): boolean {
  if (price == null || level == null || level === 0) return false;
  return Math.abs(price - level) / level * 100 <= tolPct;
}

function positionBetween(value: number | undefined, lo: number | undefined, hi: number | undefined): number | null {
  if (value == null || lo == null || hi == null || hi <= lo) return null;
  return Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
}

function computeCPR(prevHigh: number | undefined, prevLow: number | undefined, prevClose: number | undefined) {
  if (prevHigh == null || prevLow == null || prevClose == null) return null;
  const pivot = (prevHigh + prevLow + prevClose) / 3;
  const bc = (prevHigh + prevLow) / 2;
  const tc = 2 * pivot - bc;
  const width = Math.abs(tc - bc);
  const widthPct = pivot > 0 ? (width / pivot) * 100 : 0;
  return { pivot, bc, tc, width, widthPct, narrow: widthPct < 0.5 };
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">{children}</div>;
}

function KvRow({ k, v, cls = "", bold = false }: { k: string; v: string; cls?: string; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 leading-tight text-xs">
      <span className="text-muted-foreground">{k}</span>
      <span className={`font-mono tabular-nums truncate ${bold ? "font-semibold" : ""} ${cls}`}>{v}</span>
    </div>
  );
}

function RangeBar({ title, lo, hi, ltp, currency }: { title: string; lo?: number; hi?: number; ltp?: number; currency: string }) {
  const pos = positionBetween(ltp, lo, hi);
  const posPct = pos != null ? Math.round(pos * 100) : null;
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-muted-foreground uppercase tracking-wider font-semibold">{title}</span>
        {posPct != null && <span className="font-mono text-muted-foreground">{posPct}%</span>}
      </div>
      <div className="relative h-1.5 rounded-full bg-muted overflow-visible">
        {pos != null && (
          <>
            <div className="absolute top-0 bottom-0 left-0 rounded-full bg-gradient-to-r from-rose-500/40 via-amber-500/40 to-emerald-500/40" style={{ width: "100%" }} />
            <div className="absolute -top-0.5 -bottom-0.5 w-1 rounded-sm bg-foreground shadow-sm" style={{ left: `calc(${pos * 100}% - 2px)` }} />
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

function EmaCell({ label, ltp, val, currency }: { label: string; ltp?: number; val?: number; currency: string }) {
  const direction = ltp == null || val == null ? null : ltp >= val ? "above" : "below";
  const tone = direction === "above" ? "border-emerald-500/40 bg-emerald-500/5" : direction === "below" ? "border-rose-500/40 bg-rose-500/5" : "border-transparent";
  return (
    <div className={`flex items-center justify-between gap-1.5 px-1.5 py-0.5 rounded border ${tone}`}>
      <span className="text-muted-foreground text-[11px]">{label}</span>
      <span className="font-mono tabular-nums text-xs">{currency}{fmt(val)}</span>
      {direction && (
        <span className={`text-[11px] leading-none font-bold ${direction === "above" ? "text-emerald-500" : "text-rose-500"}`}>
          {direction === "above" ? "↑" : "↓"}
        </span>
      )}
    </div>
  );
}

function MomentumTile({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="rounded border border-border/50 bg-background/40 px-2 py-1.5 text-center">
      <div className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">{label}</div>
      <div className={`text-sm font-mono font-bold tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[9px] font-mono text-muted-foreground">{sub}</div>}
    </div>
  );
}

function OptionsStrip({ enrichment, currency }: { enrichment?: HomeIndexEnrichment; currency: string }) {
  if (!enrichment || enrichment.pcrOi == null) return null;

  return (
    <div className="space-y-1.5">
      <SectionTitle>Options Layer</SectionTitle>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <MomentumTile
          label="PCR (OI)"
          value={enrichment.pcrOi?.toFixed(2) ?? "—"}
          color={(enrichment.pcrOi ?? 0) >= 1.0 ? "text-emerald-500" : (enrichment.pcrOi ?? 0) <= 0.7 ? "text-rose-500" : "text-foreground"}
          sub={(enrichment.pcrOi ?? 0) >= 1.3 ? "Bullish" : (enrichment.pcrOi ?? 0) <= 0.7 ? "Bearish" : "Neutral"}
        />
        <MomentumTile
          label="Max Pain"
          value={`${currency}${fmt(enrichment.maxPain, 0)}`}
          color="text-foreground"
        />
        <MomentumTile
          label="ATM IV"
          value={enrichment.atmIv != null ? `${enrichment.atmIv.toFixed(1)}%` : "—"}
          color="text-foreground"
        />
        <MomentumTile
          label="F&O Bias"
          value={enrichment.optionsBias ?? "—"}
          color={enrichment.optionsBias === "BULLISH" ? "text-emerald-500" : enrichment.optionsBias === "BEARISH" ? "text-rose-500" : "text-muted-foreground"}
        />
      </div>
      {(enrichment.topCeWalls.length > 0 || enrichment.topPeWalls.length > 0) && (
        <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
          <div className="rounded border border-rose-500/20 bg-rose-500/5 px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wider text-rose-500/70 font-semibold mb-1">CE Walls (Resistance)</div>
            {enrichment.topCeWalls.map(w => (
              <div key={w.strike} className="flex justify-between">
                <span>{currency}{fmt(w.strike, 0)}</span>
                <span className="text-muted-foreground">{(w.oi / 1000).toFixed(0)}K</span>
              </div>
            ))}
          </div>
          <div className="rounded border border-emerald-500/20 bg-emerald-500/5 px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wider text-emerald-500/70 font-semibold mb-1">PE Walls (Support)</div>
            {enrichment.topPeWalls.map(w => (
              <div key={w.strike} className="flex justify-between">
                <span>{currency}{fmt(w.strike, 0)}</span>
                <span className="text-muted-foreground">{(w.oi / 1000).toFixed(0)}K</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PivotLadder({
  ltp, supports, pivot, resistances, currency,
}: {
  ltp?: number;
  supports?: number[];
  pivot?: number;
  resistances?: number[];
  currency: string;
}) {
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
  if (levels.length < 2) return <div className="text-[11px] text-muted-foreground">Pivot levels unavailable.</div>;

  const min = levels[0]!.level;
  const max = levels[levels.length - 1]!.level;
  const span = Math.max(max - min, 1e-9);
  const ltpPos = ltp != null ? Math.max(0, Math.min(1, (ltp - min) / span)) : null;

  return (
    <div>
      <div className="relative h-3.5">
        {levels.map((l, i) => {
          const left = ((l.level - min) / span) * 100;
          const isPivot = l.label === "P";
          const isSupp = l.label.startsWith("S");
          const tone = isPivot ? "text-foreground" : isSupp ? "text-emerald-500" : "text-rose-500";
          return <span key={`lab-${i}`} className={`absolute -translate-x-1/2 text-[10px] font-bold uppercase ${tone}`} style={{ left: `${left}%` }}>{l.label}</span>;
        })}
      </div>
      <div className="relative h-2 my-1">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-px bg-border" />
        {levels.map((l, i) => {
          const left = ((l.level - min) / span) * 100;
          const isPivot = l.label === "P";
          const isSupp = l.label.startsWith("S");
          const dot = isPivot ? "bg-foreground" : isSupp ? "bg-emerald-500" : "bg-rose-500";
          const near = isNear(ltp, l.level);
          return <span key={`tick-${i}`} className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 h-2 w-2 rounded-full ${dot} ${near ? "ring-2 ring-foreground/40" : ""}`} style={{ left: `${left}%` }} />;
        })}
        {ltpPos != null && <span className="absolute -top-1 -bottom-1 w-0.5 bg-foreground rounded-sm shadow-md" style={{ left: `calc(${ltpPos * 100}% - 1px)` }} />}
      </div>
      <div className="relative h-3.5 mt-0.5">
        {levels.map((l, i) => {
          const left = ((l.level - min) / span) * 100;
          const near = isNear(ltp, l.level);
          return <span key={`val-${i}`} className={`absolute -translate-x-1/2 text-[10px] font-mono tabular-nums ${near ? "text-foreground font-bold" : "text-muted-foreground"}`} style={{ left: `${left}%` }}>{currency}{fmt(l.level, l.level >= 1000 ? 0 : 2)}</span>;
        })}
      </div>
    </div>
  );
}

export default function IndexExpandedPanel({
  item,
  enrichment,
  allIndices: _allIndices,
  enrichmentMap: _enrichmentMap,
}: {
  item: IndexBoardItem;
  enrichment?: HomeIndexEnrichment;
  allIndices: IndexBoardItem[];
  enrichmentMap: Map<string, HomeIndexEnrichment>;
}) {
  const c = item.currency;
  const bias = computeBiasScore(item, enrichment);
  const upDay = (item.change ?? 0) > 0;
  const downDay = (item.change ?? 0) < 0;
  const borderTone = upDay ? "border-l-4 border-l-emerald-500/70" : downDay ? "border-l-4 border-l-rose-500/70" : "border-l-4 border-l-border";
  const aboveVwap = item.ltp != null && item.vwap != null && item.ltp >= item.vwap;
  const sparkColor = upDay ? "#22c55e" : "#ef4444";

  const cpr = computeCPR(item.prevHigh, item.prevLow, item.prevClose);

  const emaLabels = [
    { p: 9, v: item.ema9 }, { p: 20, v: item.ema20 }, { p: 50, v: item.ema50 },
    { p: 100, v: item.ema100 }, { p: 200, v: item.ema200 },
  ];
  const emaDefined = emaLabels.filter(e => e.v != null);
  const emaAbove = emaDefined.filter(e => item.ltp != null && item.ltp >= e.v!).length;
  const emaAlignStr = emaDefined.length > 0 ? `${emaAbove}/${emaDefined.length}` : "—";
  const emaAlignColor = emaDefined.length > 0
    ? (emaAbove / emaDefined.length >= 0.8 ? "text-emerald-500" : emaAbove / emaDefined.length <= 0.2 ? "text-rose-500" : "text-foreground")
    : "text-muted-foreground";

  const nearest = (() => {
    if (item.ltp == null) return null;
    const candidates: { label: string; level: number }[] = [];
    (item.support ?? []).forEach((v, i) => v != null && candidates.push({ label: `S${i + 1}`, level: v }));
    if (item.pivot != null) candidates.push({ label: "Pivot", level: item.pivot });
    (item.resistance ?? []).forEach((v, i) => v != null && candidates.push({ label: `R${i + 1}`, level: v }));
    if (candidates.length === 0) return null;
    let best = candidates[0]!;
    let bestAbs = Math.abs(item.ltp - best.level);
    for (const cc of candidates) { const d = Math.abs(item.ltp - cc.level); if (d < bestAbs) { best = cc; bestAbs = d; } }
    return { label: best.label, level: best.level, distancePct: ((best.level - item.ltp) / item.ltp) * 100 };
  })();

  return (
    <div className={`rounded-lg border border-border bg-card overflow-hidden ${borderTone}`}>
      <div className="px-4 py-3 border-b border-border/70 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h3 className="text-xl font-bold leading-tight">{item.name}</h3>
            <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded border ${bias.color}`}>
              {bias.label} · {bias.score}/5
            </span>
          </div>
          <div className="text-[11px] font-mono text-muted-foreground/80 mt-1 flex items-center gap-2">
            <span>{item.yahooSymbol}</span>
            <span className="text-muted-foreground/40">·</span>
            <span>EMA Stack: <span className={`font-bold ${emaAlignColor}`}>{emaAlignStr} {emaAbove >= (emaDefined.length * 0.8) ? "BULL" : emaAbove <= (emaDefined.length * 0.2) ? "BEAR" : "MIXED"}</span></span>
          </div>
        </div>
        <div className="text-right shrink-0 flex items-end gap-3">
          {enrichment?.sparkline && enrichment.sparkline.length > 2 && (
            <Sparkline data={enrichment.sparkline} width={120} height={36} color={sparkColor} />
          )}
          <div>
            <div className="font-mono tabular-nums text-2xl font-bold leading-none">
              <span className={item.vwap != null && item.ltp != null ? `border-b-2 ${aboveVwap ? "border-emerald-500/70" : "border-rose-500/70"} pb-0.5` : ""}>
                {c}{fmt(item.ltp)}
              </span>
            </div>
            <div className={`font-mono tabular-nums text-sm font-semibold mt-1 ${changeColor(item.change)}`}>
              {pctStr(item.changePercent)}
              <span className="ml-1.5 text-[11px] font-normal opacity-80">
                ({item.change != null ? (item.change > 0 ? "+" : "") + fmt(item.change) : "—"})
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
        <div className="px-4 py-3 border-b lg:border-r border-border/70 space-y-2.5">
          <RangeBar title="Day Range" lo={item.low} hi={item.high} ltp={item.ltp} currency={c} />
          <RangeBar title="52W Range" lo={item.fiftyTwoWeekLow} hi={item.fiftyTwoWeekHigh} ltp={item.ltp} currency={c} />
        </div>

        <div className="px-4 py-3 border-b border-border/70">
          <div className="grid grid-cols-2 gap-x-4 text-xs">
            <div>
              <SectionTitle>Session</SectionTitle>
              <KvRow k="O" v={`${c}${fmt(item.open)}`} />
              <KvRow k="H" v={`${c}${fmt(item.high)}`} />
              <KvRow k="L" v={`${c}${fmt(item.low)}`} />
              <KvRow
                k="VWAP"
                v={`${c}${fmt(item.vwap)}`}
                bold
                cls={item.ltp != null && item.vwap != null ? (item.ltp >= item.vwap ? "text-emerald-500" : "text-rose-500") : ""}
              />
            </div>
            <div>
              <SectionTitle>Previous</SectionTitle>
              <KvRow k="O" v={`${c}${fmt(item.prevOpen)}`} />
              <KvRow k="H" v={`${c}${fmt(item.prevHigh)}`} />
              <KvRow k="L" v={`${c}${fmt(item.prevLow)}`} />
              <KvRow k="C" v={`${c}${fmt(item.prevClose)}`} bold />
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
        <div className="px-4 py-2.5 border-b lg:border-r border-border/70">
          <div className="flex items-center justify-between mb-1.5">
            <SectionTitle>Daily EMAs (vs price)</SectionTitle>
            <span className={`text-[11px] font-mono font-bold ${emaAlignColor}`}>{emaAlignStr}</span>
          </div>
          <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-xs">
            <EmaCell label="9" ltp={item.ltp} val={item.ema9} currency={c} />
            <EmaCell label="20" ltp={item.ltp} val={item.ema20} currency={c} />
            <EmaCell label="50" ltp={item.ltp} val={item.ema50} currency={c} />
            <EmaCell label="100" ltp={item.ltp} val={item.ema100} currency={c} />
            <EmaCell label="200" ltp={item.ltp} val={item.ema200} currency={c} />
          </div>
        </div>

        <div className="px-4 py-2.5 border-b border-border/70">
          <SectionTitle>Momentum Cluster</SectionTitle>
          <div className="grid grid-cols-4 gap-2">
            <MomentumTile
              label="RSI (14)"
              value={enrichment?.rsi14?.toFixed(1) ?? "—"}
              color={(enrichment?.rsi14 ?? 50) >= 70 ? "text-rose-500" : (enrichment?.rsi14 ?? 50) <= 30 ? "text-emerald-500" : "text-foreground"}
              sub={(enrichment?.rsi14 ?? 50) >= 70 ? "Overbought" : (enrichment?.rsi14 ?? 50) <= 30 ? "Oversold" : "Neutral"}
            />
            <MomentumTile
              label="ADX (14)"
              value={enrichment?.adx14?.toFixed(1) ?? "—"}
              color={(enrichment?.adx14 ?? 0) >= 25 ? "text-primary" : "text-muted-foreground"}
              sub={(enrichment?.adx14 ?? 0) >= 25 ? "Trending" : "Range"}
            />
            <MomentumTile
              label="MACD Hist"
              value={enrichment?.macdHist?.toFixed(2) ?? "—"}
              color={(enrichment?.macdHist ?? 0) > 0 ? "text-emerald-500" : (enrichment?.macdHist ?? 0) < 0 ? "text-rose-500" : "text-muted-foreground"}
              sub={(enrichment?.macdHist ?? 0) > 0 ? "Bullish" : (enrichment?.macdHist ?? 0) < 0 ? "Bearish" : "Flat"}
            />
            <MomentumTile
              label="Vol Ratio"
              value={enrichment?.volumeRatio?.toFixed(2) ?? "—"}
              color={(enrichment?.volumeRatio ?? 1) >= 1.5 ? "text-primary" : (enrichment?.volumeRatio ?? 1) <= 0.5 ? "text-muted-foreground" : "text-foreground"}
              sub={(enrichment?.volumeRatio ?? 1) >= 1.5 ? "High" : (enrichment?.volumeRatio ?? 1) <= 0.5 ? "Low" : "Normal"}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
        <div className="px-4 py-2.5 border-b lg:border-r border-border/70 bg-muted/20">
          <SectionTitle>Market Profile</SectionTitle>
          <div className="flex items-center gap-3 font-mono tabular-nums text-xs">
            <span className="inline-flex items-baseline gap-1">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">VAL</span>
              <span>{c}{fmt(item.val)}</span>
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span className="inline-flex items-baseline gap-1">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">POC</span>
              <span className="font-semibold">{c}{fmt(item.poc)}</span>
            </span>
            <span className="text-muted-foreground/40">·</span>
            <span className="inline-flex items-baseline gap-1">
              <span className="text-[11px] uppercase tracking-wider text-muted-foreground">VAH</span>
              <span>{c}{fmt(item.vah)}</span>
            </span>
          </div>
        </div>

        <div className="px-4 py-2.5 border-b border-border/70 bg-muted/20">
          <SectionTitle>CPR + PDH/PDL</SectionTitle>
          {cpr ? (
            <div className="flex items-center gap-3 font-mono tabular-nums text-xs flex-wrap">
              <span className="inline-flex items-baseline gap-1">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">BC</span>
                <span>{c}{fmt(cpr.bc)}</span>
              </span>
              <span className="text-muted-foreground/40">·</span>
              <span className="inline-flex items-baseline gap-1">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">TC</span>
                <span>{c}{fmt(cpr.tc)}</span>
              </span>
              <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded ${cpr.narrow ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                {cpr.narrow ? "NARROW — Trending" : "WIDE — Range"}
              </span>
              <span className="text-muted-foreground/40">|</span>
              <span className="inline-flex items-baseline gap-1">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">PDH</span>
                <span>{c}{fmt(item.prevHigh)}</span>
              </span>
              <span className="inline-flex items-baseline gap-1">
                <span className="text-[11px] uppercase tracking-wider text-muted-foreground">PDL</span>
                <span>{c}{fmt(item.prevLow)}</span>
              </span>
            </div>
          ) : (
            <span className="text-[11px] text-muted-foreground">Previous OHLC unavailable</span>
          )}
        </div>
      </div>

      <div className="px-4 py-3 border-b border-border/70">
        <OptionsStrip enrichment={enrichment} currency={c} />
      </div>

      <div className="px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <SectionTitle>Key Levels (Floor Pivots)</SectionTitle>
          {nearest && (
            <span className="text-[11px] font-mono text-muted-foreground">
              LTP {nearest.distancePct >= 0 ? "↓" : "↑"}{Math.abs(nearest.distancePct).toFixed(2)}% to{" "}
              <span className="text-foreground font-semibold">{nearest.label}</span>
            </span>
          )}
        </div>
        <PivotLadder ltp={item.ltp} supports={item.support} pivot={item.pivot} resistances={item.resistance} currency={c} />
      </div>

      {item.notes && item.notes.length > 0 && (
        <div className="px-4 py-2 border-t border-amber-500/30 bg-amber-500/5 text-[11px] text-amber-500 flex items-start gap-1.5">
          <span className="shrink-0">⚠</span>
          <div className="leading-snug">{item.notes.join(" · ")}</div>
        </div>
      )}
    </div>
  );
}
