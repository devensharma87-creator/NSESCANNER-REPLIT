/**
 * Home / Market Pulse — unified per-section source-map contract.
 *
 * Phase-1 data-accuracy work: every section on the Home page must be
 * source-honest. This pure module is the single source of truth for:
 *   1. WHICH upstream category powers each Home section (`HomeSourceCategory`).
 *   2. WHAT trust/freshness grade it carries right now (`HomeSourceStatus`).
 *   3. WHETHER that grade is high enough to inform a trade decision
 *      (`canDriveSignals`).
 *
 * The two axes are modelled SEPARATELY on purpose: a section can be perfectly
 * fresh yet still be `INFO_ONLY`/`COMPUTED` and therefore NOT drive signals
 * (e.g. FII/DII EOD flows, sector averages, derived mood). `TRADE_GRADE` — the
 * only status where `canDriveSignals` can become true — is reserved for live,
 * authoritative (Kite) quotes and is downgraded the moment the section falls
 * back to a delayed feed or goes stale.
 *
 * IMPORTANT — this module changes NO trading logic. It only classifies what is
 * already fetched so the UI can label it honestly. There are no thresholds,
 * no signal scoring, no broker calls, and it never fabricates a value.
 */

/** Upstream category that primarily powers a section. */
export type HomeSourceCategory =
  | "kite"
  | "yahoo"
  | "scanner_cache"
  | "db"
  | "computed"
  | "nse_archive"
  | "missing";

/** Trust/freshness grade of a section's data at render time. */
export type HomeSourceStatus =
  | "TRADE_GRADE" // live, authoritative (Kite) — the only status that may drive signals
  | "INFO_ONLY" // real data but contextual only (EOD flows, cached scans, exchange archives)
  | "DELAYED" // real market data, time-lagged (Yahoo ~15 min) — never trade-grade
  | "STALE" // authoritative source but past its freshness budget
  | "COMPUTED" // derived/aggregated indicator, not a raw quote
  | "SOURCE_NOT_INTEGRATED" // the feed for this section is not wired up yet
  | "UNAVAILABLE"; // expected data, but none received (shown honestly, never faked)

/** Static description of a Home section and its data provenance. */
export interface HomeSectionDescriptor {
  /** Stable id; drives the `section-source-<id>` test hook. */
  sectionId: string;
  /** Human label for the section. */
  label: string;
  /** Primary upstream category. */
  source: HomeSourceCategory;
  /** Status shown on the happy path (data present + primary source healthy). */
  baselineStatus: HomeSourceStatus;
  /** Whether this section's data grade is EVER high enough to inform a trade
   *  decision. Even when true, the resolved status must be `TRADE_GRADE` for
   *  `canDriveSignals` to actually be true. */
  canDriveSignals: boolean;
  /** Honest one-line description of the source and its limitations. */
  note: string;
}

/** Runtime facts a caller feeds in from the section's own hook data. */
export interface HomeSectionRuntime {
  /** Did the section actually receive real, renderable data? */
  hasData: boolean;
  /** Freshest datum time — epoch seconds (number), epoch millis, or ISO string. */
  asOf?: number | string | null;
  /** Seconds between asOf and build time, when the backend computed it. */
  freshnessSec?: number | null;
  /** Backend staleness verdict, when known (past the freshness budget). */
  isStale?: boolean | null;
  /** True when the primary (Kite) source degraded to a delayed fallback. */
  fallbackUsed?: boolean;
}

/** Fully-resolved, render-ready source descriptor for a section. */
export interface HomeSectionSource {
  sectionId: string;
  label: string;
  source: HomeSourceCategory;
  sourceStatus: HomeSourceStatus;
  asOf: number | string | null;
  freshnessSec: number | null;
  canDriveSignals: boolean;
  fallbackUsed: boolean;
  warning: string | null;
  note: string;
}

/**
 * The canonical Home / Market Pulse section map. Order roughly follows the
 * top-to-bottom layout of the Home page.
 */
