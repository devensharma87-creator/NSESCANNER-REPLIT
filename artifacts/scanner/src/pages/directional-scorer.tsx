// Dual-model directional scorer — PREPOST & INTRADAY modes
// Ported from reference HTML (market-scorer.html). Pure client-side,
// localStorage-backed. No backend dependency — bias-filter only, never a trade signal.
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertTriangle, Activity, BarChart2, Download, RefreshCw,
  Trash2, Plus, Target, Zap, Shield, Database,
} from "lucide-react";
import { useGetPreMarket, getGetPreMarketQueryKey } from "@workspace/api-client-react";
import type { PreMarketReport } from "@workspace/api-client-react";

// ─────────────────────────────────────────────────────── types ──────────────
type Dir = -1 | 0 | 1;
type FactorId = "f1" | "f2" | "f3" | "f4" | "f5" | "f6" | "f7" | "f8" | "f9";
type GateReason = "binary" | "pin" | "cas" | "shock";
type Mode = "PREPOST" | "INTRADAY";
type IndexSymbol = "NIFTY" | "BANKNIFTY" | "SENSEX";
type Verdict =
  | "STRONG_BULL" | "MILD_BULL" | "NO_EDGE"
  | "MILD_BEAR" | "STRONG_BEAR"
  | "NO_TRADE" | "INSUFFICIENT_DATA";
type ScoreStatus = "SCORED" | "INSUFFICIENT_DATA" | "GATED_NO_TRADE";

interface ScoreResult {
  balScore: number | null;
  wtdScore: number | null;
  balVerdict: Verdict;
  wtdVerdict: Verdict;
  missingFactors: FactorId[];
  gateArmed: boolean;
  gateReasons: GateReason[];
  status: ScoreStatus;
}

interface LogEntryBase {
  id: number;
  mode: Mode;
  date: string;
  index: IndexSymbol;
  balScore: number | null;
  wtdScore: number | null;
  balVerdict: string;
  wtdVerdict: string;
  gated: boolean;
}
interface LogEntryPrepost extends LogEntryBase { mode: "PREPOST"; synthRet: string; realized: string }
interface LogEntryIntraday extends LogEntryBase { mode: "INTRADAY"; ts: string; fwdRet: string; closeRet: string; fwdReal: string; closeReal: string }
type LogEntry = LogEntryPrepost | LogEntryIntraday;

type FactorState = Record<FactorId, Dir | null>;
type GateState  = Record<GateReason, boolean>;
type PageState  = Record<Mode, Record<IndexSymbol, { factors: FactorState; gates: GateState }>>;

// ────────────────────────────────────────────────────── constants ────────────
const WEIGHTS = {
  PREPOST: {
    f1:{bal:13,wtd:22},f2:{bal:12,wtd:18},f3:{bal:13,wtd:14},
    f4:{bal:12,wtd:12},f5:{bal:13,wtd:8 },f6:{bal:12,wtd:8 },
    f7:{bal:9, wtd:7 },f8:{bal:8, wtd:5 },f9:{bal:8, wtd:4 },
  },
  INTRADAY: {
    f1:{bal:8, wtd:12},f2:{bal:10,wtd:14},f3:{bal:20,wtd:22},
    f4:{bal:14,wtd:12},f5:{bal:13,wtd:9 },f6:{bal:11,wtd:8 },
    f7:{bal:8, wtd:6 },f8:{bal:3, wtd:2 },f9:{bal:13,wtd:15},
  },
} as const;

const BANDS = { strong: 50, mild: 20 } as const;
const CONVICTION_FLOOR = 60;
const NEUTRAL_BAND: Record<Mode, Record<IndexSymbol, number>> = {
  PREPOST:  { NIFTY: 0.30, BANKNIFTY: 0.45, SENSEX: 0.30 },
  INTRADAY: { NIFTY: 0.15, BANKNIFTY: 0.22, SENSEX: 0.15 },
};
const ALL_FACTORS: FactorId[] = ["f1","f2","f3","f4","f5","f6","f7","f8","f9"];
const PROXY_FACTORS: FactorId[] = ["f1","f2"];   // intraday aggregate proxies
const STALE_FACTORS: FactorId[] = ["f8"];         // intraday EOD-frozen

// ─────────────────────────────── data-driven factor derivation ───────────────
// Maps live premarket API response fields to BULL/NEUTRAL/BEAR for each factor.
// F1/F2/F5/F7/F8/F9 are market-wide; F3/F4/F6 are per-index.
function deriveFactors(data: PreMarketReport, index: IndexSymbol): Partial<FactorState> {
  const out: Partial<FactorState> = {};

  // F1 — Participant OI (FII + Pro options split — EOD)
  if (data.participantOi) {
    const sig = data.participantOi.signal;
    out.f1 = sig === "BULLISH" ? 1 : sig === "BEARISH" ? -1 : 0;
  }

  // F2 — Index-futures OI buildup (aggregate price × OI)
  if (data.indexOiBuildup) {
    const b = data.indexOiBuildup.bias;
    out.f2 = b === "BULLISH" ? 1 : b === "BEARISH" ? -1 : b === "UNKNOWN" ? null : 0;
  }

  // F3 — Price action: use indicative change % from the matching index preview
  if (data.indexPreviews?.length) {
    const preview = data.indexPreviews.find(p => {
      const s = p.symbol.toUpperCase();
      if (index === "NIFTY")     return s.includes("NIFTY") && !s.includes("BANK") && !s.includes("FINN");
      if (index === "BANKNIFTY") return s.includes("BANKNIFTY") || (s.includes("BANK") && s.includes("NIFTY"));
      return s.includes("SENSEX");
    });
    const chg = preview?.indicativeChangePercent;
    if (chg != null) out.f3 = chg > 0.3 ? 1 : chg < -0.3 ? -1 : 0;
  }

  // F4 — Option-chain OI walls (NIFTY + BANKNIFTY only; SENSEX has no F&O)
  if (data.optionSnapshots?.length) {
    const ul = index === "NIFTY" ? "NIFTY" : index === "BANKNIFTY" ? "BANKNIFTY" : null;
    if (ul) {
      const snap = data.optionSnapshots.find(s => s.underlying === ul);
      if (snap) out.f4 = snap.bias === "BULLISH" ? 1 : snap.bias === "BEARISH" ? -1 : 0;
    }
  }

  // F5 — India VIX (overnight cue, category="vix", already inverted at source:
  //       sentiment=bullish means VIX fell = equity bullish)
  if (data.overnightCues?.length) {
    const vix = data.overnightCues.find(c => c.category === "vix");
    if (vix) out.f5 = vix.sentiment === "bullish" ? 1 : vix.sentiment === "bearish" ? -1 : 0;
  }

  // F6 — PCR (banded): 0.9–1.2 = bull, <0.7 or >1.6 = bear
  if (data.optionSnapshots?.length) {
    const ul = index === "NIFTY" ? "NIFTY" : index === "BANKNIFTY" ? "BANKNIFTY" : null;
    if (ul) {
      const snap = data.optionSnapshots.find(s => s.underlying === ul);
      if (snap) {
        const pcr = snap.pcrOi;
        out.f6 = (pcr >= 0.9 && pcr <= 1.2) ? 1 : (pcr < 0.7 || pcr > 1.6) ? -1 : 0;
      }
    }
  }

  // F7 — Commodity / macro (crude row from macroOverlay)
  if (data.macroOverlay?.rows?.length) {
    const crude = data.macroOverlay.rows.find(r =>
      r.label.toLowerCase().includes("crude") || (r.symbol ?? "").toLowerCase().includes("crude")
    );
    if (crude) out.f7 = crude.impact === "BULLISH" ? 1 : crude.impact === "BEARISH" ? -1 : 0;
  }

  // F8 — FII/DII cash flows (both buying = bull, both selling = bear, mixed = neutral)
  if (data.fiiDii) {
    const { fiiCashCr, diiCashCr } = data.fiiDii;
    out.f8 = fiiCashCr > 0 && diiCashCr > 0 ? 1 : fiiCashCr < 0 && diiCashCr < 0 ? -1 : 0;
  }

  // F9 — Global cues: majority vote across US overnight cues
  if (data.overnightCues?.length) {
    const usCues = data.overnightCues.filter(c => c.category === "us");
    if (usCues.length > 0) {
      const bull = usCues.filter(c => c.sentiment === "bullish").length;
      const bear = usCues.filter(c => c.sentiment === "bearish").length;
      out.f9 = bull > bear ? 1 : bear > bull ? -1 : 0;
    }
  }

  return out;
}

