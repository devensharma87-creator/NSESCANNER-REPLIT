/**
 * G — F&O reason category chips strip.
 *
 * Consumes the diagnostics.suppressed[] array from the /options/signals
 * response and renders a horizontal strip of category chips (one per
 * bucket that had at least one match). Click-to-see-samples is done via
 * the native tooltip (title=) so this stays a zero-JS visual — no state,
 * no ARIA popover.
 *
 * Placement: right above the per-index diagnostics table on the F&O
 * cockpit / options page. Hidden when suppressed[] is empty so a green
 * day doesn't paint noise.
 */
import {
  summarizeFnoReasons,
  FNO_REASON_CATEGORY_LABEL,
  FNO_REASON_CATEGORY_CLASS,
} from "@/lib/fnoReasonCategories";

interface Suppressed {
  index?: string;
  reasons?: string[];
}

export function FnoReasonCategoriesStrip({
  suppressed,
  className = "",
}: {
  suppressed: readonly Suppressed[] | undefined | null;
  className?: string;
}) {
  const allReasons = (suppressed ?? [])
    .flatMap((s) => s.reasons ?? [])
    .filter((r): r is string => typeof r === "string" && r.length > 0);
  const buckets = summarizeFnoReasons(allReasons);
  if (buckets.length === 0) return null;

  return (
    <div
      className={`flex flex-wrap items-center gap-1.5 ${className}`}
      data-testid="fno-reason-categories-strip"
    >
      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        Suppressed by:
      </span>
      {buckets.map(({ category, count, samples }) => (
        <span
          key={category}
          data-testid={`fno-reason-chip-${category}`}
          title={
            samples.length > 0
              ? `${count} reason${count === 1 ? "" : "s"}:\n• ${samples.join("\n• ")}${count > samples.length ? `\n… and ${count - samples.length} more` : ""}`
              : undefined
          }
          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wide leading-none ${FNO_REASON_CATEGORY_CLASS[category]}`}
        >
          <span className="font-bold">
            {FNO_REASON_CATEGORY_LABEL[category]}
          </span>
          <span className="opacity-70">·</span>
          <span className="opacity-90">{count}</span>
        </span>
      ))}
    </div>
  );
}