export const HOME_MARKET_PULSE_SECTIONS: readonly HomeSectionDescriptor[] = [
  {
    sectionId: "global-cues",
    label: "Global Cues",
    source: "yahoo",
    baselineStatus: "DELAYED",
    canDriveSignals: false,
    note: "Global indices, FX, commodities & GIFT Nifty via Yahoo Finance (~15 min delayed). Display-only — never feeds any trade decision.",
  },
  {
    sectionId: "sentiment-vix",
    label: "India VIX",
    source: "yahoo",
    baselineStatus: "DELAYED",
    canDriveSignals: false,
    note: "India VIX via Yahoo Finance (~15 min delayed). Reference only.",
  },
  {
    sectionId: "sentiment-fii-dii",
    label: "FII / DII Flows",
    source: "db",
    baselineStatus: "INFO_ONLY",
    canDriveSignals: false,
    note: "FII/DII cash-market net flows — official end-of-day figures, one trading day lagged. Context only, never a live signal.",
  },
  {
    sectionId: "sentiment-expiry",
    label: "F&O Expiry",
    source: "computed",
    baselineStatus: "COMPUTED",
    canDriveSignals: false,
    note: "Next weekly F&O expiry derived from the calendar. Informational.",
  },
  {
    sectionId: "sectoral-heatmap",
    label: "Sectoral Heatmap",
    source: "scanner_cache",
    baselineStatus: "INFO_ONLY",
    canDriveSignals: false,
    note: "Sector averages computed from the scanner universe (Kite-first, Yahoo fallback). Context only.",
  },
  {
    sectionId: "market-breadth",
    label: "Market Breadth",
    source: "computed",
    baselineStatus: "COMPUTED",
    canDriveSignals: false,
    note: "Advance/decline breadth computed from the scanner universe.",
  },
  {
    sectionId: "home-indices",
    label: "Indian Indices",
    source: "kite",
    baselineStatus: "TRADE_GRADE",
    canDriveSignals: true,
    note: "Indian index LTP via the live broker (Kite) when connected, Yahoo (~15 min) fallback otherwise. PCR/RSI/options enrichment is reference-only — not for signals.",
  },
  {
    sectionId: "home-markets",
    label: "Markets — Indices, Commodities, ADRs & FX",
    source: "kite",
    baselineStatus: "TRADE_GRADE",
    canDriveSignals: true,
    note: "Indian index LTP via the live broker (Kite) when connected; global indices, commodities, FX & ADRs via TradingView/Yahoo (delayed). Per-row source shown on each card.",
  },
  {
    sectionId: "market-trend",
    label: "Overall Market Trend",
    source: "computed",
    baselineStatus: "COMPUTED",
    canDriveSignals: false,
    note: "Overall market trend derived from breadth, index rules and sector rotation. The underlying candle source is labelled separately.",
  },
  {
    sectionId: "market-mood",
    label: "Market Mood Index",
    source: "computed",
    baselineStatus: "COMPUTED",
    canDriveSignals: false,
    note: "Composite mood index derived from trend, breadth and volatility (VIX). A derived indicator, not a quote.",
  },
  {
    sectionId: "market-take",
    label: "Market Take",
    source: "computed",
    baselineStatus: "COMPUTED",
    canDriveSignals: false,
    note: "Auto-generated narrative summarising the computed trend and enrichment. Derived commentary.",
  },
  {
    sectionId: "fno-ban",
    label: "F&O Ban List",
    source: "nse_archive",
    baselineStatus: "INFO_ONLY",
    canDriveSignals: false,
    note: "NSE F&O ban list from the exchange archive (updates ~once daily). Regulatory context.",
  },
  {
    sectionId: "top-movers",
    label: "Top Movers",
    source: "kite",
    baselineStatus: "TRADE_GRADE",
    canDriveSignals: true,
    note: "Top movers ranked from the scanner universe; quotes Kite-first with Yahoo fallback. Individual rows flag delayed/stale sources.",
  },
  {
    sectionId: "top-setups",
    label: "Top Setups",
    source: "scanner_cache",
    baselineStatus: "INFO_ONLY",
    canDriveSignals: false,
    note: "Top scanner setups from the cached scan (Kite-first, Yahoo fallback). Signal-quality warnings are shown when picks derive from delayed/stale data.",
  },
] as const;