// Tracks which factors were auto-filled from API data vs manually set by user
type OriginMap = Record<Mode, Record<IndexSymbol, Partial<Record<FactorId, true>>>>;
function makeOriginMap(): OriginMap {
  const modes: Mode[] = ["PREPOST","INTRADAY"];
  const indices: IndexSymbol[] = ["NIFTY","BANKNIFTY","SENSEX"];
  const s: any = {};
  for (const m of modes) { s[m] = {}; for (const ix of indices) s[m][ix] = {}; }
  return s as OriginMap;
}

const FACTOR_META = [
  {id:"f1" as FactorId, num:"01", pillar:"A", name:"Participant OI — FII + Pro options"},
  {id:"f2" as FactorId, num:"02", pillar:"A", name:"FII index-futures OI"},
  {id:"f3" as FactorId, num:"03", pillar:"B", name:"Price action (synthetic-futures spot)"},
  {id:"f4" as FactorId, num:"04", pillar:"B", name:"Option-chain OI walls"},
  {id:"f5" as FactorId, num:"05", pillar:"C", name:"India VIX / IV regime"},
  {id:"f6" as FactorId, num:"06", pillar:"C", name:"PCR (banded)"},
  {id:"f7" as FactorId, num:"07", pillar:"D", name:"Commodity / macro (crude-led)"},
  {id:"f8" as FactorId, num:"08", pillar:"D", name:"FII / DII cash flows"},
  {id:"f9" as FactorId, num:"09", pillar:"D", name:"Global cues (US indices)"},
];

const PILLAR_META: Record<string, { name: string; colorClass: string }> = {
  A: { name: "Positioning",          colorClass: "text-sky-400" },
  B: { name: "Price & Structure",    colorClass: "text-amber-300" },
  C: { name: "Volatility & Sentiment", colorClass: "text-violet-400" },
  D: { name: "External & Macro",     colorClass: "text-emerald-400" },
};

const HINTS: Record<Mode, Record<FactorId, { h: string; b: string }>> = {
  PREPOST: {
    f1:{h:"FII long + Pro long (buy CE/sell PE) = bull. Full magnitude on agreement only.",b:"FII+Pro long → BULL · both short → BEAR · mixed → NEUTRAL"},
    f2:{h:"OI falling while price rises = short covering (bull). Fresh shorts = bear.",b:"covering/long buildup → BULL · fresh shorts → BEAR"},
    f3:{h:"Off synthetic spot, NOT cash close. Gap fill + trendline hold + bullish weekly.",b:"support hold → BULL · break → BEAR · indecision → NEUTRAL"},
    f4:{h:"Above CE wall / short-cover trigger = bull. Rejected at wall / below fresh PE = bear.",b:"clears CE wall → BULL · rejected → BEAR"},
    f5:{h:"Falling VIX = trend continuation. Spiking = whipsaw risk. Stable = neutral.",b:"falling → BULL · spiking → BEAR · stable → NEUTRAL"},
    f6:{h:"0.9–1.2 rising = bull. <0.7 weak / >1.6 overheated = bear.",b:"0.9–1.2↑ → BULL · <0.7 or >1.6 → BEAR"},
    f7:{h:"Crude falling (esp. <70) = bull for India. Crude spiking = bear.",b:"crude down → BULL · spike → BEAR"},
    f8:{h:"Both net buyers = bull. Both net sellers = bear. Confirmation layer only.",b:"both buying → BULL · both selling → BEAR"},
    f9:{h:"US green = bull, red = bear.",b:"US green → BULL · red → BEAR"},
  },
  INTRADAY: {
    f1:{h:"LIVE aggregate OI-change proxy — NOT the FII/Pro split (published EOD only).",b:"net CE unwind + PE buildup → BULL · opposite → BEAR"},
    f2:{h:"Live futures OI change (aggregate). OI↓ & price↑ = short covering.",b:"covering → BULL · fresh shorts → BEAR"},
    f3:{h:"LIVE tape vs opening range / VWAP / prior-day levels. Dominant intraday factor.",b:"above VWAP & ORB-high → BULL · below & losing → BEAR · inside → NEUTRAL"},
    f4:{h:"Live OI walls built today vs at-open. Clears today's CE wall = bull.",b:"clears CE wall → BULL · PE wall lost → BEAR"},
    f5:{h:"VIX change from prev close + intraday spike detect.",b:"falling vs prev close → BULL · spiking → BEAR"},
    f6:{h:"Intraday PCR — WIDER bands (noisier). 0.85–1.25↑ = bull.",b:"0.85–1.25↑ → BULL · <0.65 or >1.7 → BEAR"},
    f7:{h:"Crude / global live. Crude falling = bull for India.",b:"crude down → BULL · spike → BEAR"},
    f8:{h:"FII/DII cash is EOD only — STALE intraday. Frozen prev-day value, near-zero weight.",b:"prev-day both buyers → BULL · both sellers → BEAR"},
    f9:{h:"US index futures live during IST session.",b:"US futures green → BULL · red → BEAR"},
  },
};

const GATE_LABELS: Record<GateReason, string> = {
  binary: "Binary event (RBI/Fed/CPI)",
  pin:    "Expiry pin risk",
  cas:    "CAS / synthetic divergence",
  shock:  "Geopolitical shock",
};

const IDX_LABEL: Record<IndexSymbol, string> = {
  NIFTY: "NIFTY 50",
  BANKNIFTY: "BANKNIFTY",
  SENSEX: "SENSEX",
};

const LS_KEY = "directional_scorer_log_v1";

// ─────────────────────────────────────────────── scoring engine ──────────────
function verdictFor(score: number): Verdict {
  if (score >= BANDS.strong)  return "STRONG_BULL";
  if (score >= BANDS.mild)    return "MILD_BULL";
  if (score <= -BANDS.strong) return "STRONG_BEAR";
  if (score <= -BANDS.mild)   return "MILD_BEAR";
  return "NO_EDGE";
}

