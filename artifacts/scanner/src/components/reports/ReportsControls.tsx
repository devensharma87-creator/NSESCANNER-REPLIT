/**
 * Reports controls bar for the owner-only `/paper-reports` Overview (W4-P7).
 *
 * Read-only, client-side review tooling. Drives filtering, date-range
 * narrowing, sorting and a client-side CSV export of the *currently visible*
 * normalized report rows. It performs NO data fetching and NO calculation
 * beyond the accepted pure helpers in `lib/reportsView.ts` — it only renders
 * controls and emits the new filter/sort state to its parent.
 *
 * Truthfulness rules:
 *  - Dropdown options come only from values present in the data
 *    (`collectReportFilterOptions`) — never a fabricated taxonomy.
 *  - CSV is generated in-browser from the rows the parent already filtered &
 *    sorted (`serializeReportRowsToCsv`). No backend call, no server file
 *    write, no raw DB access.
 *  - Export is disabled when there are zero visible rows.
 */
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, RotateCcw, SlidersHorizontal } from "lucide-react";
import {
  collectReportFilterOptions,
  countActiveReportFilters,
  serializeReportRowsToCsv,
  type CsvColumnSpec,
  type JournalFilter,
  type NormalizedReportRow,
  type PnlSignFilter,
  type ReportFilters,
  type ReportSortKey,
  type SegmentFilter,
  type SortDir,
} from "@/lib/reportsView";

const ALL = "__ALL__";

/** Deterministic CSV column order for the export. */
const CSV_COLUMNS: readonly CsvColumnSpec[] = [
  { key: "signalDate", header: "Date" },
  { key: "segment", header: "Segment" },
  { key: "index", header: "Symbol/Index" },
  { key: "setupKey", header: "Setup" },
  { key: "direction", header: "Direction" },
  { key: "exitReason", header: "Exit Reason" },
  { key: "realizedPnl", header: "Realised P&L" },
  { key: "rMultiple", header: "R Multiple" },
  { key: "journal", header: "Journal" },
  { key: "tags", header: "Tags" },
];

const SORT_KEY_LABELS: Record<ReportSortKey, string> = {
  date: "Date",
  pnl: "Realised P&L",
  rMultiple: "R Multiple",
  setup: "Setup",
  exitReason: "Exit Reason",
  symbol: "Symbol/Index",
  duration: "Duration",
  mfe: "MFE",
  mae: "MAE",
};

const SORT_KEYS: readonly ReportSortKey[] = [
  "date",
  "pnl",
  "rMultiple",
  "setup",
  "exitReason",
  "symbol",
  "duration",
  "mfe",
  "mae",
];

export interface ReportsControlsProps {
  filters: ReportFilters;
  onFiltersChange: (next: ReportFilters) => void;
  sortKey: ReportSortKey;
  sortDir: SortDir;
  onSortKeyChange: (key: ReportSortKey) => void;
  onSortDirChange: (dir: SortDir) => void;
  onReset: () => void;
  /** Unfiltered rows — used only to derive the dropdown option sets. */
  allRows: NormalizedReportRow[];
  /** Filtered + sorted rows — used for the CSV export and the shown count. */
  visibleRows: NormalizedReportRow[];
}

function triggerCsvDownload(filename: string, csv: string): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function fieldCls() {
  return "h-8 w-full min-w-0 text-xs";
}

