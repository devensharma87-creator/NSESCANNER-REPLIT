/**
 * G — F&O Cockpit reason category classifier.
 *
 * Ingests a suppressed-reason prose string produced by the backend
 * signal pipeline and maps it into one of seven owner-facing buckets so
 * the diagnostics UI can render categorical chips instead of a wall of
 * free-form text. Pure — no side effects, no I/O, safe to call in a
 * render pass.
 *
 * The seven categories match the spec in the user's zero-compromise
 * brief (G.6): data failure / risk veto / signal-quality fail / market
 * closed / no setup / capital block / broker disabled.
 *
 * When a reason doesn't match any signature it falls into OTHER — the
 * caller is expected to also show the raw reason string, so no info
 * gets lost. The classifier is intentionally conservative: patterns
 * only match when the reason clearly belongs to a bucket, otherwise
 * OTHER wins.
 */
export type FnoReasonCategory =
  | "DATA_FAILURE"
  | "RISK_VETO"
  | "SIGNAL_QUALITY"
  | "MARKET_CLOSED"
  | "NO_SETUP"
  | "CAPITAL_BLOCK"
  | "BROKER_DISABLED"
  | "OTHER";

interface CategoryRule {
  category: FnoReasonCategory;
  re: RegExp;
}

// Ordered — first match wins. Data failures come first because a data
// gap often manifests downstream as "no setup" and mis-categorizing
// hides the real root cause.
const RULES: readonly CategoryRule[] = [
  // ── DATA_FAILURE — Kite session, chain fetch, warm-up, staleness ───
  { category: "DATA_FAILURE", re: /kite[\s_-]?session[\s_-]?expired/i },
  { category: "DATA_FAILURE", re: /kite[\s_-]?not[\s_-]?ready/i },
  { category: "DATA_FAILURE", re: /option[\s_-]?chain[\s_-]?(unavailable|missing|failed|fetch)/i },
  { category: "DATA_FAILURE", re: /option[\s_-]?chain\s+unavailable/i },
  { category: "DATA_FAILURE", re: /data[\s_-]?warm[\s_-]?up/i },
  { category: "DATA_FAILURE", re: /stale|staleness|past freshness/i },
  { category: "DATA_FAILURE", re: /instrument[\s_-]?master|contract[\s_-]?not[\s_-]?found/i },
  { category: "DATA_FAILURE", re: /source[\s_-]?not[\s_-]?integrated|provider not configured/i },
  { category: "DATA_FAILURE", re: /insufficient[\s_-]?bars|insufficient candles/i },

  // ── MARKET_CLOSED — session gates ─────────────────────────────────
  { category: "MARKET_CLOSED", re: /market[\s_-]?(is[\s_-]?)?closed/i },
  { category: "MARKET_CLOSED", re: /pre[\s_-]?open/i },
  { category: "MARKET_CLOSED", re: /post[\s_-]?close/i },
  { category: "MARKET_CLOSED", re: /opening[\s_-]?noise[\s_-]?gate|before 09:30/i },
  { category: "MARKET_CLOSED", re: /late[\s_-]?session[\s_-]?entry[\s_-]?gate|after 14:30/i },

  // ── BROKER_DISABLED — auto-trading kill switch / broker path off ──
  { category: "BROKER_DISABLED", re: /broker[\s_-]?(execution[\s_-]?)?disabled/i },
  { category: "BROKER_DISABLED", re: /kill[\s_-]?switch/i },
  { category: "BROKER_DISABLED", re: /auto[\s_-]?trading[\s_-]?off/i },

  // ── CAPITAL_BLOCK — free cash / concurrent-cap / margin ───────────
  { category: "CAPITAL_BLOCK", re: /insufficient[\s_-]?capital|not enough free cash/i },
  { category: "CAPITAL_BLOCK", re: /concurrent[\s_-]?cap|max positions? reached/i },
  { category: "CAPITAL_BLOCK", re: /portfolio[\s_-]?heat/i },
  { category: "CAPITAL_BLOCK", re: /daily[\s_-]?cap|max[\s_-]?trades[\s_-]?per[\s_-]?day/i },
  { category: "CAPITAL_BLOCK", re: /margin[\s_-]?shortfall/i },

  // ── RISK_VETO — regime hysteresis, drawdown, cooldown, expiry-day ─
  { category: "RISK_VETO", re: /bias[\s_-]?flip[\s_-]?cooldown/i },
  { category: "RISK_VETO", re: /post[\s_-]?stop[\s_-]?cooldown/i },
  { category: "RISK_VETO", re: /consecutive[\s_-]?stops/i },
  { category: "RISK_VETO", re: /circuit[\s_-]?breaker/i },
  { category: "RISK_VETO", re: /dd[\s_-]?latch|drawdown[\s_-]?latch/i },
  { category: "RISK_VETO", re: /india[\s_-]?vix[\s_-]?spike/i },
  { category: "RISK_VETO", re: /correlat(ed|ion)[\s_-]?(exposure|dedup)/i },
  { category: "RISK_VETO", re: /oi[\s_-]?hard[\s_-]?veto|oi[\s_-]?veto/i },
  { category: "RISK_VETO", re: /vol[\s_-]?regime|volatile[\s_-]?regime/i },
  { category: "RISK_VETO", re: /expiry[\s_-]?day[\s_-]?gate|expiry-day gate/i },
  { category: "RISK_VETO", re: /f&o[\s_-]?ban[\s_-]?list|fno[\s_-]?ban/i },

  // ── SIGNAL_QUALITY — confidence / demote / IV clamp ───────────────
  { category: "SIGNAL_QUALITY", re: /confidence[\s_-]?below/i },
  { category: "SIGNAL_QUALITY", re: /demoted|demote/i },
  { category: "SIGNAL_QUALITY", re: /iv[\s_-]?clamp|iv[\s_-]?extreme/i },
  { category: "SIGNAL_QUALITY", re: /rr[\s_-]?below|risk[\s_-]?reward[\s_-]?below/i },
  { category: "SIGNAL_QUALITY", re: /rvol[\s_-]?below/i },
  { category: "SIGNAL_QUALITY", re: /adx[\s_-]?below/i },
  { category: "SIGNAL_QUALITY", re: /score[\s_-]?below/i },

  // ── NO_SETUP — no detector fired at all ───────────────────────────
  { category: "NO_SETUP", re: /no[\s_-]?setup[\s_-]?fired|no[\s_-]?trigger/i },
  { category: "NO_SETUP", re: /all[\s_-]?detectors[\s_-]?silent/i },
  { category: "NO_SETUP", re: /no[\s_-]?directional[\s_-]?edge/i },
];