function computeScore(factors: FactorState, gates: GateState, mode: Mode): ScoreResult {
  const w = WEIGHTS[mode];
  const missing = ALL_FACTORS.filter(f => factors[f] === null);
  const gateReasons = (Object.keys(gates) as GateReason[]).filter(k => gates[k]);
  const gateArmed = gateReasons.length > 0;

  if (missing.length > 0) {
    return {
      balScore: null, wtdScore: null,
      balVerdict: "INSUFFICIENT_DATA", wtdVerdict: "INSUFFICIENT_DATA",
      missingFactors: missing, gateArmed, gateReasons, status: "INSUFFICIENT_DATA",
    };
  }

  let bal = 0, wtd = 0;
  for (const f of ALL_FACTORS) {
    const d = factors[f] as Dir;
    bal += d * w[f].bal;
    wtd += d * w[f].wtd;
  }

  // Model B conviction floor: f1+f2 agreement
  const f1 = factors.f1 as Dir, f2 = factors.f2 as Dir;
  if (f1 !== 0 && f1 === f2) {
    if (f1 > 0 && wtd < CONVICTION_FLOOR)  wtd = CONVICTION_FLOOR;
    if (f1 < 0 && wtd > -CONVICTION_FLOOR) wtd = -CONVICTION_FLOOR;
  }

  if (gateArmed) {
    return {
      balScore: bal, wtdScore: wtd,
      balVerdict: "NO_TRADE", wtdVerdict: "NO_TRADE",
      missingFactors: [], gateArmed, gateReasons, status: "GATED_NO_TRADE",
    };
  }
  return {
    balScore: bal, wtdScore: wtd,
    balVerdict: verdictFor(bal), wtdVerdict: verdictFor(wtd),
    missingFactors: [], gateArmed: false, gateReasons: [], status: "SCORED",
  };
}

function realizedFromRet(retStr: string, index: IndexSymbol, mode: Mode): string {
  const v = parseFloat(retStr);
  if (!retStr || isNaN(v)) return "";
  const band = NEUTRAL_BAND[mode][index];
  return v > band ? "up" : v < -band ? "down" : "flat";
}

// ──────────────────────────────────────────────── helpers ────────────────────
function emptyFactors(): FactorState {
  return {f1:null,f2:null,f3:null,f4:null,f5:null,f6:null,f7:null,f8:null,f9:null};
}
function emptyGates(): GateState {
  return {binary:false,pin:false,cas:false,shock:false};
}
function makePageState(): PageState {
  const modes: Mode[] = ["PREPOST","INTRADAY"];
  const indices: IndexSymbol[] = ["NIFTY","BANKNIFTY","SENSEX"];
  const s: any = {};
  for (const m of modes) {
    s[m] = {};
    for (const ix of indices) s[m][ix] = { factors: emptyFactors(), gates: emptyGates() };
  }
  return s as PageState;
}

function loadLog(): LogEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as LogEntry[]) : [];
  } catch { return []; }
}
function saveLog(log: LogEntry[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(log)); } catch {}
}

function verdictDisplayName(v: string): string {
  const map: Record<string, string> = {
    STRONG_BULL: "Strong bullish", MILD_BULL: "Mild bullish",
    NO_EDGE: "No edge", MILD_BEAR: "Mild bearish",
    STRONG_BEAR: "Strong bearish", NO_TRADE: "No trade",
    INSUFFICIENT_DATA: "Insufficient data",
  };
  return map[v] ?? v;
}

function verdictDir(v: string): "up" | "down" | "flat" {
  if (v.includes("BULL") || v === "Strong bullish" || v === "Mild bullish") return "up";
  if (v.includes("BEAR") || v === "Strong bearish" || v === "Mild bearish") return "down";
  return "flat";
}

function gradeCell(verdict: string, realized: string): { text: string; cls: string } {
  if (!realized) return { text: "—", cls: "text-muted-foreground" };
  if (verdict === "Insufficient data" || verdict === "No trade")
    return { text: "n/a", cls: "text-muted-foreground" };
  const dir = verdictDir(verdict);
  if (dir === "flat") return realized === "flat"
    ? { text: "✓ avoid", cls: "text-signal-strong-buy" }
    : { text: "skip",    cls: "text-muted-foreground" };
  return dir === realized
    ? { text: "✓ hit",  cls: "text-signal-strong-buy" }
    : { text: "✗ miss", cls: "text-signal-strong-sell" };
}

function scoreTone(s: number | null): string {
  if (s === null) return "text-muted-foreground";
  if (s >= BANDS.mild) return "text-signal-strong-buy";
  if (s <= -BANDS.mild) return "text-signal-strong-sell";
  return "text-muted-foreground";
}
function verdictTone(v: string): string {
  if (v.includes("BULL") || v === "Strong bullish" || v === "Mild bullish") return "text-signal-strong-buy";
  if (v.includes("BEAR") || v === "Strong bearish" || v === "Mild bearish") return "text-signal-strong-sell";
  if (v === "No trade" || v === "NO_TRADE") return "text-amber-400";
  return "text-muted-foreground";
}

// ─────────────────────────────── sub-components ──────────────────────────────