export function ReportsControls({
  filters,
  onFiltersChange,
  sortKey,
  sortDir,
  onSortKeyChange,
  onSortDirChange,
  onReset,
  allRows,
  visibleRows,
}: ReportsControlsProps) {
  const options = useMemo(() => collectReportFilterOptions(allRows), [allRows]);
  const activeCount = countActiveReportFilters(filters);
  const total = allRows.length;
  const shown = visibleRows.length;
  const canExport = shown > 0;

  const set = (patch: Partial<ReportFilters>) =>
    onFiltersChange({ ...filters, ...patch });

  const handleExport = () => {
    if (!canExport) return;
    const csv = serializeReportRowsToCsv(visibleRows, CSV_COLUMNS);
    const stamp = new Date().toISOString().slice(0, 10);
    triggerCsvDownload(`paper-reports-${stamp}.csv`, csv);
  };

  const hasSetups = options.setups.length > 0;
  const hasIndexes = options.indexes.length > 0;
  const hasExitReasons = options.exitReasons.length > 0;
  const hasTags = options.tags.length > 0;

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
          <SlidersHorizontal className="h-3.5 w-3.5 text-sky-300" />
          Filters &amp; export
          {activeCount > 0 && (
            <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-300">
              {activeCount} active
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground">
          Showing {shown} of {total} report rows
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {/* Segment */}
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Segment
          </Label>
          <Select
            value={filters.segment}
            onValueChange={(v) => set({ segment: v as SegmentFilter })}
          >
            <SelectTrigger className={fieldCls()}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All segments</SelectItem>
              <SelectItem value="FNO">F&amp;O</SelectItem>
              <SelectItem value="EQUITY">Equity</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Setup */}
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Setup
          </Label>
          <Select
            value={filters.setup ?? ALL}
            onValueChange={(v) => set({ setup: v === ALL ? null : v })}
            disabled={!hasSetups}
          >
            <SelectTrigger className={fieldCls()}>
              <SelectValue placeholder={hasSetups ? undefined : "—"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All setups</SelectItem>
              {options.setups.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Index / symbol */}
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Symbol / Index
          </Label>
          <Select
            value={filters.index ?? ALL}
            onValueChange={(v) => set({ index: v === ALL ? null : v })}
            disabled={!hasIndexes}
          >
            <SelectTrigger className={fieldCls()}>
              <SelectValue placeholder={hasIndexes ? undefined : "—"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All symbols</SelectItem>
              {options.indexes.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Exit reason */}
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Exit reason
          </Label>
          <Select
            value={filters.exitReason ?? ALL}
            onValueChange={(v) => set({ exitReason: v === ALL ? null : v })}
            disabled={!hasExitReasons}
          >
            <SelectTrigger className={fieldCls()}>
              <SelectValue placeholder={hasExitReasons ? undefined : "—"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All exits</SelectItem>
              {options.exitReasons.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Tag */}
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Tag
          </Label>
          <Select
            value={filters.tag ?? ALL}
            onValueChange={(v) => set({ tag: v === ALL ? null : v })}
            disabled={!hasTags}
          >
            <SelectTrigger className={fieldCls()}>
              <SelectValue placeholder={hasTags ? undefined : "—"} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All tags</SelectItem>
              {options.tags.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* P&L sign */}
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            P&amp;L
          </Label>
          <Select
            value={filters.pnlSign}
            onValueChange={(v) => set({ pnlSign: v as PnlSignFilter })}
          >
            <SelectTrigger className={fieldCls()}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All P&amp;L</SelectItem>
              <SelectItem value="POSITIVE">Winners</SelectItem>
              <SelectItem value="NEGATIVE">Losers</SelectItem>
              <SelectItem value="FLAT">Scratch</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Journal presence */}
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Journal
          </Label>
          <Select
            value={filters.journal}
            onValueChange={(v) => set({ journal: v as JournalFilter })}
          >
            <SelectTrigger className={fieldCls()}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All notes</SelectItem>
              <SelectItem value="PRESENT">With note</SelectItem>
              <SelectItem value="MISSING">No note</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Date from */}
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Date from
          </Label>
          <Input
            type="date"
            value={filters.from ?? ""}
            max={filters.to ?? undefined}
            onChange={(e) => set({ from: e.target.value || null })}
            className={fieldCls()}
          />
        </div>

        {/* Date to */}
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Date to
          </Label>
          <Input
            type="date"
            value={filters.to ?? ""}
            min={filters.from ?? undefined}
            onChange={(e) => set({ to: e.target.value || null })}
            className={fieldCls()}
          />
        </div>

        {/* Sort key */}
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Sort by
          </Label>
          <Select
            value={sortKey}
            onValueChange={(v) => onSortKeyChange(v as ReportSortKey)}
          >
            <SelectTrigger className={fieldCls()}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORT_KEYS.map((k) => (
                <SelectItem key={k} value={k}>
                  {SORT_KEY_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Sort direction */}
        <div className="space-y-1">
          <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Direction
          </Label>
          <Select
            value={sortDir}
            onValueChange={(v) => onSortDirChange(v as SortDir)}
          >
            <SelectTrigger className={fieldCls()}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="desc">Descending</SelectItem>
              <SelectItem value="asc">Ascending</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={onReset}
            disabled={activeCount === 0}
          >
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            Reset filters
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            onClick={handleExport}
            disabled={!canExport}
            title={canExport ? undefined : "No rows to export"}
          >
            <Download className="mr-1 h-3.5 w-3.5" />
            Export visible rows CSV
          </Button>
          {!canExport && (
            <span className="text-[11px] text-muted-foreground">
              No exportable rows.
            </span>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground">
          Filters active: {activeCount}
        </span>
      </div>

      <p className="text-[10px] text-slate-500">
        Filters and CSV export are review tools only — they do not affect
        trading logic or paper-trade execution.
      </p>
    </div>
  );
}
