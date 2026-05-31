/**
 * W2A — client-side filter / sort / group controls for `/stocks-to-watch`.
 * Pure presentation: emits filter/sort/group state changes; no data fetching,
 * no scoring. All filtering happens client-side over the existing payload.
 */
import {
  ACTION_FILTERS,
  type SwingFilters,
  type SortKey,
  type SortDir,
  type GroupBy,
} from "@/lib/stocksToWatchView";

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: "score", label: "Score" },
  { key: "rsScore", label: "RS" },
  { key: "rrToT1", label: "R:R" },
  { key: "rsi14", label: "RSI" },
  { key: "atrPct", label: "ATR%" },
  { key: "symbol", label: "Symbol" },
];

const GROUP_OPTIONS: Array<{ key: GroupBy; label: string }> = [
  { key: "none", label: "No grouping" },
  { key: "action", label: "By action" },
  { key: "sector", label: "By sector" },
  { key: "scoreBucket", label: "By score" },
  { key: "rsStrength", label: "By RS strength" },
  { key: "trigger", label: "By trigger status" },
];

const inputCls =
  "h-7 w-16 rounded border border-border bg-card px-2 text-xs font-mono tabular-nums focus:outline-none focus:ring-1 focus:ring-primary";
const selectCls =
  "h-7 rounded border border-border bg-card px-2 text-xs focus:outline-none focus:ring-1 focus:ring-primary";

function numOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function ControlsBar({
  filters,
  setFilters,
  sectors,
  sortKey,
  sortDir,
  onSort,
  groupBy,
  setGroupBy,
  resultCount,
}: {
  filters: SwingFilters;
  setFilters: (f: SwingFilters) => void;
  sectors: string[];
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (k: SortKey) => void;
  groupBy: GroupBy;
  setGroupBy: (g: GroupBy) => void;
  resultCount: number;
}) {
  const patch = (p: Partial<SwingFilters>) => setFilters({ ...filters, ...p });

  return (
    <div className="space-y-2" data-testid="swing-controls">
      {/* Action chips */}
      <div className="flex flex-wrap gap-1.5">
        {ACTION_FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => patch({ action: f.key })}
            className={`px-2.5 py-1 rounded-md border text-[11px] uppercase tracking-wide transition-colors ${
              filters.action === f.key
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Row 2: selects + ranges + toggles */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <label className="inline-flex items-center gap-1.5">
          <span className="text-muted-foreground uppercase tracking-wide text-[10px]">Sector</span>
          <select
            className={selectCls}
            value={filters.sector}
            onChange={(e) => patch({ sector: e.target.value })}
          >
            <option value="ALL">All</option>
            {sectors.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <span className="inline-flex items-center gap-1">
          <span className="text-muted-foreground uppercase tracking-wide text-[10px]">Score</span>
          <input
            type="number"
            placeholder="min"
            className={inputCls}
            value={filters.scoreMin ?? ""}
            onChange={(e) => patch({ scoreMin: numOrNull(e.target.value) })}
          />
          <span className="text-muted-foreground">–</span>
          <input
            type="number"
            placeholder="max"
            className={inputCls}
            value={filters.scoreMax ?? ""}
            onChange={(e) => patch({ scoreMax: numOrNull(e.target.value) })}
          />
        </span>

        <span className="inline-flex items-center gap-1">
          <span className="text-muted-foreground uppercase tracking-wide text-[10px]">RS</span>
          <input
            type="number"
            placeholder="min"
            className={inputCls}
            value={filters.rsMin ?? ""}
            onChange={(e) => patch({ rsMin: numOrNull(e.target.value) })}
          />
          <span className="text-muted-foreground">–</span>
          <input
            type="number"
            placeholder="max"
            className={inputCls}
            value={filters.rsMax ?? ""}
            onChange={(e) => patch({ rsMax: numOrNull(e.target.value) })}
          />
        </span>

        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.actionableOnly}
            onChange={(e) => patch({ actionableOnly: e.target.checked })}
          />
          <span className="text-muted-foreground">Actionable only</span>
        </label>
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.triggerHitOnly}
            onChange={(e) => patch({ triggerHitOnly: e.target.checked })}
          />
          <span className="text-muted-foreground">Trigger hit</span>
        </label>
        <label className="inline-flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={filters.freshOnly}
            onChange={(e) => patch({ freshOnly: e.target.checked })}
          />
          <span className="text-muted-foreground">Fresh intraday</span>
        </label>
      </div>

      {/* Row 3: sort + group + count */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <label className="inline-flex items-center gap-1.5">
          <span className="text-muted-foreground uppercase tracking-wide text-[10px]">Sort</span>
          <select
            className={selectCls}
            value={sortKey}
            onChange={(e) => onSort(e.target.value as SortKey)}
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <button
            onClick={() => onSort(sortKey)}
            className="h-7 px-2 rounded border border-border text-muted-foreground hover:text-foreground"
            title="Toggle sort direction"
          >
            {sortDir === "desc" ? "↓" : "↑"}
          </button>
        </label>

        <label className="inline-flex items-center gap-1.5">
          <span className="text-muted-foreground uppercase tracking-wide text-[10px]">Group</span>
          <select
            className={selectCls}
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
          >
            {GROUP_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <span className="ml-auto text-muted-foreground font-mono tabular-nums">
          {resultCount} result{resultCount === 1 ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