interface PillarProps {
  pillarKey: string;
  mode: Mode;
  factors: FactorState;
  dataOrigin: Partial<Record<FactorId, true>>;
  onSet: (fid: FactorId, v: Dir | null) => void;
}
function PillarBlock({ pillarKey, mode, factors, dataOrigin, onSet }: PillarProps) {
  const pm = PILLAR_META[pillarKey]!;
  const fms = FACTOR_META.filter(f => f.pillar === pillarKey);
  const balTotal = fms.reduce((a, f) => a + WEIGHTS[mode][f.id].bal, 0);
  const wtdTotal = fms.reduce((a, f) => a + WEIGHTS[mode][f.id].wtd, 0);

  return (
    <div className="space-y-2 mb-4">
      <div className={`flex items-center gap-2 text-[11px] font-mono uppercase tracking-widest ${pm.colorClass}`}>
        <span>Pillar {pillarKey} · {pm.name}</span>
        <span className="text-muted-foreground normal-case tracking-normal">
          — bal {balTotal} · wtd {wtdTotal}
        </span>
        <div className="flex-1 h-px bg-border/40" />
      </div>

      {fms.map(fm => {
        const w = WEIGHTS[mode][fm.id];
        const hint = HINTS[mode][fm.id];
        const val = factors[fm.id];
        const isProxy = mode === "INTRADAY" && PROXY_FACTORS.includes(fm.id);
        const isStale = mode === "INTRADAY" && STALE_FACTORS.includes(fm.id);

        return (
          <div key={fm.id} className="bg-card border border-border/50 rounded-lg p-3">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[11px] text-muted-foreground">{fm.num}</span>
                <span className="text-sm font-semibold">{fm.name}</span>
                {isProxy && (
                  <span className="text-[9px] font-bold font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border bg-amber-400/10 text-amber-400 border-amber-400/40">
                    Aggregate proxy
                  </span>
                )}
                {isStale && (
                  <span className="text-[9px] font-bold font-mono uppercase tracking-wider px-1.5 py-0.5 rounded border bg-muted/60 text-muted-foreground border-border/50">
                    Prev day
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <div className="text-[10px] text-sky-400 font-mono">BAL</div>
                  <div className="text-sm font-bold font-mono text-foreground">{w.bal}</div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-amber-300 font-mono">WTD</div>
                  <div className="text-sm font-bold font-mono text-foreground">{w.wtd}</div>
                </div>
              </div>
            </div>

            <div className="text-[11.5px] text-muted-foreground mb-2.5 leading-snug">
              {hint.h}
              <br />
              <span className="font-mono text-[10.5px] text-foreground/70">{hint.b}</span>
            </div>

            {/* BULL / NEUTRAL / BEAR segmented control */}
            <div className="grid grid-cols-3 gap-1.5">
              {([1, 0, -1] as Dir[]).map(dv => {
                const isOn = val === dv;
                const isDataSourced = isOn && dataOrigin[fm.id];
                const label = dv === 1 ? "▲ BULL" : dv === 0 ? "● NEUTRAL" : "▼ BEAR";
                const onCls = dv === 1
                  ? "bg-signal-strong-buy/15 border-signal-strong-buy text-signal-strong-buy"
                  : dv === -1
                    ? "bg-signal-strong-sell/15 border-signal-strong-sell text-signal-strong-sell"
                    : "bg-secondary/80 border-border text-foreground";
                const offCls = "bg-secondary/30 border-border/50 text-muted-foreground hover:border-border hover:text-foreground";
                return (
                  <button
                    key={dv}
                    type="button"
                    onClick={() => onSet(fm.id, isOn ? null : dv)}
                    className={`relative rounded px-2 py-1.5 text-[11px] font-mono font-semibold border transition-all ${isOn ? onCls : offCls}`}
                  >
                    {label}
                    {isDataSourced && (
                      <span className="absolute top-0.5 right-0.5 text-[8px] font-mono opacity-70">◎</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface VerdictCardProps {
  model: "A" | "B";
  label: string;
  score: number | null;
  verdict: Verdict;
  status: ScoreStatus;
  gateArmed: boolean;
}
function VerdictCard({ model, label, score, verdict, status, gateArmed }: VerdictCardProps) {
  const displayVerdict = verdictDisplayName(verdict);
  const color = status === "INSUFFICIENT_DATA" ? "text-amber-400"
    : gateArmed ? "text-amber-400"
    : verdictTone(displayVerdict);

  const fillPct = score !== null ? Math.min(Math.abs(score), 100) / 2 : 0;
  const fillColor = score !== null
    ? (score >= BANDS.mild ? "bg-signal-strong-buy" : score <= -BANDS.mild ? "bg-signal-strong-sell" : "bg-muted-foreground/60")
    : "bg-muted-foreground/30";
  const fillRight = score !== null && score < 0;

  const actionText = status === "INSUFFICIENT_DATA"
    ? "Set all 9 factors to unlock score (fail-closed)"
    : gateArmed
      ? "Event gate armed — verdict suppressed"
      : verdict === "STRONG_BULL" ? "Directional long — defined-risk call spreads"
      : verdict === "MILD_BULL"   ? "Lean long, smaller size"
      : verdict === "STRONG_BEAR" ? "Directional short — defined-risk put spreads"
      : verdict === "MILD_BEAR"   ? "Lean short, smaller size"
      : "Range / non-directional / wait";

  return (
    <Card className="border border-border/50">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Model {model}</span>
          <span className="font-mono text-[10px] uppercase tracking-wider text-foreground/70">{label}</span>
        </div>

        <div className={`font-mono text-[42px] font-bold leading-none tracking-tight tabular-nums mb-1 ${
          status === "INSUFFICIENT_DATA" || gateArmed ? "text-muted-foreground/40" : scoreTone(score)
        }`}>
          {score === null ? "—" : (score > 0 ? "+" : "") + score}
        </div>

        <div className="font-mono text-[10px] text-muted-foreground/60 mb-2">
          range −100 … +100 · bands ±{BANDS.strong} / ±{BANDS.mild}
          {model === "B" && " · conviction override on F1+F2"}
        </div>

        {/* Score meter */}
        <div className="relative h-1.5 rounded-full bg-secondary/50 mb-3 overflow-hidden">
          <div className="absolute inset-y-0 left-1/2 w-px bg-border/60" />
          {score !== null && (
            <div
              className={`absolute inset-y-0 rounded-full transition-all duration-200 ${fillColor}`}
              style={{
                width: `${fillPct}%`,
                left: fillRight ? `${50 - fillPct}%` : "50%",
              }}
            />
          )}
        </div>

        <div className={`text-base font-bold mb-0.5 ${color}`}>{displayVerdict}</div>
        <div className="text-xs text-muted-foreground">{actionText}</div>
      </CardContent>
    </Card>
  );
}

// Hit-rate scoreboard
function pillarHitRate(rows: LogEntry[], model: "bal" | "wtd", realField: "realized" | "fwdReal" | "closeReal") {
  const directional = rows.filter(e => {
    const v = model === "bal" ? verdictDir(e.balVerdict) : verdictDir(e.wtdVerdict);
    const realized = (e as any)[realField] as string;
    return v !== "flat" && e.balVerdict !== "Insufficient data" && realized;
  });
  const hits = directional.filter(e => {
    const v = model === "bal" ? verdictDir(e.balVerdict) : verdictDir(e.wtdVerdict);
    return v === ((e as any)[realField] as string);
  });
  const n = directional.length;
  return { rate: n ? Math.round((hits.length / n) * 100) : null, hits: hits.length, n };
}

interface ScoreboardProps {
  rows: LogEntry[];
  mode: Mode;
  idxLabel: string;
}
function ScoreboardPanel({ rows, mode, idxLabel }: ScoreboardProps) {
  if (mode === "PREPOST") {
    const preRows = rows.filter(e => e.mode === "PREPOST") as LogEntryPrepost[];
    const bA = pillarHitRate(preRows, "bal", "realized");
    const bB = pillarHitRate(preRows, "wtd", "realized");
    const graded = preRows.filter(e => e.realized).length;
    const leadA = bA.rate !== null && bB.rate !== null && bA.rate > bB.rate;
    const leadB = bA.rate !== null && bB.rate !== null && bB.rate > bA.rate;

    function rateCls(r: number | null) {
      if (r === null) return "text-muted-foreground";
      if (r >= 55) return "text-signal-strong-buy";
      if (r <= 45) return "text-signal-strong-sell";
      return "text-foreground";
    }
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: `Model A · Balanced${leadA ? " · leading" : ""}`, rate: bA, lead: leadA },
          { label: `Model B · Weighted${leadB ? " · leading" : ""}`, rate: bB, lead: leadB },
        ].map(({ label, rate, lead }) => (
          <Card key={label} className={`border ${lead ? "border-border" : "border-border/40"}`}>
            <CardContent className="p-4">
              <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
              <div className={`font-mono text-2xl font-bold tabular-nums ${rateCls(rate.rate)}`}>
                {rate.rate === null ? "—" : `${rate.rate}%`}
              </div>
              <div className="font-mono text-[11px] text-muted-foreground mt-1">
                {rate.n ? `${rate.hits}/${rate.n} directional` : "no graded calls"} · neutral baseline
              </div>
            </CardContent>
          </Card>
        ))}
        <Card className="border border-border/40">
          <CardContent className="p-4">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              Graded · {idxLabel}
            </div>
            <div className="font-mono text-2xl font-bold tabular-nums text-foreground">{graded}</div>
            <div className="font-mono text-[11px] text-muted-foreground mt-1">
              {graded < 30 ? `need ~${Math.max(0, 30 - graded)}+ more for significance` : "sample sufficient"}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // INTRADAY — dual grade (+60min and close)
  const intRows = rows.filter(e => e.mode === "INTRADAY") as LogEntryIntraday[];
  function cls(r: number | null) {
    if (r === null) return "text-muted-foreground";
    return r >= 55 ? "text-signal-strong-buy" : r <= 45 ? "text-signal-strong-sell" : "text-foreground";
  }
  const bAH = pillarHitRate(intRows, "bal", "fwdReal");
  const bBH = pillarHitRate(intRows, "wtd", "fwdReal");
  const bAC = pillarHitRate(intRows, "bal", "closeReal");
  const bBC = pillarHitRate(intRows, "wtd", "closeReal");
  const gradedH = intRows.filter(e => e.fwdReal).length;
  const gradedC = intRows.filter(e => e.closeReal).length;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {[
        { label: "Model A · Balanced", h: bAH, c: bAC },
        { label: "Model B · Weighted", h: bBH, c: bBC },
      ].map(({ label, h, c }) => (
        <Card key={label} className="border border-border/40">
          <CardContent className="p-4">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
            <div className={`font-mono text-2xl font-bold tabular-nums ${cls(h.rate)}`}>
              {h.rate === null ? "—" : `${h.rate}%`}
            </div>
            <div className="font-mono text-[11px] text-muted-foreground mt-0.5">
              +60m · {h.n ? `${h.hits}/${h.n}` : "0"} calls
            </div>
            <div className="mt-2 pt-2 border-t border-border/30 font-mono text-[11px] text-muted-foreground">
              to-close <span className={cls(c.rate)}>{c.rate === null ? "—" : `${c.rate}%`}</span>
              {" "}· {c.n ? `${c.hits}/${c.n}` : "0"}
            </div>
          </CardContent>
        </Card>
      ))}
      <Card className="border border-border/40">
        <CardContent className="p-4">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            Snapshots graded · {idxLabel}
          </div>
          <div className="font-mono text-2xl font-bold tabular-nums text-foreground">
            {gradedH} / {gradedC}
          </div>
          <div className="font-mono text-[11px] text-muted-foreground mt-1">
            +60m / close · {gradedH < 30 ? `need ~${Math.max(0, 30 - gradedH)}+ more` : "sample ok"}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// Session log table
interface SessionLogProps {
  rows: LogEntry[];
  mode: Mode;
  index: IndexSymbol;
  onUpdateRet: (id: number, field: string, value: string) => void;
  onDelete: (id: number) => void;
}
function SessionLog({ rows, mode, index, onUpdateRet, onDelete }: SessionLogProps) {
  const filtered = rows.filter(e => e.index === index && e.mode === mode);

  function scT(s: number | null) {
    if (s === null) return "text-muted-foreground";
    return s >= BANDS.mild ? "text-signal-strong-buy" : s <= -BANDS.mild ? "text-signal-strong-sell" : "text-muted-foreground";
  }

  if (filtered.length === 0) {
    return (
      <div className="border border-border/40 rounded-lg py-8 text-center font-mono text-xs text-muted-foreground">
        No {IDX_LABEL[index]} {mode === "INTRADAY" ? "intraday" : "pre/post"} sessions logged yet.
      </div>
    );
  }

  if (mode === "PREPOST") {
    const pRows = filtered as LogEntryPrepost[];
    const band = NEUTRAL_BAND.PREPOST[index];
    return (
      <div className="overflow-x-auto border border-border/40 rounded-lg">
        <table className="w-full text-xs font-mono whitespace-nowrap">
          <thead>
            <tr className="border-b border-border/40 bg-card">
              {["Date","A·Bal","A Verdict","B·Wtd","B Verdict","Gate","Synth ret%","Realized","A","B",""].map(h => (
                <th key={h} className="text-left text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-2">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pRows.map(e => {
              const realized = e.realized;
              const gA = gradeCell(e.balVerdict, realized);
              const gB = gradeCell(e.wtdVerdict, realized);
              return (
                <tr key={e.id} className="border-b border-border/30 hover:bg-secondary/30 transition-colors">
                  <td className="px-3 py-2">{e.date}</td>
                  <td className={`px-3 py-2 ${scT(e.balScore)}`}>{e.balScore === null ? "—" : (e.balScore > 0 ? "+" : "") + e.balScore}</td>
                  <td className={`px-3 py-2 ${verdictTone(e.balVerdict)}`}>{e.balVerdict}</td>
                  <td className={`px-3 py-2 ${scT(e.wtdScore)}`}>{e.wtdScore === null ? "—" : (e.wtdScore > 0 ? "+" : "") + e.wtdScore}</td>
                  <td className={`px-3 py-2 ${verdictTone(e.wtdVerdict)}`}>{e.wtdVerdict}</td>
                  <td className={`px-3 py-2 ${e.gated ? "text-amber-400" : "text-muted-foreground"}`}>{e.gated ? "ARMED" : "—"}</td>
                  <td className="px-3 py-1.5">
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder={`±% (${band})`}
                      defaultValue={e.synthRet}
                      onBlur={ev => onUpdateRet(e.id, "synthRet", ev.currentTarget.value.trim())}
                      className="w-24 bg-secondary/40 border border-border/50 rounded px-1.5 py-0.5 text-xs font-mono text-foreground focus:outline-none focus:border-border"
                    />
                  </td>
                  <td className={`px-3 py-2 ${realized === "up" ? "text-signal-strong-buy" : realized === "down" ? "text-signal-strong-sell" : "text-muted-foreground"}`}>
                    {realized ? realized.toUpperCase() : "—"}
                  </td>
                  <td className={`px-3 py-2 ${gA.cls}`}>{gA.text}</td>
                  <td className={`px-3 py-2 ${gB.cls}`}>{gB.text}</td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => onDelete(e.id)} className="text-muted-foreground hover:text-signal-strong-sell transition-colors">✕</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  }

  // INTRADAY
  const iRows = filtered as LogEntryIntraday[];
  return (
    <div className="overflow-x-auto border border-border/40 rounded-lg">
      <table className="w-full text-xs font-mono whitespace-nowrap">
        <thead>
          <tr className="border-b border-border/40 bg-card">
            {["Time","A·Bal","A Verdict","B·Wtd","B Verdict","Gate","+60m ret%","Close ret%","A·60m","B·60m","A·cl","B·cl",""].map(h => (
              <th key={h} className="text-left text-[10px] uppercase tracking-wider text-muted-foreground px-3 py-2">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {iRows.map(e => {
            const gAH = gradeCell(e.balVerdict, e.fwdReal);
            const gBH = gradeCell(e.wtdVerdict, e.fwdReal);
            const gAC = gradeCell(e.balVerdict, e.closeReal);
            const gBC = gradeCell(e.wtdVerdict, e.closeReal);
            return (
              <tr key={e.id} className="border-b border-border/30 hover:bg-secondary/30 transition-colors">
                <td className="px-3 py-2">{e.ts}</td>
                <td className={`px-3 py-2 ${scT(e.balScore)}`}>{e.balScore === null ? "—" : (e.balScore > 0 ? "+" : "") + e.balScore}</td>
                <td className={`px-3 py-2 ${verdictTone(e.balVerdict)}`}>{e.balVerdict}</td>
                <td className={`px-3 py-2 ${scT(e.wtdScore)}`}>{e.wtdScore === null ? "—" : (e.wtdScore > 0 ? "+" : "") + e.wtdScore}</td>
                <td className={`px-3 py-2 ${verdictTone(e.wtdVerdict)}`}>{e.wtdVerdict}</td>
                <td className={`px-3 py-2 ${e.gated ? "text-amber-400" : "text-muted-foreground"}`}>{e.gated ? "ARMED" : "—"}</td>
                <td className="px-3 py-1.5">
                  <input
                    type="text" inputMode="decimal" placeholder="+60m%"
                    defaultValue={e.fwdRet}
                    onBlur={ev => onUpdateRet(e.id, "fwdRet", ev.currentTarget.value.trim())}
                    className="w-20 bg-secondary/40 border border-border/50 rounded px-1.5 py-0.5 text-xs font-mono text-foreground focus:outline-none focus:border-border"
                  />
                </td>
                <td className="px-3 py-1.5">
                  <input
                    type="text" inputMode="decimal" placeholder="close%"
                    defaultValue={e.closeRet}
                    onBlur={ev => onUpdateRet(e.id, "closeRet", ev.currentTarget.value.trim())}
                    className="w-20 bg-secondary/40 border border-border/50 rounded px-1.5 py-0.5 text-xs font-mono text-foreground focus:outline-none focus:border-border"
                  />
                </td>
                <td className={`px-3 py-2 ${gAH.cls}`}>{gAH.text}</td>
                <td className={`px-3 py-2 ${gBH.cls}`}>{gBH.text}</td>
                <td className={`px-3 py-2 ${gAC.cls}`}>{gAC.text}</td>
                <td className={`px-3 py-2 ${gBC.cls}`}>{gBC.text}</td>
                <td className="px-3 py-2">
                  <button type="button" onClick={() => onDelete(e.id)} className="text-muted-foreground hover:text-signal-strong-sell transition-colors">✕</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ──────────────────────────────────────── main page ──────────────────────────
export default function DirectionalScorer() {
  const [mode, setMode] = useState<Mode>("PREPOST");
  const [activeIdx, setActiveIdx] = useState<IndexSymbol>("NIFTY");
  const [pageState, setPageState] = useState<PageState>(makePageState);
  const [factorOrigin, setFactorOrigin] = useState<OriginMap>(makeOriginMap);
  const [log, setLog] = useState<LogEntry[]>(loadLog);
  const [sessionDate, setSessionDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Premarket data — same query as the Pre/Post page
  const { data: preData, dataUpdatedAt, isFetching: dataFetching } = useGetPreMarket({
    query: { staleTime: 30_000, refetchInterval: 60_000, queryKey: getGetPreMarketQueryKey() },
  });

  // Derive suggested factor values for each index whenever premarket data changes
  const suggestedByIndex = useMemo(() => {
    if (!preData) return null;
    return {
      NIFTY:     deriveFactors(preData, "NIFTY"),
      BANKNIFTY: deriveFactors(preData, "BANKNIFTY"),
      SENSEX:    deriveFactors(preData, "SENSEX"),
    };
  }, [preData]);

  // Auto-apply suggestions once per data refresh — only fills factors still null
  const prevUpdatedAt = useRef(0);
  useEffect(() => {
    if (!suggestedByIndex || dataUpdatedAt === prevUpdatedAt.current) return;
    prevUpdatedAt.current = dataUpdatedAt;

    setPageState(prev => {
      const next = { ...prev };
      for (const m of ["PREPOST","INTRADAY"] as Mode[]) {
        next[m] = { ...next[m] };
        for (const ix of ["NIFTY","BANKNIFTY","SENSEX"] as IndexSymbol[]) {
          const suggested = suggestedByIndex[ix];
          const current = prev[m][ix].factors;
          const newFactors = { ...current };
          let changed = false;
          for (const fid of ALL_FACTORS) {
            if (current[fid] === null && suggested[fid] !== undefined && suggested[fid] !== null) {
              newFactors[fid] = suggested[fid] as Dir;
              changed = true;
            }
          }
          if (changed) next[m][ix] = { ...prev[m][ix], factors: newFactors };
        }
      }
      return next;
    });

    setFactorOrigin(prev => {
      const next = { ...prev };
      for (const m of ["PREPOST","INTRADAY"] as Mode[]) {
        next[m] = { ...next[m] };
        for (const ix of ["NIFTY","BANKNIFTY","SENSEX"] as IndexSymbol[]) {
          const suggested = suggestedByIndex[ix];
          const origin = { ...prev[m][ix] };
          for (const fid of ALL_FACTORS) {
            if (suggested[fid] !== undefined && suggested[fid] !== null && !origin[fid]) {
              origin[fid] = true;
            }
          }
          next[m][ix] = origin;
        }
      }
      return next;
    });
  }, [suggestedByIndex, dataUpdatedAt]);

  const st = pageState[mode][activeIdx];
  const result = useMemo(() => computeScore(st.factors, st.gates, mode), [st]);

  // Persist log on change
  const updateLog = useCallback((next: LogEntry[]) => {
    setLog(next);
    saveLog(next);
  }, []);

  function setFactor(fid: FactorId, val: Dir | null) {
    setPageState(prev => ({
      ...prev,
      [mode]: {
        ...prev[mode],
        [activeIdx]: {
          ...prev[mode][activeIdx],
          factors: { ...prev[mode][activeIdx].factors, [fid]: val },
        },
      },
    }));
    // Mark as manually overridden — clear data-origin badge
    setFactorOrigin(prev => {
      const origin = { ...prev[mode][activeIdx] };
      delete origin[fid];
      return { ...prev, [mode]: { ...prev[mode], [activeIdx]: origin } };
    });
  }

  function setGate(g: GateReason, val: boolean) {
    setPageState(prev => ({
      ...prev,
      [mode]: {
        ...prev[mode],
        [activeIdx]: {
          ...prev[mode][activeIdx],
          gates: { ...prev[mode][activeIdx].gates, [g]: val },
        },
      },
    }));
  }

  // Re-apply all available suggestions for the current mode+index (overwrites current values)
  function applyFromData() {
    if (!suggestedByIndex) return;
    const suggested = suggestedByIndex[activeIdx];
    setPageState(prev => ({
      ...prev,
      [mode]: {
        ...prev[mode],
        [activeIdx]: {
          ...prev[mode][activeIdx],
          factors: { ...prev[mode][activeIdx].factors, ...Object.fromEntries(
            Object.entries(suggested).filter(([, v]) => v !== null && v !== undefined)
          )},
        },
      },
    }));
    setFactorOrigin(prev => {
      const origin = { ...prev[mode][activeIdx] };
      for (const fid of Object.keys(suggested) as FactorId[]) {
        if (suggested[fid] !== null && suggested[fid] !== undefined) origin[fid] = true;
      }
      return { ...prev, [mode]: { ...prev[mode], [activeIdx]: origin } };
    });
  }

  function resetActive() {
    setPageState(prev => ({
      ...prev,
      [mode]: {
        ...prev[mode],
        [activeIdx]: { factors: emptyFactors(), gates: emptyGates() },
      },
    }));
    setFactorOrigin(prev => ({
      ...prev,
      [mode]: { ...prev[mode], [activeIdx]: {} },
    }));
  }

  function logSession() {
    const balV = verdictDisplayName(result.balVerdict);
    const wtdV = verdictDisplayName(result.wtdVerdict);
    const base = {
      id: Date.now(),
      mode,
      date: sessionDate,
      index: activeIdx,
      balScore: result.balScore,
      wtdScore: result.wtdScore,
      balVerdict: balV,
      wtdVerdict: wtdV,
      gated: result.gateArmed,
    };
    let entry: LogEntry;
    if (mode === "PREPOST") {
      entry = { ...base, mode: "PREPOST", synthRet: "", realized: "" };
    } else {
      const ts = new Date().toTimeString().slice(0, 5);
      entry = { ...base, mode: "INTRADAY", ts, fwdRet: "", closeRet: "", fwdReal: "", closeReal: "" };
    }
    updateLog([entry, ...log]);
  }

  function onUpdateRet(id: number, field: string, value: string) {
    const next = log.map(e => {
      if (e.id !== id) return e;
      const updated = { ...e, [field]: value } as any;
      if (field === "synthRet") updated.realized = realizedFromRet(value, e.index, "PREPOST");
      if (field === "fwdRet")   updated.fwdReal   = realizedFromRet(value, e.index, "INTRADAY");
      if (field === "closeRet") updated.closeReal  = realizedFromRet(value, e.index, "INTRADAY");
      return updated as LogEntry;
    });
    updateLog(next);
  }

  function onDelete(id: number) {
    updateLog(log.filter(e => e.id !== id));
  }

  function exportCsv() {
    const header = ["mode","date_or_time","index","bal_score","bal_verdict","wtd_score","wtd_verdict","gated","synth_or_fwd_ret","close_ret","realized_or_fwdReal","closeReal"];
    const rows = log.map(e => {
      if (e.mode === "PREPOST") {
        return [e.mode, e.date, e.index, e.balScore, e.balVerdict, e.wtdScore, e.wtdVerdict, e.gated, e.synthRet, "", e.realized, ""];
      } else {
        return [e.mode, `${e.ts} ${e.date}`, e.index, e.balScore, e.balVerdict, e.wtdScore, e.wtdVerdict, e.gated, e.fwdRet, e.closeRet, e.fwdReal, e.closeReal];
      }
    });
    const csv = [header, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `directional-scorer-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  const idxLogCount = (ix: IndexSymbol) => log.filter(e => e.index === ix && e.mode === mode).length;

  // Coverage / gate banner
  const bannerText = result.status === "INSUFFICIENT_DATA"
    ? `⚠ PARTIAL COVERAGE — missing ${result.missingFactors.length} factor(s): ${result.missingFactors.join(", ")} · fail-closed`
    : result.gateArmed
      ? `⛔ EVENT GATE ARMED — both models forced to NO DIRECTIONAL TRADE`
      : mode === "INTRADAY"
        ? "◐ INTRADAY — F1/F2 are AGGREGATE PROXY (not participant split); F8 is PREV-DAY cash. Verdict is a 1-min snapshot."
        : null;

  return (
    <div className="w-full px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-violet-500/15 border border-violet-500/30 flex items-center justify-center">
                <Target className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <h1 className="text-sm font-bold tracking-tight leading-none">
                  Directional Scorer
                  <span className="ml-2 font-mono text-[10px] font-semibold text-violet-400 border border-border/60 rounded px-1.5 py-0.5">
                    {mode === "INTRADAY" ? "INTRADAY · LIVE" : "PRE/POST"}
                  </span>
                </h1>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {mode === "INTRADAY"
                    ? "Live weights · price-structure dominant · F1/F2 aggregate proxy · dual grade (+60min & close)"
                    : "Dual-model · scored independently per index · graded on synthetic-futures close"}
                </div>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Mode toggle */}
            <div className="flex border border-border/60 rounded-md overflow-hidden text-[11px] font-mono font-semibold">
              {(["PREPOST","INTRADAY"] as Mode[]).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`px-3 py-1.5 transition-colors ${
                    mode === m
                      ? m === "INTRADAY"
                        ? "bg-rose-500 text-white"
                        : "bg-violet-500 text-white"
                      : "bg-secondary/40 text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {m === "PREPOST" ? "PRE/POST" : "INTRADAY"}
                </button>
              ))}
            </div>

            {mode === "INTRADAY" && (
              <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold text-rose-400">
                <span className="w-2 h-2 rounded-full bg-rose-400 animate-pulse" />
                LIVE · 1-min
              </div>
            )}

            {/* Session date */}
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-muted-foreground">SESSION</span>
              <input
                type="date"
                value={sessionDate}
                onChange={e => setSessionDate(e.target.value)}
                className="bg-secondary/40 border border-border/50 rounded px-2 py-1 font-mono text-xs text-foreground focus:outline-none focus:border-border"
              />
            </div>
          </div>
        </div>

        {/* Data source bar */}
        {preData && (
          <div className="flex items-center gap-2 text-[11px] font-mono text-muted-foreground bg-secondary/30 border border-border/40 rounded-md px-3 py-1.5">
            <Database className="w-3 h-3 text-sky-400 shrink-0" />
            <span className="text-sky-400 font-semibold">Pre/Post data wired</span>
            <span className="text-border/80">·</span>
            <span>
              {Object.values(suggestedByIndex?.[activeIdx] ?? {}).filter(v => v !== null && v !== undefined).length} of 9 factors suggested
            </span>
            <span className="text-border/80">·</span>
            <span className="text-foreground/50">
              updated {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—"}
            </span>
            {dataFetching && <span className="text-amber-400 animate-pulse">· refreshing</span>}
            <span className="text-border/80 mx-1">·</span>
            <span className="text-foreground/40">◎ = data-sourced · click any button to override</span>
          </div>
        )}

        {/* Index tabs */}
        <div className="flex gap-0 border-b border-border/40">
          {(["NIFTY","BANKNIFTY","SENSEX"] as IndexSymbol[]).map(ix => {
            const cnt = idxLogCount(ix);
            return (
              <button
                key={ix}
                type="button"
                onClick={() => setActiveIdx(ix)}
                className={`px-4 py-2.5 font-mono text-[12px] font-semibold tracking-wider border-b-2 -mb-px transition-all ${
                  activeIdx === ix
                    ? "border-violet-400 text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {IDX_LABEL[ix]}
                {cnt > 0 && <span className="ml-1.5 text-[10px] text-muted-foreground/60">({cnt})</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Section: Score factors */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Score the 9 factors —
            <span className="text-violet-400 ml-1">{IDX_LABEL[activeIdx]}</span>
            <span className="ml-1">· {mode === "INTRADAY" ? "intraday" : "pre/post"} weights · leave a factor unset to fail-close</span>
          </span>
          <div className="flex-1 h-px bg-border/30" />
        </div>

        {["A","B","C","D"].map(pk => (
          <PillarBlock
            key={pk}
            pillarKey={pk}
            mode={mode}
            factors={st.factors}
            dataOrigin={factorOrigin[mode][activeIdx]}
            onSet={setFactor}
          />
        ))}
      </div>

      {/* Event gate */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Event gate — factor 10 (overrides both models, does not add to score)
          </span>
          <div className="flex-1 h-px bg-border/30" />
        </div>
        <div className="bg-gradient-to-r from-amber-400/5 to-transparent border border-border/40 border-l-2 border-l-amber-400/70 rounded-lg p-4">
          <div className="text-sm font-semibold flex items-center gap-2 mb-1">
            <Shield className="w-4 h-4 text-amber-400" />
            <span className="font-mono text-[11px] text-muted-foreground">10</span>
            Events · Expiry · RBI/Fed · CAS integrity
          </div>
          <div className="text-[11.5px] text-muted-foreground mb-3">
            Arm any that apply. If armed, both verdicts are forced to <strong>NO DIRECTIONAL TRADE</strong>.
          </div>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(GATE_LABELS) as GateReason[]).map(g => (
              <button
                key={g}
                type="button"
                onClick={() => setGate(g, !st.gates[g])}
                className={`rounded px-3 py-1.5 font-mono text-[11px] border transition-all ${
                  st.gates[g]
                    ? "bg-amber-400/15 border-amber-400/60 text-amber-400"
                    : "bg-secondary/30 border-border/50 text-muted-foreground hover:text-foreground"
                }`}
              >
                {GATE_LABELS[g]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Coverage banner */}
      {bannerText && (
        <div className={`rounded-lg border px-4 py-2.5 font-mono text-[11.5px] font-semibold ${
          result.status === "GATED_NO_TRADE"
            ? "bg-amber-400/8 border-amber-400/40 text-amber-400"
            : result.status === "INSUFFICIENT_DATA"
              ? "bg-amber-400/8 border-amber-400/40 text-amber-400"
              : "bg-secondary/40 border-border/40 text-muted-foreground"
        }`}>
          {bannerText}
        </div>
      )}

      {/* Verdict cards */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Verdicts</span>
          <div className="flex-1 h-px bg-border/30" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <VerdictCard
            model="A" label="BALANCED"
            score={result.balScore}
            verdict={result.balVerdict}
            status={result.status}
            gateArmed={result.gateArmed}
          />
          <VerdictCard
            model="B" label="WEIGHTED · positioning tilt"
            score={result.wtdScore}
            verdict={result.wtdVerdict}
            status={result.status}
            gateArmed={result.gateArmed}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={logSession}
          className="flex items-center gap-1.5 rounded border border-violet-500/60 bg-violet-500/15 text-violet-300 font-mono text-[12px] font-semibold px-4 py-2 hover:bg-violet-500/25 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Log {IDX_LABEL[activeIdx]} {mode === "INTRADAY" ? "intraday" : "pre/post"}
        </button>
        {suggestedByIndex && (
          <button
            type="button"
            onClick={applyFromData}
            className="flex items-center gap-1.5 rounded border border-sky-500/50 bg-sky-500/10 text-sky-400 font-mono text-[12px] font-semibold px-4 py-2 hover:bg-sky-500/20 transition-colors"
          >
            <Database className="w-3.5 h-3.5" />
            Apply from data
          </button>
        )}
        <button
          type="button"
          onClick={resetActive}
          className="flex items-center gap-1.5 rounded border border-border/50 bg-secondary/30 text-muted-foreground font-mono text-[12px] font-semibold px-4 py-2 hover:text-foreground hover:border-border transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Reset inputs
        </button>
        <button
          type="button"
          onClick={exportCsv}
          className="flex items-center gap-1.5 rounded border border-border/50 bg-secondary/30 text-muted-foreground font-mono text-[12px] font-semibold px-4 py-2 hover:text-foreground hover:border-border transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV (all)
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirm("Clear ALL logged sessions (both modes, all indices)? Export first to keep them.")) {
              updateLog([]);
            }
          }}
          className="flex items-center gap-1.5 rounded border border-border/50 bg-secondary/30 text-muted-foreground font-mono text-[12px] font-semibold px-4 py-2 hover:text-signal-strong-sell hover:border-signal-strong-sell/40 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Clear all logs
        </button>
      </div>

      {/* Scoreboard */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Accuracy scoreboard —&nbsp;
            <span className="text-violet-400">{IDX_LABEL[activeIdx]}</span>
            &nbsp;·&nbsp;{mode === "INTRADAY" ? "intraday (dual grade)" : "pre/post"}
          </span>
          <div className="flex-1 h-px bg-border/30" />
        </div>
        <ScoreboardPanel
          rows={log.filter(e => e.index === activeIdx)}
          mode={mode}
          idxLabel={IDX_LABEL[activeIdx]}
        />
      </div>

      {/* Session log */}
      <div>
        <div className="flex items-center gap-3 mb-3">
          <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
            Session log —&nbsp;
            <span className="text-violet-400">{IDX_LABEL[activeIdx]}</span>
            &nbsp;· enter synthetic-futures return % to auto-grade
          </span>
          <div className="flex-1 h-px bg-border/30" />
        </div>
        <SessionLog
          rows={log}
          mode={mode}
          index={activeIdx}
          onUpdateRet={onUpdateRet}
          onDelete={onDelete}
        />
      </div>

      {/* Footnote */}
      <div className="border border-border/40 rounded-lg bg-card/50 p-4 text-xs text-muted-foreground leading-relaxed">
        {mode === "INTRADAY" ? (
          <>
            <strong className="text-foreground">Intraday (live) mode.</strong>{" "}
            Weights re-tilt to what is actually live: <strong className="text-foreground">price structure (F3) dominates</strong>, while participant split is
            unavailable — <strong className="text-foreground">F1/F2 are a live AGGREGATE OI-change proxy</strong>, badged as such, never presented as the FII/Pro
            split. <strong className="text-foreground">F8 (FII/DII cash) is EOD-only</strong>, shown frozen as "prev day" at near-zero weight. First 15 min after
            open fail-closed to{" "}
            <code className="font-mono bg-secondary/60 px-1 rounded text-violet-400 text-[11px]">INSUFFICIENT_DATA</code>{" "}(no range yet). Each verdict is a 1-min
            snapshot; in the platform these are immutable rows forming a session time series.{" "}
            <strong className="text-foreground">Dual grade:</strong> every snapshot is scored against BOTH a +60 min forward move and the session close, on
            synthetic-futures returns (bands NIFTY/SENSEX ±0.15%, BANKNIFTY ±0.22%) — two hit rates, avoid/skip excluded.{" "}
            <em>Not a trade signal.</em>
          </>
        ) : (
          <>
            <strong className="text-foreground">Pre/post mode.</strong>{" "}
            Settled EOD data; participant OI is the real FII/Pro split. Each index scored independently, graded on{" "}
            <strong className="text-foreground">synthetic-futures</strong> close-to-close vs a per-index band (NIFTY/SENSEX ±0.30%, BANKNIFTY ±0.45%). Fail-closed
            on any unset factor. A directional verdict is a hit only if its direction matches realized; No-edge/No-trade scored as avoid/skip and excluded from hit
            rate. Held in-page — Export CSV to persist.{" "}
            <em>Not a trade signal; a bias filter pending out-of-sample validation.</em>
          </>
        )}
      </div>
    </div>
  );
}
