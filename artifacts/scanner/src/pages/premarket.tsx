import { useGetPreMarket, getGetPreMarketQueryKey } from "@workspace/api-client-react";
import { DataSourceBadge } from "@/components/ui/data-source-badge";
import type { PreMarketReport } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  Sun, Moon, TrendingUp, TrendingDown, Globe2, Activity, AlertCircle, Calendar,
  ArrowUpRight, ArrowDownRight, Gauge, BarChart3, Layers, Target, Building2, Crosshair,
  ClipboardList, Shield, Package, Zap, Eye, Ban, ChevronDown, ChevronUp,
  LineChart, RefreshCw, WifiOff, Scale, Coins, Repeat, Flame, Briefcase, History,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";

function pct(n: number | null | undefined, dp = 2) {
  if (n == null) return "—";
  const s = n >= 0 ? "+" : "";
  return `${s}${n.toFixed(dp)}%`;
}
function fmt(n: number | null | undefined, dp = 2) {
  if (n == null) return "—";
  return n.toLocaleString("en-IN", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function tone(n: number | null | undefined) {
  if (n == null || n === 0) return "text-muted-foreground";
  return n > 0 ? "text-signal-strong-buy" : "text-signal-strong-sell";
}
function bgTone(n: number | null | undefined) {
  if (n == null) return "border-border/40 bg-secondary/40";
  if (n > 0.3) return "border-signal-strong-buy/40 bg-signal-strong-buy/[0.06]";
  if (n < -0.3) return "border-signal-strong-sell/40 bg-signal-strong-sell/[0.06]";
  return "border-border/40 bg-secondary/40";
}

const SENTIMENT_TONE: Record<string, string> = {
  STRONG_BULLISH: "bg-signal-strong-buy/20 text-signal-strong-buy border-signal-strong-buy/40",
  BULLISH: "bg-signal-strong-buy/10 text-signal-strong-buy border-signal-strong-buy/30",
  NEUTRAL: "bg-secondary/40 text-muted-foreground border-border/40",
  BEARISH: "bg-signal-strong-sell/10 text-signal-strong-sell border-signal-strong-sell/30",
  STRONG_BEARISH: "bg-signal-strong-sell/20 text-signal-strong-sell border-signal-strong-sell/40",
};

// ───────── Phase B helpers (Pro Market Analyser) ─────────
type CompositeBiasT = NonNullable<PreMarketReport["compositeBias"]>;
type ParticipantOiT = NonNullable<PreMarketReport["participantOi"]>;
type IndexOiBuildupT = NonNullable<PreMarketReport["indexOiBuildup"]>;
type StrikeOiChangeT = NonNullable<PreMarketReport["strikeOiChanges"]>[number];
type FiveDayFlowT = NonNullable<PreMarketReport["fiveDayFlows"]>;
type MacroOverlayT = NonNullable<PreMarketReport["macroOverlay"]>;
type SectorRotationT = NonNullable<PreMarketReport["sectorRotation"]>;
type TradeSetupsT = NonNullable<PreMarketReport["tradeSetups"]>;

const BIAS_LABEL: Record<string, string> = {
  STRONGLY_BULLISH: "Strongly Bullish",
  MILDLY_BULLISH: "Mildly Bullish",
  NEUTRAL: "Neutral",
  MILDLY_BEARISH: "Mildly Bearish",
  STRONGLY_BEARISH: "Strongly Bearish",
};

const SIG_TONE: Record<string, string> = {
  BULLISH: "bg-signal-strong-buy/15 text-signal-strong-buy border-signal-strong-buy/30",
  BEARISH: "bg-signal-strong-sell/15 text-signal-strong-sell border-signal-strong-sell/30",
  NEUTRAL: "bg-secondary/60 text-muted-foreground border-border/40",
  INFLOW: "bg-signal-strong-buy/15 text-signal-strong-buy border-signal-strong-buy/30",
  OUTFLOW: "bg-signal-strong-sell/15 text-signal-strong-sell border-signal-strong-sell/30",
  ACCUMULATING: "bg-signal-strong-buy/15 text-signal-strong-buy border-signal-strong-buy/30",
  DISTRIBUTING: "bg-signal-strong-sell/15 text-signal-strong-sell border-signal-strong-sell/30",
  MIXED: "bg-secondary/60 text-muted-foreground border-border/40",
  LONG: "bg-signal-strong-buy/15 text-signal-strong-buy border-signal-strong-buy/30",
  SHORT: "bg-signal-strong-sell/15 text-signal-strong-sell border-signal-strong-sell/30",
  RANGE: "bg-secondary/60 text-muted-foreground border-border/40",
};
function sigTone(k?: string | null) {
  return SIG_TONE[k ?? "NEUTRAL"] ?? SIG_TONE["NEUTRAL"]!;
}
function Pill({ text, k }: { text: string; k?: string | null }) {
  return (
    <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${sigTone(k)}`}>
      {text}
    </span>
  );
}

const OI_CLASS: Record<string, { label: string; tone: string; cellKey: string }> = {
  LONG_BUILDUP: { label: "Long Buildup", tone: "text-signal-strong-buy", cellKey: "UP_UP" },
  SHORT_COVERING: { label: "Short Covering", tone: "text-signal-strong-buy", cellKey: "UP_DOWN" },
  SHORT_BUILDUP: { label: "Short Buildup", tone: "text-signal-strong-sell", cellKey: "DOWN_UP" },
  LONG_UNWINDING: { label: "Long Unwinding", tone: "text-signal-strong-sell", cellKey: "DOWN_DOWN" },
  NEUTRAL: { label: "Neutral", tone: "text-muted-foreground", cellKey: "" },
  DATA_UNAVAILABLE: { label: "No live feed", tone: "text-muted-foreground", cellKey: "" },
};

function relTime(s?: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return formatDistanceToNow(d, { addSuffix: true });
}
function SourceTag({ source, asOf }: { source?: string | null; asOf?: string | null }) {
  return (
    <span className="text-[10px] font-mono text-muted-foreground/60 truncate">
      {source ?? "—"}{asOf ? ` · ${relTime(asOf)}` : ""}
    </span>
  );
}
function fmtInt(n?: number | null) {
  if (n == null) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function fmtSignedInt(n?: number | null) {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}
function fmtCr(n?: number | null) {
  if (n == null) return "—";
  return `${n >= 0 ? "+" : ""}${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`;
}

function SectionShell({
  icon, title, subtitle, right, children,
}: {
  icon?: React.ReactNode; title: string; subtitle?: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          {icon}{title}
        </h2>
        {subtitle && <span className="text-[10px] text-muted-foreground/60 font-mono">{subtitle}</span>}
        {right && <span className="ml-auto">{right}</span>}
      </div>
      {children}
    </section>
  );
}

function NoFeed({ label }: { label?: string }) {
  return (
    <Card className="border border-dashed border-border/50 bg-secondary/10">
      <CardContent className="p-5 text-center">
        <WifiOff className="w-5 h-5 mx-auto mb-2 text-muted-foreground/50" />
        <div className="text-xs font-mono text-muted-foreground">No live feed{label ? ` — ${label}` : ""}</div>
        <div className="text-[10px] text-muted-foreground/60 mt-1">
          This block populates automatically when its upstream source is available.
        </div>
      </CardContent>
    </Card>
  );
}

// ───────── Ticker strip ─────────
function TickerStrip({ data }: { data: PreMarketReport }) {
  const items: { label: string; value: number | null | undefined; chg: number | null | undefined }[] = [];
  for (const ix of data.indexPreviews ?? []) {
    items.push({ label: ix.name, value: ix.indicativePrice, chg: ix.indicativeChangePercent });
  }
  const vix = data.overnightCues?.find(c => c.label === "India VIX");
  if (vix) items.push({ label: "India VIX", value: vix.value, chg: vix.changePercent });
  for (const c of (data.overnightCues ?? []).filter(c => c.category === "proxy")) {
    items.push({ label: c.label, value: c.value, chg: c.changePercent });
  }
  if (items.length === 0) return null;
  return (
    <div className="flex items-center gap-5 overflow-x-auto rounded-lg border border-border/50 bg-card/60 px-4 py-2 text-xs">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2 whitespace-nowrap shrink-0">
          <span className="font-mono uppercase text-muted-foreground/80">{it.label}</span>
          <span className="font-mono tabular-nums">{fmt(it.value)}</span>
          <span className={`font-mono tabular-nums font-bold ${tone(it.chg)}`}>{pct(it.chg)}</span>
        </div>
      ))}
    </div>
  );
}

// ───────── 1 · Composite Bias Hero ─────────
function BiasBar({ b }: { b: CompositeBiasT["breakdown"][number] }) {
  const s = b.score;
  const has = s != null;
  const clamped = has ? Math.max(-3, Math.min(3, s)) : 0;
  const posPct = ((clamped + 3) / 6) * 100;
  return (
    <div className="grid grid-cols-[120px_1fr_auto] items-center gap-2 text-[11px]">
      <span className="font-mono text-muted-foreground truncate" title={b.note}>{b.signal.replace(/_/g, " ")}</span>
      <div className="relative h-2 rounded-full bg-secondary/50 overflow-hidden">
        <div className="absolute inset-y-0 left-1/2 w-px bg-foreground/30" />
        {has && (
          <div
            className={`absolute inset-y-0 ${clamped >= 0 ? "bg-signal-strong-buy/70" : "bg-signal-strong-sell/70"}`}
            style={clamped >= 0 ? { left: "50%", width: `${posPct - 50}%` } : { left: `${posPct}%`, width: `${50 - posPct}%` }}
          />
        )}
      </div>
      <span className="font-mono tabular-nums w-20 text-right">
        <span className={has ? tone(b.contribution) : "text-muted-foreground"}>
          {has ? `${b.contribution >= 0 ? "+" : ""}${b.contribution.toFixed(1)}` : "—"}
        </span>
        <span className="text-muted-foreground/50"> ×{b.weight}</span>
      </span>
    </div>
  );
}

function CompositeBiasHero({
  data, modeLabel, ModeIcon, dataUpdatedAt, blurb,
}: {
  data: PreMarketReport;
  modeLabel: string;
  ModeIcon: React.ComponentType<{ className?: string }>;
  dataUpdatedAt: number;
  blurb: string;
}) {
  const cb = data.compositeBias;
  const score = cb ? Math.max(-10, Math.min(10, cb.score)) : 0;
  const gpos = ((score + 10) / 20) * 100;
  const cardTone = cb ? bgTone(cb.score / 4) : bgTone(data.sentimentScore);

  return (
    <Card className={`border ${cardTone}`}>
      <CardContent className="p-6">
        <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_1fr] gap-6">
          {/* Left — score + verdict */}
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground font-mono uppercase tracking-wider">
              <ModeIcon className="w-4 h-4" />
              <span>{modeLabel}</span>
              <span>·</span>
              <span>updated {formatDistanceToNow(new Date(data.generatedAt), { addSuffix: true })}</span>
            </div>
            <h1 className="text-2xl font-bold mt-2 tracking-tight">Composite Market Bias</h1>
            <p className="text-[11px] text-muted-foreground/80 mt-0.5">{blurb}</p>

            {cb ? (
              <>
                <div className="flex items-end gap-3 mt-4">
                  <div className={`text-5xl font-bold tabular-nums ${tone(cb.score)}`}>
                    {cb.score >= 0 ? "+" : ""}{cb.score.toFixed(1)}
                  </div>
                  <div className="pb-1">
                    <div className={`text-sm font-bold ${tone(cb.score)}`}>{BIAS_LABEL[cb.label] ?? cb.label}</div>
                    <div className="text-[10px] font-mono text-muted-foreground/70">scale −10 … +10</div>
                  </div>
                </div>
                <div className="mt-3">
                  <div className="relative h-3 rounded-full bg-secondary/60 overflow-hidden">
                    <div className="absolute inset-y-0 left-1/2 w-px bg-foreground/40" />
                    <div
                      className={`absolute inset-y-0 ${cb.score >= 0 ? "bg-signal-strong-buy/70" : "bg-signal-strong-sell/70"}`}
                      style={cb.score >= 0 ? { left: "50%", width: `${gpos - 50}%` } : { left: `${gpos}%`, width: `${50 - gpos}%` }}
                    />
                    <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2 h-5 rounded bg-foreground" style={{ left: `${gpos}%` }} />
                  </div>
                  <div className="flex justify-between text-[9px] font-mono text-muted-foreground/60 mt-1">
                    <span>−10</span><span>0</span><span>+10</span>
                  </div>
                </div>
                <p className="text-sm text-foreground/85 mt-3 leading-relaxed">{cb.verdict}</p>
                <div className="text-[10px] font-mono text-muted-foreground/60 mt-2 flex items-center gap-2 flex-wrap">
                  <span>Data completeness {(cb.dataCompleteness * 100).toFixed(0)}%</span>
                  <span>·</span>
                  <SourceTag source={cb.source} asOf={cb.asOf} />
                </div>
              </>
            ) : (
              <div className="mt-4">
                <span className={`px-3 py-1.5 rounded border text-xs font-mono font-bold ${SENTIMENT_TONE[data.sentiment] ?? SENTIMENT_TONE["NEUTRAL"]}`}>
                  {data.sentiment.replace("_", " ")}
                </span>
                <span className={`ml-2 text-xs font-mono ${tone(data.sentimentScore)}`}>
                  Score {data.sentimentScore >= 0 ? "+" : ""}{data.sentimentScore.toFixed(1)}
                </span>
                <p className="text-[11px] text-muted-foreground/70 mt-3">
                  Composite bias score has no live feed yet — showing the overnight sentiment read instead.
                </p>
              </div>
            )}

            <p className="text-sm text-foreground/80 mt-4">{data.narrative}</p>
            {data.keyTakeaways && data.keyTakeaways.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm">
                {data.keyTakeaways.map((t, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <span className="text-muted-foreground mt-0.5">▸</span>
                    <span className="text-foreground/90">{t}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Right — signal breakdown + invalidation */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Signal Breakdown</div>
              <DataSourceBadge source="mixed" status="delayed" lastUpdated={dataUpdatedAt} refreshMs={60_000} compact />
            </div>
            {cb && cb.breakdown.length > 0 ? (
              <div className="space-y-1.5">
                {cb.breakdown.map(b => <BiasBar key={b.signal} b={b} />)}
              </div>
            ) : (
              <div className="text-xs font-mono text-muted-foreground/70 py-6 text-center">
                No weighted-signal breakdown available.
              </div>
            )}

            {cb && (
              <div className="mt-4 pt-3 border-t border-border/40 space-y-2">
                <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground">Invalidation</div>
                <div className="flex items-start gap-2 text-xs">
                  <span className="text-signal-strong-buy mt-0.5 shrink-0">▲</span>
                  <span className="text-foreground/85 leading-snug">{cb.invalidation.bullishFlip}</span>
                </div>
                <div className="flex items-start gap-2 text-xs">
                  <span className="text-signal-strong-sell mt-0.5 shrink-0">▼</span>
                  <span className="text-foreground/85 leading-snug">{cb.invalidation.bearishAcceleration}</span>
                </div>
                {cb.methodologyNote && (
                  <p className="text-[10px] text-muted-foreground/60 italic leading-snug pt-1">{cb.methodologyNote}</p>
                )}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ───────── 2 · Participant-wise OI ─────────
function ParticipantOiSection({ p }: { p: ParticipantOiT }) {
  const lsr = p.fiiLsrPct;
  const lsrTone = lsr == null ? "text-muted-foreground" : lsr >= 60 ? "text-signal-strong-buy" : lsr <= 30 ? "text-signal-strong-sell" : "text-foreground";
  return (
    <Card className="border border-border/50">
      <CardContent className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4">
          {/* King metric */}
          <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">FII Long-Share (LSR)</div>
            <div className={`text-3xl font-bold tabular-nums mt-1 ${lsrTone}`}>{lsr == null ? "—" : `${lsr.toFixed(1)}%`}</div>
            <div className="mt-1.5"><Pill text={p.signal} k={p.signal} /></div>
            <div className="text-[10px] font-mono text-muted-foreground/80 mt-2 leading-snug">≤30% bearish · ≥60% bullish</div>
            <div className="mt-2 pt-2 border-t border-border/40 space-y-0.5 text-[11px] font-mono">
              <div className="flex justify-between"><span className="text-muted-foreground">FII ΔNet</span><span className={tone(p.fiiNetChange)}>{fmtSignedInt(p.fiiNetChange)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Index Fut OI</span><span className="tabular-nums">{fmtInt(p.aggIndexFutOi)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">OI Δ%</span><span className={tone(p.aggIndexFutOiChgPct)}>{pct(p.aggIndexFutOiChgPct)}</span></div>
            </div>
          </div>
          {/* Segment table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] font-mono uppercase text-muted-foreground/70 text-right">
                  <th className="text-left font-normal pb-1">Participant</th>
                  <th className="font-normal pb-1">Long</th>
                  <th className="font-normal pb-1">Short</th>
                  <th className="font-normal pb-1">Net</th>
                  <th className="font-normal pb-1">LSR%</th>
                  <th className="font-normal pb-1">ΔNet</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {p.segments.length === 0 ? (
                  <tr><td colSpan={6} className="text-center text-muted-foreground py-3">No participant rows.</td></tr>
                ) : p.segments.map(s => (
                  <tr key={s.clientType} className="text-right border-t border-border/30">
                    <td className="text-left py-1 font-semibold">{s.clientType}</td>
                    <td className="text-signal-strong-buy/90">{fmtInt(s.futureIndexLong)}</td>
                    <td className="text-signal-strong-sell/90">{fmtInt(s.futureIndexShort)}</td>
                    <td className={tone(s.futureIndexNet)}>{fmtSignedInt(s.futureIndexNet)}</td>
                    <td>{s.lsrPct == null ? "—" : s.lsrPct.toFixed(0)}</td>
                    <td className={tone(s.netChange)}>{fmtSignedInt(s.netChange)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {p.divergence && (
          <p className="text-xs text-amber-400/90 mt-3 leading-snug">{p.divergence}</p>
        )}
        <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-border/40">
          <p className="text-[11px] text-muted-foreground/80 leading-snug">{p.note}</p>
          <SourceTag source={p.source} asOf={p.asOf} />
        </div>
      </CardContent>
    </Card>
  );
}

// ───────── 3 · Index OI Buildup ─────────
function IndexOiBuildupSection({ b }: { b: IndexOiBuildupT }) {
  const cls = OI_CLASS[b.classification] ?? OI_CLASS["NEUTRAL"]!;
  const matrix: { key: string; label: string; hint: string }[] = [
    { key: "UP_UP", label: "Long Buildup", hint: "Price ↑ · OI ↑" },
    { key: "UP_DOWN", label: "Short Covering", hint: "Price ↑ · OI ↓" },
    { key: "DOWN_UP", label: "Short Buildup", hint: "Price ↓ · OI ↑" },
    { key: "DOWN_DOWN", label: "Long Unwinding", hint: "Price ↓ · OI ↓" },
  ];
  return (
    <Card className="border border-border/50">
      <CardContent className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr] gap-4">
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <div className="text-sm font-bold font-mono">{b.label}</div>
              <Pill text={cls.label} k={b.bias} />
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3 text-xs">
              <div>
                <div className="text-[10px] font-mono uppercase text-muted-foreground">Price Δ%</div>
                <div className={`font-mono tabular-nums text-lg font-bold ${tone(b.priceChgPct)}`}>{pct(b.priceChgPct)}</div>
              </div>
              <div>
                <div className="text-[10px] font-mono uppercase text-muted-foreground">OI Δ%</div>
                <div className={`font-mono tabular-nums text-lg font-bold ${tone(b.oiChgPct)}`}>{pct(b.oiChgPct)}</div>
              </div>
            </div>
            <p className="text-xs text-foreground/85 mt-3 leading-relaxed">{b.interpretation}</p>
          </div>
          {/* 2×2 matrix */}
          <div className="grid grid-cols-2 gap-1.5 self-start">
            {matrix.map(m => {
              const active = m.key === cls.cellKey;
              return (
                <div
                  key={m.key}
                  className={`rounded border p-2 text-center ${active ? "border-foreground/60 bg-foreground/[0.06]" : "border-border/40 bg-secondary/15"}`}
                >
                  <div className={`text-[11px] font-semibold ${active ? cls.tone : "text-muted-foreground/70"}`}>{m.label}</div>
                  <div className="text-[9px] font-mono text-muted-foreground/60 mt-0.5">{m.hint}</div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-border/40">
          <p className="text-[11px] text-muted-foreground/80 leading-snug">{b.note}</p>
          <SourceTag source={b.source} asOf={b.asOf} />
        </div>
      </CardContent>
    </Card>
  );
}

// ───────── 4 · Strike-level OI changes ─────────
function StrikeList({ title, entries, tone: t }: { title: string; entries: StrikeOiChangeT["topCallWriting"]; tone: string }) {
  return (
    <div>
      <div className={`text-[10px] font-mono uppercase tracking-wider mb-1 ${t}`}>{title}</div>
      {entries.length === 0 ? (
        <div className="text-[11px] text-muted-foreground/60 font-mono">—</div>
      ) : (
        <ul className="space-y-1">
          {entries.map((e, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums">
              <span className="font-bold">{fmtInt(e.strike)}</span>
              <span className="text-muted-foreground">{fmtSignedInt(e.chgOi)}{e.oiChgPct != null ? ` · ${pct(e.oiChgPct)}` : ""}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
function StrikeOiChangesSection({ list }: { list: StrikeOiChangeT[] }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
      {list.map(s => (
        <Card key={s.underlying} className="border border-border/50">
          <CardContent className="p-4">
            <div className="flex items-baseline justify-between gap-2 mb-3">
              <div className="text-sm font-bold font-mono">{s.underlying}</div>
              <div className="text-[10px] font-mono text-muted-foreground">spot {fmt(s.spot)} · {s.expiry}</div>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <StrikeList title="Call Writing (resistance)" entries={s.topCallWriting} tone="text-signal-strong-sell" />
              <StrikeList title="Put Writing (support)" entries={s.topPutWriting} tone="text-signal-strong-buy" />
              <StrikeList title="Call Unwinding" entries={s.topCallUnwinding} tone="text-signal-strong-buy/80" />
              <StrikeList title="Put Unwinding" entries={s.topPutUnwinding} tone="text-signal-strong-sell/80" />
            </div>
            <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-border/40">
              <p className="text-[11px] text-muted-foreground/80 leading-snug">{s.read}</p>
              <SourceTag source={s.source} asOf={s.asOf} />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ───────── 5 · 5-day institutional flow ─────────
function FiveDayFlowSection({ f }: { f: FiveDayFlowT }) {
  return (
    <Card className="border border-border/50">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <span className="text-[10px] font-mono uppercase text-muted-foreground">FII</span>
          <Pill text={f.fiiTrend} k={f.fiiTrend} />
          <span className="text-[10px] font-mono uppercase text-muted-foreground ml-2">DII</span>
          <Pill text={f.diiTrend} k={f.diiTrend} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] font-mono uppercase text-muted-foreground/70 text-right">
                <th className="text-left font-normal pb-1">Date</th>
                <th className="font-normal pb-1">FII Net</th>
                <th className="font-normal pb-1">DII Net</th>
                <th className="font-normal pb-1">Nifty%</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {f.days.length === 0 ? (
                <tr><td colSpan={4} className="text-center text-muted-foreground py-3">No flow rows.</td></tr>
              ) : f.days.map((d, i) => (
                <tr key={i} className="text-right border-t border-border/30">
                  <td className="text-left py-1">{d.date}</td>
                  <td className={tone(d.fiiNet)}>{fmtCr(d.fiiNet)}</td>
                  <td className={tone(d.diiNet)}>{fmtCr(d.diiNet)}</td>
                  <td className={tone(d.niftyChangePct)}>{pct(d.niftyChangePct)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="text-right border-t-2 border-border/50 font-bold">
                <td className="text-left py-1">5-day Σ</td>
                <td className={tone(f.cumFiiCr)}>{fmtCr(f.cumFiiCr)}</td>
                <td className={tone(f.cumDiiCr)}>{fmtCr(f.cumDiiCr)}</td>
                <td className="text-muted-foreground/50">—</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-border/40">
          <p className="text-[11px] text-muted-foreground/80 leading-snug">{f.read}</p>
          <SourceTag source={f.source} asOf={f.asOf} />
        </div>
      </CardContent>
    </Card>
  );
}

// ───────── 6 · Macro overlay ─────────
function MacroOverlaySection({ m }: { m: MacroOverlayT }) {
  return (
    <Card className="border border-border/50">
      <CardContent className="p-4">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="text-[10px] font-mono uppercase text-muted-foreground">Global Macro Backdrop</div>
          {m.macroScore != null && (
            <span className={`text-xs font-mono font-bold ${tone(m.macroScore)}`}>
              Macro score {m.macroScore >= 0 ? "+" : ""}{m.macroScore.toFixed(1)}
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] font-mono uppercase text-muted-foreground/70 text-right">
                <th className="text-left font-normal pb-1">Indicator</th>
                <th className="font-normal pb-1">Value</th>
                <th className="font-normal pb-1">Chg%</th>
                <th className="text-right font-normal pb-1">Impact</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {m.rows.length === 0 ? (
                <tr><td colSpan={4} className="text-center text-muted-foreground py-3">No macro rows.</td></tr>
              ) : m.rows.map((r, i) => (
                <tr key={i} className="text-right border-t border-border/30" title={r.note}>
                  <td className="text-left py-1 font-semibold">{r.label}</td>
                  <td>{fmt(r.value)}</td>
                  <td className={tone(r.changePercent)}>{pct(r.changePercent)}</td>
                  <td className="text-right"><Pill text={r.impact} k={r.impact} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-border/40">
          <p className="text-[11px] text-muted-foreground/80 leading-snug">{m.read}</p>
          <SourceTag source={m.source} asOf={m.asOf} />
        </div>
      </CardContent>
    </Card>
  );
}

// ───────── 7 · Sector rotation ─────────
function RotationRow({ e, maxAbs }: { e: SectorRotationT["leaders"][number]; maxAbs: number }) {
  const w = maxAbs > 0 ? Math.max(4, (Math.abs(e.avgChangePercent) / maxAbs) * 100) : 4;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-28 truncate" title={e.topPickSymbol ? `top: ${e.topPickSymbol}` : undefined}>{e.sector}</span>
      <div className="flex-1 h-2 rounded-full bg-secondary/40 overflow-hidden">
        <div className={`h-full ${e.avgChangePercent >= 0 ? "bg-signal-strong-buy/70" : "bg-signal-strong-sell/70"}`} style={{ width: `${w}%` }} />
      </div>
      <span className={`w-16 text-right font-mono tabular-nums ${tone(e.avgChangePercent)}`}>{pct(e.avgChangePercent)}</span>
    </div>
  );
}
function SectorRotationSection({ r }: { r: SectorRotationT }) {
  const maxAbs = Math.max(0, ...[...r.leaders, ...r.laggards].map(e => Math.abs(e.avgChangePercent)));
  return (
    <Card className="border border-border/50">
      <CardContent className="p-4">
        <div className="flex items-center gap-3 mb-3 text-[11px] font-mono">
          <span className="text-signal-strong-buy">{r.breadthPositive} sectors up</span>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-signal-strong-sell">{r.breadthNegative} down</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-signal-strong-buy mb-2">Money Rotating In</div>
            <div className="space-y-1.5">
              {r.leaders.length === 0 ? <div className="text-[11px] text-muted-foreground/60 font-mono">—</div>
                : r.leaders.map((e, i) => <RotationRow key={i} e={e} maxAbs={maxAbs} />)}
            </div>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-signal-strong-sell mb-2">Money Rotating Out</div>
            <div className="space-y-1.5">
              {r.laggards.length === 0 ? <div className="text-[11px] text-muted-foreground/60 font-mono">—</div>
                : r.laggards.map((e, i) => <RotationRow key={i} e={e} maxAbs={maxAbs} />)}
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-border/40">
          <p className="text-[11px] text-muted-foreground/80 leading-snug">{r.rotationRead}</p>
          <SourceTag source={r.source} asOf={r.asOf} />
        </div>
      </CardContent>
    </Card>
  );
}

// ───────── 8 · Trade setups (reporting only) ─────────
function TradeSetupsSection({ t }: { t: TradeSetupsT }) {
  return (
    <Card className="border border-border/50">
      <CardContent className="p-4">
        <div className="text-[10px] font-mono uppercase tracking-wider text-amber-400/90 mb-3">
          Reporting only — derived from pivots + composite bias · never placed, sized, or executed
        </div>
        {t.setups.length === 0 ? (
          <div className="text-xs font-mono text-muted-foreground/70 py-3 text-center">No derived setups for the current bias.</div>
        ) : (
          <div className="space-y-3">
            {t.setups.map((s, i) => (
              <div key={i} className="rounded-lg border border-border/50 bg-secondary/15 p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-sm">{s.symbol}</span>
                    <Pill text={s.direction} k={s.direction} />
                    <span className="text-xs text-muted-foreground">{s.label}</span>
                  </div>
                  <span className="text-[11px] font-mono text-muted-foreground">
                    R:R {s.riskReward == null ? "—" : `${s.riskReward.toFixed(2)}×`}
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-2 text-xs font-mono tabular-nums">
                  <div><div className="text-[10px] text-muted-foreground uppercase">Entry</div><div className="font-bold">{fmt(s.entry)}</div></div>
                  <div><div className="text-[10px] text-muted-foreground uppercase">Target</div><div className="text-signal-strong-buy">{fmt(s.target)}</div></div>
                  <div><div className="text-[10px] text-muted-foreground uppercase">Stop</div><div className="text-signal-strong-sell">{fmt(s.stop)}</div></div>
                </div>
                <p className="text-[11px] text-foreground/80 mt-2 leading-snug">{s.rationale}</p>
                <p className="text-[11px] text-muted-foreground/75 mt-1 leading-snug italic">Invalidation: {s.invalidation}</p>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-border/40">
          <span className="text-[11px] text-muted-foreground/80">Keyed off bias score {t.biasScore >= 0 ? "+" : ""}{t.biasScore.toFixed(1)}</span>
          <SourceTag source={t.source} asOf={t.asOf} />
        </div>
      </CardContent>
    </Card>
  );
}

export default function PreMarket() {
  const { data, isLoading, error, dataUpdatedAt, refetch, isFetching } = useGetPreMarket({
    query: { staleTime: 30_000, refetchInterval: 60_000, queryKey: getGetPreMarketQueryKey() },
  });

  if (isLoading) {
    return (
      <div className="w-full px-4 py-6 space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-40 w-full" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-64" /><Skeleton className="h-64" />
        </div>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="w-full px-4 py-12 text-center">
        <AlertCircle className="w-10 h-10 mx-auto mb-3 text-signal-strong-sell" />
        <p className="font-mono text-sm text-muted-foreground">Failed to load pre-market data. Please retry shortly.</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="mt-4 inline-flex items-center gap-1.5 rounded border border-border/60 bg-secondary/40 px-3 py-1.5 text-xs font-mono hover:bg-secondary/70 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }

  const isPre = data.mode === "PRE_MARKET";
  const isPost = data.mode === "POST_MARKET";
  const isLive = data.mode === "LIVE";
  const ModeIcon = isPre ? Sun : isPost ? Moon : Activity;
  const modeLabel = isPre ? "Pre-Market Setup" : isPost ? "Post-Market Wrap" : "Live Session";
  const modeBlurb = isPre
    ? "Preparation view — build the plan before the bell."
    : isPost
      ? "Review view — what the tape did and what it sets up next."
      : "Confirmation view — is the morning plan playing out?";

  const now = new Date();
  const istTime = now.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });
  const istDate = now.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "2-digit", month: "short" });

  // Group cues by category
  const cueByCat: Record<string, typeof data.overnightCues> = {};
  for (const c of data.overnightCues) {
    const cat = c.category ?? "proxy";
    cueByCat[cat] ??= [];
    cueByCat[cat]!.push(c);
  }

  const nodes: Record<string, React.ReactNode> = {
    scenarios: (data.scenarios && data.scenarios.length > 0) ? (
      <section>
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Target className="w-4 h-4" /> Today's 3 Scenarios — Setup Plan
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
          {data.scenarios.map(s => (<ScenarioCard key={s.kind} scenario={s} />))}
        </div>
        <p className="text-xs text-muted-foreground/70 mt-2 italic leading-snug">
          Pros prepare all three plans, then trade the one the market actually picks. Probability is a heuristic from overnight cues + CPR width — never a forecast.
        </p>
      </section>
    ) : null,

    previews: (data.indexPreviews && data.indexPreviews.length > 0) ? (
      <section>
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground mb-3">
          {isPre ? "Indicative Open" : "Index Snapshot"}
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {data.indexPreviews.map(ix => (
            <Card key={ix.symbol} className={`border ${bgTone(ix.indicativeChangePercent)}`}>
              <CardContent className="p-4">
                <div className="text-xs font-mono text-muted-foreground uppercase">{ix.name}</div>
                <div className="text-xl font-bold tabular-nums mt-1">{fmt(ix.indicativePrice)}</div>
                <div className={`text-xs font-mono mt-0.5 ${tone(ix.indicativeChangePercent)}`}>
                  {ix.indicativeChange != null && (ix.indicativeChange >= 0 ? "+" : "")}{fmt(ix.indicativeChange)} ({pct(ix.indicativeChangePercent)})
                </div>
                <div className="text-[10px] font-mono text-muted-foreground mt-2">vs prev close {fmt(ix.previousClose)}</div>
                {ix.source && <div className="text-[10px] text-muted-foreground/70 mt-0.5 italic">{ix.source}</div>}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    ) : null,

    levels: (data.indexLevels && data.indexLevels.length > 0) ? (
      <section>
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Layers className="w-4 h-4" /> Key Index Levels — CPR & Pivots
        </h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
          {data.indexLevels.map(lv => <IndexLevelsCard key={lv.symbol} lv={lv} />)}
        </div>
        <p className="text-xs text-muted-foreground/70 mt-2 italic leading-snug">
          Pivots from previous-session OHLC. CPR width — narrow (&lt;0.4%) tends to precede a trending day, wide (&gt;1.0%) precedes range/chop.
        </p>
      </section>
    ) : null,

    options: (data.optionSnapshots && data.optionSnapshots.length > 0) ? (
      <section>
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Crosshair className="w-4 h-4" /> Option Chain Morning Snapshot
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.optionSnapshots.map(o => <OptionSnapshotCard key={o.underlying} snap={o} />)}
        </div>
        <p className="text-xs text-muted-foreground/70 mt-2 italic leading-snug">
          Expected move = ATM straddle ÷ spot. Max-pain = strike where option writers lose least. Highest CE-OI is intraday resistance, highest PE-OI is intraday support.
        </p>
      </section>
    ) : null,

    internals: data.postMarketDigest ? (
      <section>
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <BarChart3 className="w-4 h-4" /> Market Internals
        </h2>
        <Card className={`border ${bgTone((data.postMarketDigest.marketBreadthScore ?? 0) / 30)}`}>
          <CardContent className="p-5">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              <Stat label="Advancers" value={String(data.postMarketDigest.advancers)} tone="text-signal-strong-buy" />
              <Stat label="Decliners" value={String(data.postMarketDigest.decliners)} tone="text-signal-strong-sell" />
              <Stat label="Unchanged" value={String(data.postMarketDigest.unchanged)} />
              <Stat label="A/D Ratio" value={data.postMarketDigest.adRatio == null ? "∞" : data.postMarketDigest.adRatio.toFixed(2)} />
              <Stat label="Breadth Score" value={`${(data.postMarketDigest.marketBreadthScore ?? 0) >= 0 ? "+" : ""}${(data.postMarketDigest.marketBreadthScore ?? 0).toFixed(0)}`}
                tone={tone(data.postMarketDigest.marketBreadthScore ?? 0)} />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 pt-4 border-t border-border/40">
              <Stat label="52W Highs" value={String(data.postMarketDigest.new52wHigh ?? 0)}
                tone={(data.postMarketDigest.new52wHigh ?? 0) > 0 ? "text-signal-strong-buy" : undefined} />
              <Stat label="52W Lows" value={String(data.postMarketDigest.new52wLow ?? 0)}
                tone={(data.postMarketDigest.new52wLow ?? 0) > 0 ? "text-signal-strong-sell" : undefined} />
              <Stat label="Upper Circuits" value={String(data.postMarketDigest.upperCircuits ?? 0)}
                tone={(data.postMarketDigest.upperCircuits ?? 0) > 0 ? "text-signal-strong-buy" : undefined} />
              <Stat label="Lower Circuits" value={String(data.postMarketDigest.lowerCircuits ?? 0)}
                tone={(data.postMarketDigest.lowerCircuits ?? 0) > 0 ? "text-signal-strong-sell" : undefined} />
            </div>
            <p className="text-sm text-foreground/85 mt-4">{data.postMarketDigest.narrative ?? ""}</p>
          </CardContent>
        </Card>
      </section>
    ) : null,

    heatmap: (data.sectorHeatmap && data.sectorHeatmap.length > 0) ? (
      <section>
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <BarChart3 className="w-4 h-4" /> Sector Heatmap — Leaders to Laggards
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2">
          {data.sectorHeatmap.map(s => <SectorTile key={s.sector} s={s} />)}
        </div>
      </section>
    ) : null,

    movers: (
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MoverList title="Top Gainers" icon={<TrendingUp className="w-4 h-4 text-signal-strong-buy" />} items={data.topGainers ?? []} positive />
        <MoverList title="Top Losers" icon={<TrendingDown className="w-4 h-4 text-signal-strong-sell" />} items={data.topLosers ?? []} positive={false} />
      </section>
    ),

    gappers: (data.gapUps?.length || data.gapDowns?.length) ? (
      <section>
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground mb-3">Gap Analysis (gap vs ATR)</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <GapList title="Gap Ups" icon={<ArrowUpRight className="w-4 h-4 text-signal-strong-buy" />} items={data.gapUps ?? []} />
          <GapList title="Gap Downs" icon={<ArrowDownRight className="w-4 h-4 text-signal-strong-sell" />} items={data.gapDowns ?? []} />
        </div>
      </section>
    ) : null,

    cues: (
      <section>
        <h2 className="text-sm font-mono uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
          <Globe2 className="w-4 h-4" /> Overnight & Global Cues
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {(["proxy", "us", "asia", "europe", "currency", "commodity", "vix"] as const).map(cat => {
            const cues = cueByCat[cat];
            if (!cues || cues.length === 0) return null;
            const label = ({ proxy: "Pre-Open Proxy (GIFT NIFTY)", us: "United States", asia: "Asia",
              europe: "Europe", currency: "Currency / Dollar Index", commodity: "Commodities", vix: "Volatility (India VIX)" } as const)[cat];
            return (
              <Card key={cat} className="border border-border/50">
                <CardContent className="p-4">
                  <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-2">{label}</div>
                  <ul className="space-y-1.5">
                    {cues.map(c => (
                      <li key={c.label} className="flex items-center justify-between text-sm">
                        <span className="font-medium truncate" title={c.note ?? ""}>{c.label}{c.inverted && <span className="text-[9px] text-muted-foreground ml-1">(inv)</span>}</span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className="font-mono tabular-nums text-xs text-muted-foreground">{fmt(c.value)}</span>
                          <span className={`font-mono tabular-nums text-xs font-bold ${tone(c.changePercent)}`}>{pct(c.changePercent)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>
    ),

    eventsRow: (data.eventsToday?.length || data.earningsToday?.length || data.fiiDii) ? (
      <section className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {data.fiiDii && <FiiDiiCard f={data.fiiDii} />}
        {data.eventsToday && data.eventsToday.length > 0 && (
          <Card className="border border-border/50">
            <CardContent className="p-4">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
                <Calendar className="w-3.5 h-3.5" /> Macro Events Today
              </div>
              <ul className="space-y-1.5 text-sm">
                {data.eventsToday.map((e, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Badge variant="outline" className="text-[9px] mt-0.5">{e.region ?? "—"}</Badge>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{e.name}</div>
                      {e.description && <div className="text-[11px] text-muted-foreground truncate">{e.description}</div>}
                    </div>
                    {e.impact && <span className="text-[9px] font-mono uppercase text-muted-foreground">{e.impact}</span>}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
        {data.earningsToday && data.earningsToday.length > 0 && (
          <Card className="border border-border/50">
            <CardContent className="p-4">
              <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
                <Activity className="w-3.5 h-3.5" /> Earnings Today
              </div>
              <ul className="space-y-1 text-sm">
                {data.earningsToday.map((e) => (
                  <li key={e.symbol}>
                    <Link href={`/stock/${encodeURIComponent(e.symbol ?? "")}`} className="flex items-center justify-between hover-row px-2 py-1 rounded">
                      <span className="font-mono font-bold">{e.symbol}</span>
                      <span className="text-xs text-muted-foreground truncate ml-3">{e.name}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </section>
    ) : null,

    participantOi: (
      <SectionShell icon={<Scale className="w-4 h-4" />} title="Participant-wise OI" subtitle="FII / DII / Pro / Client index-futures positioning">
        {data.participantOi ? <ParticipantOiSection p={data.participantOi} /> : <NoFeed label="participant OI" />}
      </SectionShell>
    ),

    indexOiBuildup: (
      <SectionShell icon={<Layers className="w-4 h-4" />} title="Index OI Buildup" subtitle="price × open-interest classifier">
        {data.indexOiBuildup ? <IndexOiBuildupSection b={data.indexOiBuildup} /> : <NoFeed label="index OI buildup" />}
      </SectionShell>
    ),

    strikeOi: (
      <SectionShell icon={<Flame className="w-4 h-4" />} title="Strike-level OI Changes" subtitle="fresh writing / unwinding clusters">
        {(data.strikeOiChanges && data.strikeOiChanges.length > 0) ? <StrikeOiChangesSection list={data.strikeOiChanges} /> : <NoFeed label="strike OI changes" />}
      </SectionShell>
    ),

    fiveDayFlows: (
      <SectionShell icon={<History className="w-4 h-4" />} title="5-Day Institutional Flow" subtitle="FII / DII cash (INR Cr)">
        {data.fiveDayFlows ? <FiveDayFlowSection f={data.fiveDayFlows} /> : <NoFeed label="5-day flow" />}
      </SectionShell>
    ),

    macro: (
      <SectionShell icon={<Coins className="w-4 h-4" />} title="Macro Overlay" subtitle="DXY · US 10Y · USDINR · crude · gold">
        {data.macroOverlay ? <MacroOverlaySection m={data.macroOverlay} /> : <NoFeed label="macro overlay" />}
      </SectionShell>
    ),

    rotation: (
      <SectionShell icon={<Repeat className="w-4 h-4" />} title="Sector Rotation" subtitle="where money is moving in / out">
        {data.sectorRotation ? <SectorRotationSection r={data.sectorRotation} /> : <NoFeed label="sector rotation" />}
      </SectionShell>
    ),

    tradeSetups: (
      <SectionShell icon={<Briefcase className="w-4 h-4" />} title="Actionable Trade Setups" subtitle="derived · reporting only">
        {data.tradeSetups ? <TradeSetupsSection t={data.tradeSetups} /> : <NoFeed label="trade setups" />}
      </SectionShell>
    ),
  };

  // Every section key appears in every mode (so no info is ever hidden when data
  // exists); only the ORDER / emphasis changes per mode. Sections whose data is
  // absent self-skip (legacy sections return null; Phase-A sections show NoFeed).
  const order: string[] = isPre
    ? ["scenarios", "previews", "levels", "options", "participantOi", "indexOiBuildup", "strikeOi", "fiveDayFlows", "macro", "rotation", "heatmap", "internals", "cues", "tradeSetups", "movers", "gappers", "eventsRow"]
    : isPost
      ? ["internals", "previews", "heatmap", "rotation", "movers", "gappers", "eventsRow", "fiveDayFlows", "participantOi", "strikeOi", "indexOiBuildup", "macro", "levels", "options", "scenarios", "tradeSetups", "cues"]
      : ["previews", "scenarios", "internals", "levels", "options", "strikeOi", "participantOi", "indexOiBuildup", "heatmap", "rotation", "movers", "gappers", "macro", "fiveDayFlows", "tradeSetups", "cues", "eventsRow"];

  return (
    <div className="w-full px-4 py-6">
      <div className="flex gap-6">
        {/* Main content */}
        <div className="flex-1 min-w-0 space-y-6">

          {/* Topbar */}
          <div className="flex items-center justify-between gap-4 flex-wrap rounded-lg border border-border/60 bg-gradient-to-r from-card/80 to-card/40 px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
                <LineChart className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <div className="text-sm font-bold tracking-tight leading-none">Pro Market Analyser</div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground/70 mt-1">Hrishi Associates</div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5 text-xs font-mono">
                <span className={`w-2 h-2 rounded-full ${isLive ? "bg-signal-strong-buy animate-pulse" : isPre ? "bg-amber-400" : "bg-muted-foreground"}`} />
                <ModeIcon className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="uppercase tracking-wider text-foreground/90">{modeLabel}</span>
              </div>
              <div className="hidden sm:flex flex-col items-end leading-tight">
                <span className="text-xs font-mono tabular-nums">{istTime} IST</span>
                <span className="text-[10px] font-mono text-muted-foreground/70">{istDate}</span>
              </div>
              <button
                type="button"
                onClick={() => refetch()}
                disabled={isFetching}
                className="flex items-center gap-1.5 rounded border border-border/60 bg-secondary/40 px-2.5 py-1.5 text-[11px] font-mono hover:bg-secondary/70 transition-colors disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
                {isFetching ? "Refreshing" : "Refresh"}
              </button>
            </div>
          </div>

          {/* Ticker */}
          <TickerStrip data={data} />

          {/* 1 · Composite bias hero */}
          <CompositeBiasHero data={data} modeLabel={modeLabel} ModeIcon={ModeIcon} dataUpdatedAt={dataUpdatedAt} blurb={modeBlurb} />

          {/* Mode-ordered sections */}
          {order.map(k => (nodes[k] ? <div key={k}>{nodes[k]}</div> : null))}

          <p className="text-xs text-muted-foreground/70 font-mono text-center pt-4">
            Data refreshes every 60s · Auto-detects pre/live/post mode by IST clock · Last updated {dataUpdatedAt ? formatDistanceToNow(dataUpdatedAt, { addSuffix: true }) : "—"}
          </p>
        </div>

        {/* Right sidebar — Setup for Tomorrow */}
        <div className="hidden xl:block w-[340px] shrink-0">
          <div className="sticky top-4">
            <SetupForTomorrow data={data} />
          </div>
        </div>
      </div>

      {/* Mobile: Setup for Tomorrow below main content */}
      <div className="xl:hidden mt-6">
        <SetupForTomorrow data={data} />
      </div>
    </div>
  );
}


function Stat({ label, value, tone: t }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${t ?? "text-foreground"}`}>{value}</div>
    </div>
  );
}

interface MoverItem { symbol: string; name: string; sector?: string; price: number; change: number; changePercent: number; previousClose?: number; volume?: number }
function MoverList({ title, icon, items, positive }: { title: string; icon: React.ReactNode; items: ReadonlyArray<MoverItem>; positive: boolean }) {
  return (
    <Card className="border border-border/50">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">{icon}<span className="text-sm font-bold">{title}</span></div>
        {items.length === 0 ? (
          <div className="text-xs text-muted-foreground font-mono py-4 text-center">No qualifying movers.</div>
        ) : (
          <ul className="space-y-1">
            {items.map(s => (
              <li key={s.symbol}>
                <Link href={`/stock/${encodeURIComponent(s.symbol)}`}>
                  <div className="flex items-center justify-between gap-3 px-2 py-1.5 rounded hover-row">
                    <div className="min-w-0">
                      <div className="font-mono font-bold text-sm">{s.symbol}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{s.name}{s.sector ? ` · ${s.sector}` : ""}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm tabular-nums">{fmt(s.price)}</div>
                      <div className={`font-mono text-[10px] font-bold ${positive ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>
                        {pct(s.changePercent)}
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function GapList({ title, icon, items }: { title: string; icon: React.ReactNode; items: ReadonlyArray<{ symbol: string; name: string; sector?: string; gapPercent: number; atrPct: number; gapVsAtr?: number; signal?: string; previousClose?: number; currentPrice?: number; gapDirection?: string }> }) {
  return (
    <Card className="border border-border/50">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">{icon}<span className="text-sm font-bold">{title}</span></div>
        {items.length === 0 ? (
          <div className="text-xs text-muted-foreground font-mono py-4 text-center">No significant gaps.</div>
        ) : (
          <ul className="space-y-1">
            {items.map(g => (
              <li key={g.symbol}>
                <Link href={`/stock/${encodeURIComponent(g.symbol)}`}>
                  <div className="flex items-center justify-between gap-3 px-2 py-1.5 rounded hover-row">
                    <div className="min-w-0">
                      <div className="font-mono font-bold text-sm">{g.symbol}</div>
                      <div className="text-[10px] text-muted-foreground truncate">{g.name}</div>
                    </div>
                    <div className="text-right">
                      <div className={`font-mono text-sm tabular-nums font-bold ${tone(g.gapPercent)}`}>{pct(g.gapPercent)}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">
                        {g.gapVsAtr ? `${g.gapVsAtr.toFixed(2)}× ATR` : "—"}
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ───────── Today's 3 Scenarios ─────────
const SCENARIO_TONE: Record<string, { card: string; label: string; pill: string }> = {
  BULLISH: { card: "border-signal-strong-buy/40 bg-signal-strong-buy/[0.06]",  label: "text-signal-strong-buy",  pill: "bg-signal-strong-buy/20 text-signal-strong-buy border-signal-strong-buy/40" },
  BEARISH: { card: "border-signal-strong-sell/40 bg-signal-strong-sell/[0.06]", label: "text-signal-strong-sell", pill: "bg-signal-strong-sell/20 text-signal-strong-sell border-signal-strong-sell/40" },
  RANGE:   { card: "border-border/50 bg-secondary/30",                          label: "text-foreground/85",      pill: "bg-secondary/60 text-muted-foreground border-border/40" },
};
const PROB_TONE: Record<string, string> = {
  HIGH: "text-signal-strong-buy", MEDIUM: "text-foreground/80", LOW: "text-muted-foreground",
};
function ScenarioCard({ scenario }: { scenario: { kind: string; label: string; trigger: string; actions: string[]; invalidation?: string; probability: string } }) {
  const t = SCENARIO_TONE[scenario.kind] ?? SCENARIO_TONE["RANGE"]!;
  return (
    <Card className={`border ${t.card}`}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className={`text-xs font-mono uppercase tracking-wider font-bold ${t.label}`}>{scenario.kind}</div>
          <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${PROB_TONE[scenario.probability] ?? "text-muted-foreground"} border-current/30`}>
            {scenario.probability} prob
          </span>
        </div>
        <div className="text-sm font-bold mb-2">{scenario.label}</div>
        <div className="text-[11px] font-mono text-muted-foreground uppercase mb-1">Trigger</div>
        <p className="text-xs text-foreground/85 mb-3 leading-relaxed">{scenario.trigger}</p>
        <div className="text-[11px] font-mono text-muted-foreground uppercase mb-1">Actions</div>
        <ul className="space-y-1 text-xs mb-3">
          {scenario.actions.map((a, i) => (
            <li key={i} className="flex items-start gap-1.5"><span className="text-muted-foreground mt-0.5">·</span><span className="text-foreground/90 leading-snug">{a}</span></li>
          ))}
        </ul>
        {scenario.invalidation && (
          <>
            <div className="text-[11px] font-mono text-muted-foreground uppercase mb-1">Invalidation</div>
            <p className="text-xs text-foreground/75 leading-relaxed italic">{scenario.invalidation}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ───────── Key Index Levels (CPR + pivots) ─────────
type IxLv = {
  symbol: string; name: string; previousClose: number;
  prevHigh: number; prevLow: number; weekHigh: number; weekLow: number;
  monthHigh?: number | null; monthLow?: number | null;
  yearHigh: number; yearLow: number;
  pivot: number; r1: number; r2: number; s1: number; s2: number;
  cprTop: number; cprPivot: number; cprBottom: number; cprWidthPct: number; cprWidthLabel: string;
  positionInYearRangePct: number; todayOpen?: number | null;
};
const CPR_TONE: Record<string, string> = {
  NARROW: "bg-signal-strong-buy/15 text-signal-strong-buy border-signal-strong-buy/30",
  NORMAL: "bg-secondary/60 text-muted-foreground border-border/40",
  WIDE:   "bg-signal-strong-sell/10 text-signal-strong-sell border-signal-strong-sell/30",
};
function IndexLevelsCard({ lv }: { lv: IxLv }) {
  return (
    <Card className="border border-border/50">
      <CardContent className="p-4">
        <div className="flex items-baseline justify-between gap-2 mb-3">
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">{lv.name}</div>
            <div className="text-lg font-bold tabular-nums mt-0.5">{fmt(lv.previousClose)}</div>
          </div>
          <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${CPR_TONE[lv.cprWidthLabel] ?? CPR_TONE["NORMAL"]}`}>
            CPR {lv.cprWidthLabel} · {lv.cprWidthPct.toFixed(2)}%
          </span>
        </div>

        <div className="space-y-0.5 text-xs font-mono tabular-nums">
          <LevelRow label="R2"     value={lv.r2}        tone="text-signal-strong-sell" />
          <LevelRow label="R1"     value={lv.r1}        tone="text-signal-strong-sell/80" />
          <LevelRow label="CPR-T"  value={lv.cprTop}    tone="text-foreground/70" />
          <LevelRow label="Pivot"  value={lv.pivot}     tone="text-foreground font-bold" />
          <LevelRow label="CPR-B"  value={lv.cprBottom} tone="text-foreground/70" />
          <LevelRow label="S1"     value={lv.s1}        tone="text-signal-strong-buy/80" />
          <LevelRow label="S2"     value={lv.s2}        tone="text-signal-strong-buy" />
        </div>

        <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-border/40 text-[11px]">
          <RangeStat label="Prev day" hi={lv.prevHigh} lo={lv.prevLow} />
          <RangeStat label="Week"     hi={lv.weekHigh} lo={lv.weekLow} />
          <RangeStat label="52-wk"    hi={lv.yearHigh} lo={lv.yearLow} />
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between text-[10px] font-mono text-muted-foreground mb-1">
            <span>52-wk position</span>
            <span className="tabular-nums">{lv.positionInYearRangePct.toFixed(0)}%</span>
          </div>
          <div className="h-1.5 bg-secondary/60 rounded-full overflow-hidden">
            <div
              className={lv.positionInYearRangePct > 70 ? "h-full bg-signal-strong-buy"
                : lv.positionInYearRangePct < 30 ? "h-full bg-signal-strong-sell"
                : "h-full bg-foreground/40"}
              style={{ width: `${Math.max(2, Math.min(100, lv.positionInYearRangePct))}%` }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
function LevelRow({ label, value, tone: t }: { label: string; value: number; tone: string }) {
  return (
    <div className={`flex items-center justify-between gap-2 ${t}`}>
      <span className="text-muted-foreground/90 w-12">{label}</span>
      <span className="tabular-nums">{fmt(value)}</span>
    </div>
  );
}
function RangeStat({ label, hi, lo }: { label: string; hi: number; lo: number }) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase text-muted-foreground">{label}</div>
      <div className="font-mono tabular-nums text-signal-strong-buy text-[11px]">{fmt(hi)}</div>
      <div className="font-mono tabular-nums text-signal-strong-sell text-[11px]">{fmt(lo)}</div>
    </div>
  );
}

// ───────── Option Chain Snapshot ─────────
type OptSnap = {
  underlying: string; spot: number; expiry: string;
  daysToExpiry?: number; expiryContext?: string;
  atmStrike: number; atmStraddle: number; expectedMovePct: number;
  pcrOi: number; pcrVolume: number; atmIv?: number | null; maxPain: number;
  maxCallOiStrike?: number | null; maxPutOiStrike?: number | null;
  bias: string; interpretation: string;
};
const OPT_BIAS_TONE: Record<string, string> = {
  BULLISH: "bg-signal-strong-buy/15 text-signal-strong-buy border-signal-strong-buy/30",
  BEARISH: "bg-signal-strong-sell/15 text-signal-strong-sell border-signal-strong-sell/30",
  NEUTRAL: "bg-secondary/60 text-muted-foreground border-border/40",
};
const EXPIRY_TONE: Record<string, { tone: string; label: string }> = {
  EXPIRY_TODAY:     { tone: "bg-signal-strong-sell/20 text-signal-strong-sell border-signal-strong-sell/50",  label: "EXPIRY TODAY" },
  EXPIRY_TOMORROW:  { tone: "bg-amber-500/20 text-amber-400 border-amber-500/40",                              label: "EXPIRY TOMORROW" },
  EXPIRY_THIS_WEEK: { tone: "bg-amber-500/10 text-amber-300 border-amber-500/30",                              label: "EXPIRY THIS WEEK" },
  EXPIRY_NEXT_WEEK: { tone: "bg-secondary/60 text-muted-foreground border-border/40",                          label: "NEXT WEEK" },
  FAR:              { tone: "bg-secondary/40 text-muted-foreground border-border/30",                          label: "FAR" },
};
function OptionSnapshotCard({ snap }: { snap: OptSnap }) {
  const expCtx = snap.expiryContext ? EXPIRY_TONE[snap.expiryContext] : undefined;
  return (
    <Card className="border border-border/50">
      <CardContent className="p-4">
        <div className="flex items-baseline justify-between gap-2 mb-2">
          <div className="text-sm font-bold font-mono">{snap.underlying}</div>
          <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${OPT_BIAS_TONE[snap.bias] ?? OPT_BIAS_TONE["NEUTRAL"]}`}>
            {snap.bias}
          </span>
        </div>
        <div className="text-[10px] font-mono text-muted-foreground mb-2 flex items-center flex-wrap gap-1.5">
          <span>spot {fmt(snap.spot)}</span>
          <span>·</span>
          <span>expiry {snap.expiry}</span>
          {snap.daysToExpiry != null && (
            <>
              <span>·</span>
              <span>{snap.daysToExpiry === 0 ? "0d" : `${snap.daysToExpiry}d`}</span>
            </>
          )}
          {expCtx && snap.expiryContext !== "FAR" && snap.expiryContext !== "EXPIRY_NEXT_WEEK" && (
            <span className={`text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border ${expCtx.tone}`}>
              {expCtx.label}
            </span>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <KV label="ATM Strike"   value={fmt(snap.atmStrike, 0)} />
          <KV label="ATM Straddle" value={fmt(snap.atmStraddle)} />
          <KV label="Exp. Move"    value={`±${snap.expectedMovePct.toFixed(2)}%`} tone="text-foreground font-bold" />
          <KV label="ATM IV"       value={snap.atmIv != null ? `${snap.atmIv.toFixed(1)}%` : "—"} />
          <KV label="PCR (OI)"     value={snap.pcrOi.toFixed(2)} tone={snap.pcrOi > 1.2 ? "text-signal-strong-buy" : snap.pcrOi < 0.8 ? "text-signal-strong-sell" : ""} />
          <KV label="PCR (Vol)"    value={snap.pcrVolume.toFixed(2)} />
          <KV label="Max Pain"     value={fmt(snap.maxPain, 0)} />
          <KV label="Resistance"   value={snap.maxCallOiStrike != null ? fmt(snap.maxCallOiStrike, 0) : "—"} tone="text-signal-strong-sell" />
          <KV label="Support"      value={snap.maxPutOiStrike  != null ? fmt(snap.maxPutOiStrike, 0)  : "—"} tone="text-signal-strong-buy" />
        </div>

        {snap.interpretation && (
          <p className="text-xs text-foreground/80 mt-3 pt-3 border-t border-border/40 leading-relaxed">
            {snap.interpretation}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
function KV({ label, value, tone: t }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase text-muted-foreground">{label}</div>
      <div className={`font-mono tabular-nums text-sm ${t ?? ""}`}>{value}</div>
    </div>
  );
}

// ───────── Sector Heatmap tile ─────────
function SectorTile({ s }: { s: { sector: string; avgChangePercent: number; gainers: number; losers: number; stockCount: number; topPickSymbol?: string } }) {
  const intensity = Math.min(1, Math.abs(s.avgChangePercent) / 2.5);
  const bg = s.avgChangePercent > 0
    ? `rgba(34,197,94,${0.08 + intensity * 0.22})`
    : s.avgChangePercent < 0
      ? `rgba(239,68,68,${0.08 + intensity * 0.22})`
      : "rgba(148,163,184,0.08)";
  return (
    <div
      className="rounded border border-border/40 p-2.5 transition-colors"
      style={{ backgroundColor: bg }}
      title={`${s.gainers} up · ${s.losers} down out of ${s.stockCount}${s.topPickSymbol ? ` · top: ${s.topPickSymbol}` : ""}`}
    >
      <div className="text-[11px] font-medium truncate">{s.sector}</div>
      <div className={`text-sm font-bold font-mono tabular-nums ${tone(s.avgChangePercent)}`}>
        {pct(s.avgChangePercent)}
      </div>
      <div className="text-[9px] font-mono text-muted-foreground mt-0.5">
        <span className="text-signal-strong-buy">{s.gainers}↑</span> · <span className="text-signal-strong-sell">{s.losers}↓</span> · {s.stockCount} stk
      </div>
    </div>
  );
}

// ───────── FII / DII snapshot ─────────
function FiiDiiCard({ f }: { f: { latestDate: string; fiiCashCr: number; diiCashCr: number; fiveDayFiiCr: number; fiveDayDiiCr: number } }) {
  return (
    <Card className="border border-border/50">
      <CardContent className="p-4">
        <div className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-2">
          <Building2 className="w-3.5 h-3.5" /> FII / DII Cash · {f.latestDate}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FlowStat label="FII (latest)"  value={f.fiiCashCr}    />
          <FlowStat label="DII (latest)"  value={f.diiCashCr}    />
          <FlowStat label="FII (5-day)"   value={f.fiveDayFiiCr} />
          <FlowStat label="DII (5-day)"   value={f.fiveDayDiiCr} />
        </div>
        <div className="mt-3 pt-3 border-t border-border/40 text-[10px] font-mono text-muted-foreground leading-relaxed">
          {(f.diiCashCr > 0 && f.fiiCashCr < 0) ? "DII absorbing FII selling — typically supportive." :
           (f.diiCashCr < 0 && f.fiiCashCr < 0) ? "Both sides selling — caution; weak hands lifting bids." :
           (f.diiCashCr > 0 && f.fiiCashCr > 0) ? "Both sides buying — strong undertone." :
           "Mixed flows."}
        </div>
      </CardContent>
    </Card>
  );
}
function FlowStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[10px] font-mono uppercase text-muted-foreground">{label}</div>
      <div className={`font-mono tabular-nums text-sm font-bold ${tone(value)}`}>
        {value >= 0 ? "+" : ""}{value.toLocaleString("en-IN", { maximumFractionDigits: 0 })} <span className="text-[9px] text-muted-foreground font-normal">Cr</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
//  Setup for Tomorrow — right-side panel (Moneycontrol-style
//  "15 things to know before the opening bell")
// ═══════════════════════════════════════════════════════════════

function SetupForTomorrow({ data }: { data: PreMarketReport }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const toggle = (k: string) => setExpanded(p => ({ ...p, [k]: !p[k] }));

  const niftyLevels = data.indexLevels?.find((l: { symbol: string }) => l.symbol === "^NSEI");
  const bnLevels = data.indexLevels?.find((l: { symbol: string }) => l.symbol === "^NSEBANK");
  const niftyOpt = data.optionSnapshots?.find((o: { underlying: string }) => o.underlying === "NIFTY");
  const bnOpt = data.optionSnapshots?.find((o: { underlying: string }) => o.underlying === "BANKNIFTY");
  const vixCue = data.overnightCues?.find((c: { label?: string }) => c.label === "India VIX");
  const setup = data.tomorrowSetup;
  const oi = setup?.oiBuildupSummary;

  const items: Array<{
    num: number;
    icon: React.ReactNode;
    title: string;
    subtitle?: string;
    content: React.ReactNode;
    expandKey?: string;
    available: boolean;
  }> = [
    {
      num: 1,
      icon: <Target className="w-3.5 h-3.5 text-blue-400" />,
      title: "Nifty 50 Key Levels",
      subtitle: niftyLevels ? `Prev close ${fmt(niftyLevels.previousClose)}` : undefined,
      available: !!niftyLevels,
      content: niftyLevels ? <KeyLevelsBlock lv={niftyLevels} /> : null,
    },
    {
      num: 2,
      icon: <Target className="w-3.5 h-3.5 text-purple-400" />,
      title: "Bank Nifty Key Levels",
      subtitle: bnLevels ? `Prev close ${fmt(bnLevels.previousClose)}` : undefined,
      available: !!bnLevels,
      content: bnLevels ? <KeyLevelsBlock lv={bnLevels} /> : null,
    },
    {
      num: 3,
      icon: <Crosshair className="w-3.5 h-3.5 text-red-400" />,
      title: "Nifty Option Walls",
      subtitle: niftyOpt ? expiryTagText(niftyOpt) : undefined,
      available: !!niftyOpt && (!!niftyOpt.maxCallOiStrike || !!niftyOpt.maxPutOiStrike),
      content: niftyOpt ? <OptionWallsBlock opt={niftyOpt} /> : null,
    },
    {
      num: 4,
      icon: <Gauge className="w-3.5 h-3.5 text-green-400" />,
      title: "Nifty Option Snapshot",
      subtitle: niftyOpt ? `ATM ${fmt(niftyOpt.atmStrike, 0)}` : undefined,
      available: !!niftyOpt,
      content: niftyOpt ? <OptionSnapshotBlock opt={niftyOpt} /> : null,
    },
    {
      num: 5,
      icon: <Crosshair className="w-3.5 h-3.5 text-red-300" />,
      title: "Bank Nifty Option Walls",
      subtitle: bnOpt ? expiryTagText(bnOpt) : undefined,
      available: !!bnOpt && (!!bnOpt.maxCallOiStrike || !!bnOpt.maxPutOiStrike),
      content: bnOpt ? <OptionWallsBlock opt={bnOpt} /> : null,
    },
    {
      num: 6,
      icon: <Gauge className="w-3.5 h-3.5 text-green-300" />,
      title: "Bank Nifty Option Snapshot",
      subtitle: bnOpt ? `ATM ${fmt(bnOpt.atmStrike, 0)}` : undefined,
      available: !!bnOpt,
      content: bnOpt ? <OptionSnapshotBlock opt={bnOpt} /> : null,
    },
    {
      num: 7,
      icon: <Building2 className="w-3.5 h-3.5 text-amber-400" />,
      title: "FII / DII Flows",
      subtitle: data.fiiDii ? `as of ${data.fiiDii.latestDate}` : undefined,
      available: !!data.fiiDii,
      content: data.fiiDii ? <FiiDiiBlock f={data.fiiDii} /> : null,
    },
    {
      num: 8,
      icon: <Gauge className="w-3.5 h-3.5 text-cyan-400" />,
      title: "Put-Call Ratio",
      subtitle: niftyOpt ? "OI + Volume" : undefined,
      available: !!niftyOpt,
      content: niftyOpt ? <PcrBlock niftyOpt={niftyOpt} bnOpt={bnOpt} /> : null,
    },
    {
      num: 9,
      icon: <Zap className="w-3.5 h-3.5 text-yellow-400" />,
      title: "India VIX",
      subtitle: vixCue ? vixRegimeLabel(vixCue.value) : undefined,
      available: !!vixCue,
      content: vixCue ? <VixBlock cue={vixCue} /> : null,
    },
    {
      num: 10,
      icon: <TrendingUp className="w-3.5 h-3.5 text-signal-strong-buy" />,
      title: `Long Buildup (${oi?.longBuildup ?? 0})`,
      available: !!oi,
      expandKey: "longBuildup",
      content: oi ? (
        <div className="text-xs space-y-1">
          <div className="text-[10px] text-muted-foreground/80 mb-1">Price ↑ + OI ↑ — fresh longs being added</div>
          {expanded["longBuildup"] && oi.topLongBuildup && oi.topLongBuildup.length > 0 && (
            <div className="space-y-0.5">
              {oi.topLongBuildup.map(s => (
                <div key={s.symbol} className="flex justify-between">
                  <Link href={`/stock/${encodeURIComponent(s.symbol ?? "")}`} className="font-mono text-signal-strong-buy hover:underline">{s.symbol}</Link>
                  <span className="font-mono tabular-nums text-muted-foreground">OI {pct(s.oiChgPct)} · Price {pct(s.priceChgPct)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null,
    },
    {
      num: 11,
      icon: <TrendingDown className="w-3.5 h-3.5 text-muted-foreground" />,
      title: `Long Unwinding (${oi?.longUnwinding ?? 0})`,
      available: !!oi,
      expandKey: "longUnwinding",
      content: oi ? (
        <div className="text-xs space-y-1">
          <div className="text-[10px] text-muted-foreground/80 mb-1">Price ↓ + OI ↓ — longs exiting</div>
          {expanded["longUnwinding"] && oi.topLongUnwinding && oi.topLongUnwinding.length > 0 && (
            <div className="space-y-0.5">
              {oi.topLongUnwinding.map(s => (
                <div key={s.symbol} className="flex justify-between">
                  <Link href={`/stock/${encodeURIComponent(s.symbol ?? "")}`} className="font-mono text-muted-foreground hover:underline">{s.symbol}</Link>
                  <span className="font-mono tabular-nums text-muted-foreground">OI {pct(s.oiChgPct)} · Price {pct(s.priceChgPct)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null,
    },
    {
      num: 12,
      icon: <TrendingDown className="w-3.5 h-3.5 text-signal-strong-sell" />,
      title: `Short Buildup (${oi?.shortBuildup ?? 0})`,
      available: !!oi,
      expandKey: "shortBuildup",
      content: oi ? (
        <div className="text-xs space-y-1">
          <div className="text-[10px] text-muted-foreground/80 mb-1">Price ↓ + OI ↑ — fresh shorts being added</div>
          {expanded["shortBuildup"] && oi.topShortBuildup && oi.topShortBuildup.length > 0 && (
            <div className="space-y-0.5">
              {oi.topShortBuildup.map(s => (
                <div key={s.symbol} className="flex justify-between">
                  <Link href={`/stock/${encodeURIComponent(s.symbol ?? "")}`} className="font-mono text-signal-strong-sell hover:underline">{s.symbol}</Link>
                  <span className="font-mono tabular-nums text-muted-foreground">OI {pct(s.oiChgPct)} · Price {pct(s.priceChgPct)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null,
    },
    {
      num: 13,
      icon: <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />,
      title: `Short Covering (${oi?.shortCovering ?? 0})`,
      available: !!oi,
      expandKey: "shortCovering",
      content: oi ? (
        <div className="text-xs space-y-1">
          <div className="text-[10px] text-muted-foreground/80 mb-1">Price ↑ + OI ↓ — shorts exiting</div>
          {expanded["shortCovering"] && oi.topShortCovering && oi.topShortCovering.length > 0 && (
            <div className="space-y-0.5">
              {oi.topShortCovering.map(s => (
                <div key={s.symbol} className="flex justify-between">
                  <Link href={`/stock/${encodeURIComponent(s.symbol ?? "")}`} className="font-mono text-emerald-400 hover:underline">{s.symbol}</Link>
                  <span className="font-mono tabular-nums text-muted-foreground">OI {pct(s.oiChgPct)} · Price {pct(s.priceChgPct)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null,
    },
    {
      num: 14,
      icon: <Package className="w-3.5 h-3.5 text-sky-400" />,
      title: `High Delivery (${setup?.highDeliveryStocks?.length ?? 0})`,
      available: (setup?.highDeliveryStocks?.length ?? 0) > 0,
      expandKey: "delivery",
      content: setup?.highDeliveryStocks && setup.highDeliveryStocks.length > 0 ? (
        <div className="text-xs space-y-1">
          <div className="text-[10px] text-muted-foreground/80 mb-1">50%+ delivery — investing (not trading) interest</div>
          {expanded["delivery"] && (
            <div className="space-y-0.5">
              {setup.highDeliveryStocks.slice(0, 10).map(s => (
                <div key={s.symbol} className="flex justify-between">
                  <Link href={`/stock/${encodeURIComponent(s.symbol ?? "")}`} className="font-mono text-sky-400 hover:underline">{s.symbol}</Link>
                  <span className="font-mono tabular-nums text-muted-foreground">{s.deliveryPct?.toFixed(1)}%</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null,
    },
    {
      num: 15,
      icon: <Ban className="w-3.5 h-3.5 text-orange-400" />,
      title: "F&O Ban",
      available: !!setup,
      content: (
        <div className="text-xs">
          {!setup ? (
            <span className="text-muted-foreground/70">Ban data unavailable</span>
          ) : setup.foBanStocks && setup.foBanStocks.length > 0 ? (
            <div className="space-y-0.5">
              {setup.foBanStocks.map(s => (
                <Link key={s} href={`/stock/${encodeURIComponent(s)}`} className="font-mono text-orange-400 hover:underline block">{s}</Link>
              ))}
            </div>
          ) : (
            <span className="text-signal-strong-buy/70">No stocks under F&O ban</span>
          )}
        </div>
      ),
    },
  ];

  // Section grouping: 1-2 = key levels, 3-6 = option chain (Nifty + BN), 7-9 = macro, 10-15 = stock activity
  const sectionFor = (n: number): "LEVELS" | "OPTIONS" | "MACRO" | "STOCKS" =>
    n <= 2 ? "LEVELS" : n <= 6 ? "OPTIONS" : n <= 9 ? "MACRO" : "STOCKS";
  const sectionTitle: Record<string, string> = {
    LEVELS: "Key Levels",
    OPTIONS: "Option-Chain Setup",
    MACRO: "Macro & Sentiment",
    STOCKS: "F&O Stock Activity",
  };

  return (
    <Card className="border-2 border-border/70 bg-card/80 backdrop-blur-sm shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-4 pb-3 border-b-2 border-border/50">
          <ClipboardList className="w-4 h-4 text-amber-400" />
          <h2 className="text-sm font-bold tracking-tight">Setup for Tomorrow</h2>
          <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded border border-amber-500/30 bg-amber-500/10 text-amber-400 ml-auto">
            15 pts
          </span>
        </div>

        <div className="space-y-2">
          {items.map((item, i) => {
            const sec = sectionFor(item.num);
            const prevSec = i > 0 ? sectionFor(items[i - 1]!.num) : null;
            const showHeader = sec !== prevSec;
            return (
              <div key={item.num}>
                {showHeader && (
                  <div className="flex items-center gap-2 mt-3 first:mt-0 mb-1.5">
                    <div className="h-px flex-1 bg-border/40" />
                    <span className="text-[9px] font-mono uppercase tracking-widest text-muted-foreground/60">
                      {sectionTitle[sec]}
                    </span>
                    <div className="h-px flex-1 bg-border/40" />
                  </div>
                )}
                <SetupItem
                  num={item.num}
                  icon={item.icon}
                  title={item.title}
                  subtitle={item.subtitle}
                  available={item.available}
                  expandable={!!item.expandKey}
                  isExpanded={!!item.expandKey && !!expanded[item.expandKey]}
                  onToggle={item.expandKey ? () => toggle(item.expandKey!) : undefined}
                >
                  {item.content}
                </SetupItem>
              </div>
            );
          })}
        </div>

        <div className="mt-4 pt-3 border-t-2 border-border/50">
          <div className="text-[10px] text-muted-foreground/70 font-mono text-center">
            Data populates post-market · Global cues update overnight
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Per-item subcard wrapper — bordered for ease of reading ───
function SetupItem({
  num, icon, title, subtitle, available, expandable, isExpanded, onToggle, children,
}: {
  num: number;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  available: boolean;
  expandable?: boolean;
  isExpanded?: boolean;
  onToggle?: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border border-border/60 bg-secondary/15 overflow-hidden transition-colors ${
        !available ? "opacity-40" : "hover:border-border/80"
      }`}
    >
      <button
        type="button"
        className={`flex items-center gap-2 w-full text-left px-2.5 py-2 ${
          expandable && available
            ? "cursor-pointer hover:bg-secondary/30"
            : "cursor-default"
        } ${available && children ? "border-b border-border/40" : ""}`}
        onClick={expandable && available ? onToggle : undefined}
        disabled={!expandable || !available}
      >
        <span className="text-[10px] font-mono font-bold text-muted-foreground/70 w-5 text-right shrink-0 tabular-nums">
          {num}
        </span>
        <span className="shrink-0">{icon}</span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold truncate leading-tight">{title}</div>
          {subtitle && (
            <div className="text-[10px] text-muted-foreground/70 font-mono truncate leading-tight mt-0.5">
              {subtitle}
            </div>
          )}
        </div>
        {expandable && available && (
          isExpanded
            ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
            : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        )}
        {!available && (
          <span className="text-[9px] text-muted-foreground/50 font-mono shrink-0">no data</span>
        )}
      </button>
      {available && children && (
        <div className="px-3 py-2 bg-card/40">{children}</div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Per-item content blocks — each surfaces all available fields
// from the OpenAPI schema (KeyIndexLevels, OptionSnapshot,
// FiiDiiSnapshot, OvernightCue) instead of just one or two.
// ═══════════════════════════════════════════════════════════════

type LevelsLike = NonNullable<PreMarketReport["indexLevels"]>[number];
type OptLike    = NonNullable<PreMarketReport["optionSnapshots"]>[number];
type CueLike    = PreMarketReport["overnightCues"][number];
type FiiLike    = NonNullable<PreMarketReport["fiiDii"]>;

function KvRow({ label, value, valueClass }: { label: React.ReactNode; value: React.ReactNode; valueClass?: string }) {
  return (
    <div className="flex justify-between items-baseline gap-2 text-xs py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={`font-mono tabular-nums ${valueClass ?? ""}`}>{value}</span>
    </div>
  );
}

function KeyLevelsBlock({ lv }: { lv: LevelsLike }) {
  // Position-in-52w bar — visual where price sits in the yearly range.
  const pos = Math.max(0, Math.min(100, lv.positionInYearRangePct));
  return (
    <div className="space-y-1.5">
      <KvRow label="Pivot" value={fmt(lv.pivot)} valueClass="font-bold" />
      <KvRow label="R1 / R2" value={`${fmt(lv.r1)} / ${fmt(lv.r2)}`} valueClass="text-signal-strong-sell/90" />
      <KvRow label="S1 / S2" value={`${fmt(lv.s1)} / ${fmt(lv.s2)}`} valueClass="text-signal-strong-buy/90" />
      <KvRow
        label="CPR"
        value={
          <>
            {fmt(lv.cprBottom)}–{fmt(lv.cprTop)}{" "}
            <span className={`text-[10px] ${
              lv.cprWidthLabel === "NARROW" ? "text-amber-400"
              : lv.cprWidthLabel === "WIDE" ? "text-cyan-400"
              : "text-muted-foreground/70"
            }`}>
              ({lv.cprWidthLabel} {lv.cprWidthPct.toFixed(2)}%)
            </span>
          </>
        }
        valueClass="text-[11px]"
      />
      <KvRow label="Prev H / L" value={`${fmt(lv.prevHigh)} / ${fmt(lv.prevLow)}`} />
      {lv.todayOpen != null && (
        <KvRow label="Today's Open" value={fmt(lv.todayOpen)} valueClass="text-foreground/90" />
      )}
      <KvRow label="52W H / L" value={`${fmt(lv.yearHigh)} / ${fmt(lv.yearLow)}`} valueClass="text-[11px]" />
      <div className="pt-1">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground/80 mb-1">
          <span>Position in 52W range</span>
          <span className="font-mono tabular-nums">{pos.toFixed(0)}%</span>
        </div>
        <div className="relative h-1.5 rounded-full bg-secondary/60 overflow-hidden">
          <div
            className="absolute top-0 h-full bg-gradient-to-r from-signal-strong-sell/70 via-amber-500/70 to-signal-strong-buy/70"
            style={{ width: `${pos}%` }}
          />
          <div
            className="absolute top-0 h-full w-0.5 bg-foreground"
            style={{ left: `${pos}%`, transform: "translateX(-50%)" }}
          />
        </div>
        <div className="flex justify-between text-[9px] font-mono text-muted-foreground/60 mt-0.5">
          <span>{fmt(lv.yearLow, 0)}</span>
          <span>{fmt(lv.yearHigh, 0)}</span>
        </div>
      </div>
      {lv.cprWidthLabel === "NARROW" && (
        <div className="text-[10px] text-amber-400/90 mt-1">
          Narrow CPR → trending day likely
        </div>
      )}
      {lv.cprWidthLabel === "WIDE" && (
        <div className="text-[10px] text-cyan-400/90 mt-1">
          Wide CPR → range / chop likely
        </div>
      )}
    </div>
  );
}

function expiryTagText(opt: OptLike): string {
  const tag =
    opt.expiryContext === "EXPIRY_TODAY" ? "Expires today"
    : opt.expiryContext === "EXPIRY_TOMORROW" ? "Expires tomorrow"
    : opt.expiryContext === "EXPIRY_THIS_WEEK" ? `Expires this week (${opt.daysToExpiry}d)`
    : opt.expiryContext === "EXPIRY_NEXT_WEEK" ? `Next week (${opt.daysToExpiry}d)`
    : `${opt.daysToExpiry}d to expiry`;
  return tag;
}

function OptionWallsBlock({ opt }: { opt: OptLike }) {
  const ceDist = opt.maxCallOiStrike != null && opt.spot > 0
    ? ((opt.maxCallOiStrike - opt.spot) / opt.spot) * 100
    : null;
  const peDist = opt.maxPutOiStrike != null && opt.spot > 0
    ? ((opt.maxPutOiStrike - opt.spot) / opt.spot) * 100
    : null;
  const mpDist = opt.maxPain != null && opt.spot > 0
    ? ((opt.maxPain - opt.spot) / opt.spot) * 100
    : null;
  return (
    <div className="space-y-1.5">
      {opt.maxCallOiStrike != null && (
        <KvRow
          label="Max CE OI (resistance)"
          value={
            <>
              <span className="text-signal-strong-sell font-bold">{fmt(opt.maxCallOiStrike, 0)}</span>
              {ceDist != null && (
                <span className="text-[10px] text-muted-foreground/70 ml-1">
                  ({ceDist >= 0 ? "+" : ""}{ceDist.toFixed(2)}%)
                </span>
              )}
            </>
          }
        />
      )}
      {opt.maxPutOiStrike != null && (
        <KvRow
          label="Max PE OI (support)"
          value={
            <>
              <span className="text-signal-strong-buy font-bold">{fmt(opt.maxPutOiStrike, 0)}</span>
              {peDist != null && (
                <span className="text-[10px] text-muted-foreground/70 ml-1">
                  ({peDist >= 0 ? "+" : ""}{peDist.toFixed(2)}%)
                </span>
              )}
            </>
          }
        />
      )}
      <KvRow
        label="Max Pain"
        value={
          <>
            <span className="text-amber-400 font-bold">{fmt(opt.maxPain, 0)}</span>
            {mpDist != null && (
              <span className="text-[10px] text-muted-foreground/70 ml-1">
                ({mpDist >= 0 ? "+" : ""}{mpDist.toFixed(2)}%)
              </span>
            )}
          </>
        }
      />
      <KvRow label="Spot" value={fmt(opt.spot)} valueClass="text-muted-foreground" />
      <div className="text-[10px] text-muted-foreground/80 mt-1.5 pt-1.5 border-t border-border/30">
        Walls = strikes with the largest open interest. Price tends to gravitate toward Max Pain into expiry.
      </div>
    </div>
  );
}

function OptionSnapshotBlock({ opt }: { opt: OptLike }) {
  const expectedMovePts = opt.atmStraddle;
  const biasTone = opt.bias === "BULLISH" ? "text-signal-strong-buy"
                 : opt.bias === "BEARISH" ? "text-signal-strong-sell"
                 : "text-muted-foreground";
  const biasBg = opt.bias === "BULLISH" ? "bg-signal-strong-buy/10 border-signal-strong-buy/30"
               : opt.bias === "BEARISH" ? "bg-signal-strong-sell/10 border-signal-strong-sell/30"
               : "bg-secondary/40 border-border/40";
  return (
    <div className="space-y-1.5">
      <KvRow label="ATM Strike" value={fmt(opt.atmStrike, 0)} valueClass="font-bold" />
      <KvRow
        label="ATM Straddle"
        value={
          <>
            ₹{fmt(opt.atmStraddle, 0)}
            <span className="text-[10px] text-muted-foreground/70 ml-1">pts</span>
          </>
        }
      />
      <KvRow
        label="Expected Move"
        value={
          <>
            ±{opt.expectedMovePct.toFixed(2)}%
            <span className="text-[10px] text-muted-foreground/70 ml-1">
              (±{fmt(expectedMovePts, 0)} pts)
            </span>
          </>
        }
        valueClass="font-bold"
      />
      {opt.atmIv != null && (
        <KvRow label="ATM IV" value={`${opt.atmIv.toFixed(1)}%`} />
      )}
      <KvRow
        label="Days to Expiry"
        value={`${opt.daysToExpiry}d`}
        valueClass={opt.daysToExpiry === 0 ? "text-amber-400 font-bold" : ""}
      />
      <div className={`mt-2 px-2 py-1.5 rounded border ${biasBg}`}>
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <span className="text-[10px] font-mono uppercase text-muted-foreground/80">Bias</span>
          <span className={`text-xs font-bold ${biasTone}`}>{opt.bias}</span>
        </div>
        <div className="text-[10px] text-foreground/85 leading-snug">{opt.interpretation}</div>
      </div>
    </div>
  );
}

function FiiDiiBlock({ f }: { f: FiiLike }) {
  // Combined net = directional pressure on cash market.
  const combined = f.fiiCashCr + f.diiCashCr;
  return (
    <div className="space-y-1.5">
      <KvRow
        label="FII Net"
        value={
          <span className={`font-bold ${tone(f.fiiCashCr)}`}>
            {f.fiiCashCr >= 0 ? "+" : ""}
            {f.fiiCashCr.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr
          </span>
        }
      />
      <KvRow
        label="DII Net"
        value={
          <span className={`font-bold ${tone(f.diiCashCr)}`}>
            {f.diiCashCr >= 0 ? "+" : ""}
            {f.diiCashCr.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr
          </span>
        }
      />
      <KvRow
        label="Combined"
        value={
          <span className={`font-bold ${tone(combined)}`}>
            {combined >= 0 ? "+" : ""}
            {combined.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr
          </span>
        }
      />
      <div className="pt-1.5 mt-1 border-t border-border/30 space-y-0.5">
        <KvRow
          label="5d FII"
          value={
            <span className={tone(f.fiveDayFiiCr)}>
              {f.fiveDayFiiCr >= 0 ? "+" : ""}
              {f.fiveDayFiiCr.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr
            </span>
          }
          valueClass="text-[11px]"
        />
        <KvRow
          label="5d DII"
          value={
            <span className={tone(f.fiveDayDiiCr)}>
              {f.fiveDayDiiCr >= 0 ? "+" : ""}
              {f.fiveDayDiiCr.toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr
            </span>
          }
          valueClass="text-[11px]"
        />
      </div>
      <div className="text-[10px] text-muted-foreground/80 mt-1.5">
        {Math.abs(f.fiiCashCr) > 1500 && f.fiiCashCr * f.diiCashCr < 0
          ? "FIIs and DIIs are tugging in opposite directions — choppy intraday tape likely."
          : combined > 1000
            ? "Net inflow — supports gap-ups and dip buys."
            : combined < -1000
              ? "Net outflow — caps rallies, supports breakdowns."
              : "Flows roughly balanced — direction set by global cues."}
      </div>
    </div>
  );
}

function PcrBlock({ niftyOpt, bnOpt }: { niftyOpt: OptLike; bnOpt?: OptLike }) {
  const pcrTone = (p: number) =>
    p >= 1.3 ? "text-signal-strong-buy"
    : p <= 0.7 ? "text-signal-strong-sell"
    : "text-foreground";
  // Confluence between OI PCR and Volume PCR is the strongest read.
  const niftyAligned = (niftyOpt.pcrOi >= 1.2 && niftyOpt.pcrVolume >= 1.2)
                    || (niftyOpt.pcrOi <= 0.8 && niftyOpt.pcrVolume <= 0.8);
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-3 gap-2 items-center text-xs">
        <span className="text-muted-foreground">Index</span>
        <span className="text-right text-[10px] font-mono uppercase text-muted-foreground/70">PCR (OI)</span>
        <span className="text-right text-[10px] font-mono uppercase text-muted-foreground/70">PCR (Vol)</span>
      </div>
      <div className="grid grid-cols-3 gap-2 items-center text-xs">
        <span className="font-medium">Nifty</span>
        <span className={`text-right font-mono tabular-nums font-bold ${pcrTone(niftyOpt.pcrOi)}`}>
          {niftyOpt.pcrOi.toFixed(2)}
        </span>
        <span className={`text-right font-mono tabular-nums ${pcrTone(niftyOpt.pcrVolume)}`}>
          {niftyOpt.pcrVolume.toFixed(2)}
        </span>
      </div>
      {bnOpt && (
        <div className="grid grid-cols-3 gap-2 items-center text-xs">
          <span className="font-medium">Bank Nifty</span>
          <span className={`text-right font-mono tabular-nums font-bold ${pcrTone(bnOpt.pcrOi)}`}>
            {bnOpt.pcrOi.toFixed(2)}
          </span>
          <span className={`text-right font-mono tabular-nums ${pcrTone(bnOpt.pcrVolume)}`}>
            {bnOpt.pcrVolume.toFixed(2)}
          </span>
        </div>
      )}
      <div className="text-[10px] text-muted-foreground/80 mt-1.5 pt-1.5 border-t border-border/30 leading-snug">
        {niftyOpt.pcrOi >= 1.3
          ? "Nifty PCR ≥ 1.3 → heavy put writing, bullish undertone."
          : niftyOpt.pcrOi <= 0.7
            ? "Nifty PCR ≤ 0.7 → call-heavy, bearish pressure."
            : niftyOpt.pcrOi >= 1.0
              ? "Nifty PCR mildly elevated → neutral-to-bullish positioning."
              : "Nifty PCR balanced → no clear directional bias."}
        {niftyAligned && (
          <span className="text-emerald-400/90"> OI + Volume PCR aligned (strong signal).</span>
        )}
      </div>
    </div>
  );
}

function vixRegimeLabel(v: number | null | undefined): string {
  if (v == null) return "";
  if (v >= 20) return "High volatility";
  if (v >= 15) return "Elevated";
  if (v >= 12) return "Moderate";
  return "Complacent";
}

function VixBlock({ cue }: { cue: CueLike }) {
  const v = cue.value ?? 0;
  const chg = cue.change ?? 0;
  const chgPct = cue.changePercent ?? 0;
  // VIX is inverted vs equities — rising VIX = bearish, falling = bullish.
  const equityImplication =
    chgPct > 5 ? "Sharp VIX spike → equities under stress."
    : chgPct > 0 ? "VIX up → equities biased weaker."
    : chgPct < -5 ? "Sharp VIX drop → risk appetite returning."
    : "VIX cooling → equity-positive."
  const regime =
    v >= 20 ? "High volatility — wider stops, smaller size, expect violent intraday swings."
    : v >= 15 ? "Elevated — option premiums richer than usual; favour debit-spreads over naked longs."
    : v >= 12 ? "Moderate — normal volatility environment."
    : "Complacent — surprise moves possible; avoid selling cheap volatility.";
  return (
    <div className="space-y-1.5">
      <KvRow label="Level" value={v.toFixed(2)} valueClass="font-bold text-base" />
      <KvRow
        label="Change"
        value={
          <span className={tone(-chgPct)}>
            {chg >= 0 ? "+" : ""}{chg.toFixed(2)} ({pct(chgPct)})
          </span>
        }
      />
      <div className="text-[10px] text-muted-foreground/85 mt-1.5 pt-1.5 border-t border-border/30 leading-snug">
        {regime}
      </div>
      <div className={`text-[10px] mt-0.5 ${chgPct > 0 ? "text-signal-strong-sell/90" : "text-signal-strong-buy/90"}`}>
        {equityImplication}
      </div>
    </div>
  );
}
