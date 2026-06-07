/** Portfolio Analyser — display formatting helpers (presentation only). */
import type { ActionView, Verdict, Confidence } from "@/lib/portfolio/types";
import type { TrendTone } from "@/lib/portfolio/etf";

const inr0 = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtINR(n: number | null | undefined, dp: 0 | 2 = 0): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `₹${(dp === 2 ? inr2 : inr0).format(n)}`;
}

export function fmtSignedINR(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${fmtINR(n)}`;
}

export function fmtPct(n: number | null | undefined, dp = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}${n.toFixed(dp)}%`;
}

export function fmtNum(n: number | null | undefined, dp = 2): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(dp);
}

export function pnlClass(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "text-muted-foreground";
  if (n > 0) return "text-emerald-500";
  if (n < 0) return "text-red-500";
  return "text-muted-foreground";
}

/** Tailwind classes for the neutral action-view badge. */
export function actionViewClass(label: ActionView | null): string {
  switch (label) {
    case "Strong Structure":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "Hold with Review":
      return "bg-sky-500/15 text-sky-400 border-sky-500/30";
    case "Mixed / Watch":
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "Weak Structure":
      return "bg-orange-500/15 text-orange-400 border-orange-500/30";
    case "Reduce Review":
    case "Exit Review":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    case "Avoid Fresh Buy":
      return "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

/** Tailwind classes for the decisive advisor verdict badge. */
export function verdictClass(v: Verdict | null): string {
  switch (v) {
    case "ACCUMULATE":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "HOLD":
      return "bg-sky-500/15 text-sky-400 border-sky-500/30";
    case "TRIM":
      return "bg-amber-500/15 text-amber-400 border-amber-500/30";
    case "AVOID":
      return "bg-fuchsia-500/15 text-fuchsia-400 border-fuchsia-500/30";
    case "EXIT":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    case "WATCHLIST":
      return "bg-slate-500/15 text-slate-300 border-slate-500/30";
    case "DATA_INCOMPLETE":
      return "bg-muted text-muted-foreground border-border border-dashed";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

/** Human-friendly verdict label (DATA_INCOMPLETE → "DATA INCOMPLETE"). */
export function verdictLabel(v: Verdict): string {
  return v === "DATA_INCOMPLETE" ? "DATA INCOMPLETE" : v;
}

/** Tailwind classes for the confidence pill. */
export function confidenceClass(c: Confidence | null): string {
  switch (c) {
    case "High":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/25";
    case "Medium":
      return "bg-amber-500/10 text-amber-400 border-amber-500/25";
    case "Low":
      return "bg-muted text-muted-foreground border-border";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

/** Tailwind text class for a reason-code impact. */
export function impactClass(impact: "positive" | "negative" | "neutral"): string {
  if (impact === "positive") return "text-emerald-400";
  if (impact === "negative") return "text-red-400";
  return "text-muted-foreground";
}

/** Tailwind classes for the compact ETF trend chip (CMP vs 50/200-DMA). */
export function trendChipClass(tone: TrendTone): string {
  switch (tone) {
    case "pos":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30";
    case "neg":
      return "bg-red-500/15 text-red-400 border-red-500/30";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}

export function fmtAge(ts: number | null | undefined): string {
  if (ts == null) return "—";
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}