const SECTION_BY_ID: ReadonlyMap<string, HomeSectionDescriptor> = new Map(
  HOME_MARKET_PULSE_SECTIONS.map((s) => [s.sectionId, s]),
);

/** Look up a section descriptor by id (undefined when unknown). */
export function getHomeSectionDescriptor(
  sectionId: string,
): HomeSectionDescriptor | undefined {
  return SECTION_BY_ID.get(sectionId);
}

/**
 * Resolve a section's live source/trust label from its static descriptor plus
 * the runtime facts observed at render time. Pure and deterministic.
 *
 * Rules (honest by construction):
 *   - No data → `UNAVAILABLE` (or `SOURCE_NOT_INTEGRATED` when the feed isn't
 *     wired up). `canDriveSignals` is always false.
 *   - kite: fallback → `DELAYED`; explicitly stale → `STALE`; else `TRADE_GRADE`.
 *   - yahoo: always `DELAYED` (real but lagged) — never trade-grade.
 *   - scanner_cache / db / nse_archive: `INFO_ONLY` (contextual).
 *   - computed: `COMPUTED` (derived).
 *   - `canDriveSignals` is true ONLY when the descriptor allows it AND the
 *     resolved status is `TRADE_GRADE`.
 */
export function resolveHomeSectionSource(
  descriptor: HomeSectionDescriptor,
  runtime: HomeSectionRuntime,
): HomeSectionSource {
  const shared = {
    sectionId: descriptor.sectionId,
    label: descriptor.label,
    source: descriptor.source,
    note: descriptor.note,
  };

  if (!runtime.hasData) {
    const missingStatus: HomeSourceStatus =
      descriptor.baselineStatus === "SOURCE_NOT_INTEGRATED"
        ? "SOURCE_NOT_INTEGRATED"
        : "UNAVAILABLE";
    return {
      ...shared,
      sourceStatus: missingStatus,
      asOf: null,
      freshnessSec: null,
      canDriveSignals: false,
      fallbackUsed: false,
      warning:
        missingStatus === "SOURCE_NOT_INTEGRATED"
          ? descriptor.note
          : "No data received — showing nothing rather than a fabricated value.",
    };
  }

  const asOf = runtime.asOf ?? null;
  const freshnessSec = runtime.freshnessSec ?? null;
  const fallbackUsed = runtime.fallbackUsed ?? false;

  let sourceStatus: HomeSourceStatus;
  let warning: string | null = null;

  switch (descriptor.source) {
    case "kite":
      if (fallbackUsed) {
        sourceStatus = "DELAYED";
        warning =
          "Live broker feed unavailable — showing a delayed Yahoo fallback. Not trade-grade.";
      } else if (runtime.isStale === true) {
        sourceStatus = "STALE";
        warning = "Data is past its freshness budget.";
      } else {
        sourceStatus = "TRADE_GRADE";
      }
      break;
    case "yahoo":
      sourceStatus = "DELAYED";
      break;
    case "scanner_cache":
      sourceStatus = "INFO_ONLY";
      if (fallbackUsed) {
        warning =
          "Some rows fall back to delayed Yahoo quotes — not trade-grade.";
      }
      break;
    case "db":
      sourceStatus = "INFO_ONLY";
      break;
    case "nse_archive":
      sourceStatus = "INFO_ONLY";
      break;
    case "computed":
      sourceStatus = "COMPUTED";
      break;
    case "missing":
    default:
      sourceStatus = "UNAVAILABLE";
      break;
  }

  return {
    ...shared,
    sourceStatus,
    asOf,
    freshnessSec,
    canDriveSignals: descriptor.canDriveSignals && sourceStatus === "TRADE_GRADE",
    fallbackUsed,
    warning,
  };
}

/** Convenience: resolve by section id. Returns null for unknown ids. */
export function resolveHomeSectionSourceById(
  sectionId: string,
  runtime: HomeSectionRuntime,
): HomeSectionSource | null {
  const descriptor = SECTION_BY_ID.get(sectionId);
  if (!descriptor) return null;
  return resolveHomeSectionSource(descriptor, runtime);
}