/**
 * Classify a single reason string into one of the seven G-buckets.
 * Returns `OTHER` when no rule matches (the caller must still show the
 * raw string — nothing is discarded).
 */
export function classifyFnoReason(reason: string): FnoReasonCategory {
  const r = reason ?? "";
  for (const rule of RULES) if (rule.re.test(r)) return rule.category;
  return "OTHER";
}

/**
 * Bucket-tally an array of reason strings. Returns categories in a
 * stable order (unmatched OTHER last) so consumers can render deterministic
 * chip lists.
 */
export function summarizeFnoReasons(
  reasons: readonly string[],
): { category: FnoReasonCategory; count: number; samples: string[] }[] {
  const order: FnoReasonCategory[] = [
    "DATA_FAILURE",
    "MARKET_CLOSED",
    "BROKER_DISABLED",
    "CAPITAL_BLOCK",
    "RISK_VETO",
    "SIGNAL_QUALITY",
    "NO_SETUP",
    "OTHER",
  ];
  const map = new Map<FnoReasonCategory, string[]>();
  for (const r of reasons) {
    const cat = classifyFnoReason(r);
    const list = map.get(cat) ?? [];
    list.push(r);
    map.set(cat, list);
  }
  return order
    .filter((c) => map.has(c))
    .map((c) => {
      const samples = map.get(c)!;
      return { category: c, count: samples.length, samples: samples.slice(0, 3) };
    });
}

/** Owner-facing labels for the seven buckets. */
export const FNO_REASON_CATEGORY_LABEL: Record<FnoReasonCategory, string> = {
  DATA_FAILURE: "Data failure",
  MARKET_CLOSED: "Market closed",
  BROKER_DISABLED: "Broker disabled",
  CAPITAL_BLOCK: "Capital block",
  RISK_VETO: "Risk veto",
  SIGNAL_QUALITY: "Signal quality",
  NO_SETUP: "No setup",
  OTHER: "Other",
};

/** Tailwind classes for each category chip. */
export const FNO_REASON_CATEGORY_CLASS: Record<FnoReasonCategory, string> = {
  DATA_FAILURE: "text-rose-400 border-rose-500/30 bg-rose-500/10",
  MARKET_CLOSED: "text-slate-400 border-slate-500/30 bg-slate-500/10",
  BROKER_DISABLED: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  CAPITAL_BLOCK: "text-orange-400 border-orange-500/30 bg-orange-500/10",
  RISK_VETO: "text-violet-400 border-violet-500/30 bg-violet-500/10",
  SIGNAL_QUALITY: "text-sky-400 border-sky-500/30 bg-sky-500/10",
  NO_SETUP: "text-muted-foreground border-border bg-muted/30",
  OTHER: "text-muted-foreground border-border bg-muted/20",
};
