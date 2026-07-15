/**
 * UnifiedGradeChip — decoupled version of the Market-Pulse SectionSourceLabel.
 *
 * `SectionSourceLabel` binds a chip to a static Home descriptor in
 * `HOME_MARKET_PULSE_SECTIONS`. For pages that don't have (and don't need)
 * a slot in that registry — e.g. the Option Chain PCR / Max Pain / ATM IV /
 * Total OI / Greeks cards — this atom accepts an *inline* descriptor and
 * runtime and renders the exact same canonical vocabulary via the pure
 * `deriveHomeUnifiedGrade` helper. This keeps a single visual + semantic
 * grammar for source/trust chips across the whole app.
 *
 * The rendered pill mirrors SectionSourceLabel's palette so the two are
 * interchangeable to the eye — differences are limited to how the input
 * is sourced (registry vs inline).
 */
import { useEffect, useState } from "react";
import {
  deriveHomeUnifiedGrade,
  type HomeSectionRuntime,
  type HomeSourceCategory,
  type HomeSourceStatus,
  type HomeUnifiedGrade,
} from "@/lib/homeMarketPulseSourceMap";
import { useUnifiedGradeTelemetry } from "@/lib/useUnifiedGradeTelemetry";

// Kept in sync with section-source-label.tsx.
const UNIFIED_META: Record<HomeUnifiedGrade, { label: string; cls: string }> = {
  KITE_TRADE_GRADE: {
    label: "KITE TRADE-GRADE",
    cls: "text-emerald-500 border-emerald-500/30 bg-emerald-500/10",
  },
  NSE_ARCHIVE: {
    label: "NSE ARCHIVE",
    cls: "text-teal-500 border-teal-500/30 bg-teal-500/10",
  },
  DELAYED_T_PLUS_1: {
    label: "DELAYED T+1",
    cls: "text-amber-500 border-amber-500/30 bg-amber-500/10",
  },
  INFO_ONLY: {
    label: "INFO ONLY",
    cls: "text-sky-500 border-sky-500/30 bg-sky-500/10",
  },
  UNAVAILABLE: {
    label: "UNAVAILABLE",
    cls: "text-rose-500 border-rose-500/30 bg-rose-500/10",
  },
  PROVIDER_NOT_CONFIGURED: {
    label: "PROVIDER NOT CONFIGURED",
    cls: "text-muted-foreground border-border bg-muted/40",
  },
};

const SOURCE_LABEL: Record<HomeSourceCategory, string> = {
  kite: "Kite",
  yahoo: "Yahoo ~15m",
  scanner_cache: "Scanner cache",
  db: "NSE EOD",
  computed: "Derived",
  nse_archive: "NSE archive",
  missing: "—",
};

function formatAsOf(asOf: number | string | null | undefined): string | null {
  if (asOf == null) return null;
  let ms: number | null = null;
  if (typeof asOf === "number" && Number.isFinite(asOf)) {
    ms = asOf < 1_000_000_000_000 ? asOf * 1000 : asOf;
  } else if (typeof asOf === "string") {
    const parsed = Date.parse(asOf);
    if (Number.isFinite(parsed)) ms = parsed;
  }
  if (ms == null) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  if (typeof asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  }
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Pure resolver that walks the same rules as `resolveHomeSectionSource`
 *  but reads from an inline descriptor instead of the Home registry. */
export function resolveInlineSource({
  source,
  baselineStatus,
  runtime,
}: {
  source: HomeSourceCategory;
  baselineStatus?: HomeSourceStatus;
  runtime: HomeSectionRuntime;
}): { sourceStatus: HomeSourceStatus; grade: HomeUnifiedGrade } {
  if (!runtime.hasData) {
    const missing: HomeSourceStatus =
      baselineStatus === "SOURCE_NOT_INTEGRATED"
        ? "SOURCE_NOT_INTEGRATED"
        : "UNAVAILABLE";
    return { sourceStatus: missing, grade: deriveHomeUnifiedGrade(missing, source) };
  }
  let sourceStatus: HomeSourceStatus;
  const fallbackUsed = runtime.fallbackUsed ?? false;
  switch (source) {
    case "kite":
      if (fallbackUsed) sourceStatus = "DELAYED";
      else if (runtime.isStale === true) sourceStatus = "STALE";
      else sourceStatus = "TRADE_GRADE";
      break;
    case "yahoo":
      sourceStatus = "DELAYED";
      break;
    case "scanner_cache":
    case "db":
    case "nse_archive":
      sourceStatus = "INFO_ONLY";
      break;
    case "computed":
      sourceStatus = "COMPUTED";
      break;
    case "missing":
    default:
      sourceStatus = "UNAVAILABLE";
  }
  return {
    sourceStatus,
    grade: deriveHomeUnifiedGrade(sourceStatus, source),
  };
}

export interface UnifiedGradeChipProps {
  /** Stable id used for `data-testid`; kept short and kebab-case. */
  chipId: string;
  /** Primary upstream category powering the data. */
  source: HomeSourceCategory;
  /** Runtime facts as observed at render time. */
  runtime: HomeSectionRuntime;
  /** Optional baseline hint (SOURCE_NOT_INTEGRATED when a feed isn't wired). */
  baselineStatus?: HomeSourceStatus;
  /** Optional tooltip / long-form note. */
  note?: string;
  /** Optional soft-warning shown in the tooltip when data quality degrades. */
  warning?: string;
  /** Optional extra className for the outer span. */
  className?: string;
}

export function UnifiedGradeChip({
  chipId,
  source,
  runtime,
  baselineStatus,
  note,
  warning,
  className = "",
}: UnifiedGradeChipProps) {
  // Re-tick roughly once a minute so the "as of" label ages honestly even
  // when no other state in the parent is changing.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const resolved = resolveInlineSource({ source, baselineStatus, runtime });
  const meta = UNIFIED_META[resolved.grade];
  const asOfLabel = formatAsOf(runtime.asOf);
  const title = warning
    ? note
      ? `${note} — ${warning}`
      : warning
    : note ?? "";

  // Post a client-event to /api/observability/client-event whenever the
  // derived grade transitions. Server treats KITE_TRADE_GRADE →
  // INFO_ONLY/UNAVAILABLE/DELAYED_T_PLUS_1 as warn-tier so ops notices
  // provider degradation without having to eyeball every chip.
  useUnifiedGradeTelemetry({
    chipId,
    grade: resolved.grade,
    source,
  });

  return (
    <span
      data-testid={`unified-grade-${chipId}`}
      data-status={resolved.sourceStatus}
      data-grade={resolved.grade}
      data-source={source}
      title={title || undefined}
      className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wide leading-none ${meta.cls} ${className}`}
    >
      <span className="font-bold">{meta.label}</span>
      <span className="opacity-70">·</span>
      <span className="normal-case opacity-90">{SOURCE_LABEL[source]}</span>
      {asOfLabel && (
        <>
          <span className="opacity-70">·</span>
          <span className="normal-case opacity-70">as of {asOfLabel}</span>
        </>
      )}
    </span>
  );
}

export default UnifiedGradeChip;
