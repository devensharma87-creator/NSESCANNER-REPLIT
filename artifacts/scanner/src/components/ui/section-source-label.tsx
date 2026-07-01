/**
 * SectionSourceLabel — compact, honest per-section data-source/trust chip for
 * the Home / Market Pulse page.
 *
 * Give it a `sectionId` from `HOME_MARKET_PULSE_SECTIONS` and the runtime facts
 * observed from that section's own hook data; it resolves the source + trust
 * grade via the pure `resolveHomeSectionSource` contract and renders a small
 * chip stating the source, the grade, whether the data may drive signals, and
 * an "as of" time when known. It never fabricates a value or a freshness.
 */
import { useEffect, useState } from "react";
import {
  resolveHomeSectionSourceById,
  type HomeSectionRuntime,
  type HomeSourceCategory,
  type HomeSourceStatus,
} from "@/lib/homeMarketPulseSourceMap";

const STATUS_META: Record<
  HomeSourceStatus,
  { label: string; cls: string }
> = {
  TRADE_GRADE: {
    label: "TRADE-GRADE",
    cls: "text-emerald-500 border-emerald-500/30 bg-emerald-500/10",
  },
  INFO_ONLY: {
    label: "INFO ONLY",
    cls: "text-sky-500 border-sky-500/30 bg-sky-500/10",
  },
  DELAYED: {
    label: "DELAYED",
    cls: "text-amber-500 border-amber-500/30 bg-amber-500/10",
  },
  STALE: {
    label: "STALE",
    cls: "text-orange-500 border-orange-500/30 bg-orange-500/10",
  },
  COMPUTED: {
    label: "COMPUTED",
    cls: "text-violet-500 border-violet-500/30 bg-violet-500/10",
  },
  SOURCE_NOT_INTEGRATED: {
    label: "NOT INTEGRATED",
    cls: "text-muted-foreground border-border bg-muted/40",
  },
  UNAVAILABLE: {
    label: "UNAVAILABLE",
    cls: "text-rose-500 border-rose-500/30 bg-rose-500/10",
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

/** Format an asOf value (epoch seconds, epoch millis, or ISO string) as a
 *  local clock time, or null when it can't be parsed. */
function formatAsOf(asOf: number | string | null): string | null {
  if (asOf == null) return null;
  let ms: number | null = null;
  if (typeof asOf === "number" && Number.isFinite(asOf)) {
    // Heuristic: treat < 1e12 as seconds, otherwise millis.
    ms = asOf < 1_000_000_000_000 ? asOf * 1000 : asOf;
  } else if (typeof asOf === "string") {
    const parsed = Date.parse(asOf);
    if (Number.isFinite(parsed)) ms = parsed;
  }
  if (ms == null) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  // Date-only strings (YYYY-MM-DD) read cleaner as a date than a midnight time.
  if (typeof asOf === "string" && /^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  }
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export function SectionSourceLabel({
  sectionId,
  runtime,
  className = "",
}: {
  sectionId: string;
  runtime: HomeSectionRuntime;
  className?: string;
}) {
  // Re-tick the "as of" label roughly once a minute so a page left open ages
  // its freshness display honestly rather than freezing at first render.
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const resolved = resolveHomeSectionSourceById(sectionId, runtime);
  if (!resolved) return null;

  const meta = STATUS_META[resolved.sourceStatus];
  const asOfLabel = formatAsOf(resolved.asOf);
  const title = resolved.warning
    ? `${resolved.note} — ${resolved.warning}`
    : resolved.note;

  return (
    <span
      data-testid={`section-source-${sectionId}`}
      data-status={resolved.sourceStatus}
      data-source={resolved.source}
      data-can-drive={resolved.canDriveSignals ? "true" : "false"}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded border px-1.5 py-0.5 text-[9px] font-mono uppercase tracking-wide leading-none ${meta.cls} ${className}`}
    >
      <span className="font-bold">{meta.label}</span>
      <span className="opacity-70">·</span>
      <span className="normal-case opacity-90">{SOURCE_LABEL[resolved.source]}</span>
      {asOfLabel && (
        <>
          <span className="opacity-70">·</span>
          <span className="normal-case opacity-70">as of {asOfLabel}</span>
        </>
      )}
    </span>
  );
}

export default SectionSourceLabel;
