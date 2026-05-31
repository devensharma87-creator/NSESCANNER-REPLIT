/**
 * F&O cockpit controls bar (display-only).
 *
 * Renders client-side filter / sort / grouping controls for the F&O paper-trade
 * cockpit. It owns NO data and performs NO fetching — it is a controlled
 * component that reports changes upward. Every transformation it drives
 * (filtering, sorting, grouping) is applied by accepted PURE helpers in
 * `foCockpitView.ts` over rows the page already fetched. It changes NO trading
 * logic, NO backend, NO payload — purely how existing rows are shown.
 */
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  FoFilters,
  FoSortKey,
  FoSortDir,
  FoGroupBy,
} from "@/lib/foCockpitView";

export interface FoCockpitCounts {
  showing: number;
  total: number;
  open: number;
  closed: number;
  active: number;
}

const SORT_KEY_LABELS: Record<FoSortKey, string> = {
  entryTime: "Entry time",
  exitTime: "Exit time",
  realizedPnl: "Realised P&L",
  unrealizedPnl: "Unrealised P&L",
  mfe: "MFE",
  mae: "MAE",
  confidence: "Confidence",
  timeInTrade: "Time in trade",
  symbol: "Index / symbol",
};

const GROUP_LABELS: Record<FoGroupBy, string> = {
  none: "No grouping",
  index: "Index",
  setup: "Setup",
  exitReason: "Exit reason",
  status: "Status",
  p25Status: "P25 status",
  pnlSign: "P&L sign",
};

function LabeledSelect({
  label,
  value,
  onChange,
  children,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
        {hint ? <span className="ml-1 normal-case text-muted-foreground/70">{hint}</span> : null}
      </span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </div>
  );
}

function AllPlus({ options }: { options: string[] }) {
  return (
    <>
      <SelectItem value="ALL">All</SelectItem>
      {options.map((o) => (
        <SelectItem key={o} value={o}>
          {o}
        </SelectItem>
      ))}
    </>
  );
}

export function FoCockpitControls({
  filters,
  onFilters,
  sortKey,
  onSortKey,
  sortDir,
  onSortDir,
  groupBy,
  onGroupBy,
  onReset,
  options,
  counts,
}: {
  filters: FoFilters;
  onFilters: (f: FoFilters) => void;
  sortKey: FoSortKey;
  onSortKey: (k: FoSortKey) => void;
  sortDir: FoSortDir;
  onSortDir: (d: FoSortDir) => void;
  groupBy: FoGroupBy;
  onGroupBy: (g: FoGroupBy) => void;
  onReset: () => void;
  options: {
    indexes: string[];
    setups: string[];
    directions: string[];
    optionTypes: string[];
    exitReasons: string[];
  };
  counts: FoCockpitCounts;
}) {
  const set = (patch: Partial<FoFilters>) => onFilters({ ...filters, ...patch });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center justify-between gap-2 text-base">
          <span>F&amp;O Cockpit — Filters &amp; View</span>
          <Button size="sm" variant="outline" onClick={onReset} disabled={counts.active === 0}>
            Reset filters
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Filters */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <LabeledSelect label="Index" value={filters.index} onChange={(v) => set({ index: v })}>
            <AllPlus options={options.indexes} />
          </LabeledSelect>
          <LabeledSelect label="Setup" value={filters.setup} onChange={(v) => set({ setup: v })}>
            <AllPlus options={options.setups} />
          </LabeledSelect>
          <LabeledSelect
            label="Direction"
            value={filters.direction}
            onChange={(v) => set({ direction: v })}
          >
            <AllPlus options={options.directions} />
          </LabeledSelect>
          <LabeledSelect
            label="Option type"
            value={filters.optionType}
            onChange={(v) => set({ optionType: v })}
          >
            <AllPlus options={options.optionTypes} />
          </LabeledSelect>
          <LabeledSelect label="Status" value={filters.status} onChange={(v) => set({ status: v })}>
            <SelectItem value="ALL">All</SelectItem>
            <SelectItem value="OPEN">Open</SelectItem>
            <SelectItem value="CLOSED">Closed</SelectItem>
          </LabeledSelect>
          <LabeledSelect
            label="P&L sign"
            value={filters.pnlSign}
            onChange={(v) => set({ pnlSign: v as FoFilters["pnlSign"] })}
          >
            <SelectItem value="ALL">All</SelectItem>
            <SelectItem value="POSITIVE">Profit</SelectItem>
            <SelectItem value="NEGATIVE">Loss</SelectItem>
          </LabeledSelect>
          <LabeledSelect
            label="Exit reason"
            value={filters.exitReason}
            onChange={(v) => set({ exitReason: v })}
            hint="(closed only)"
          >
            <AllPlus options={options.exitReasons} />
          </LabeledSelect>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Date from
            </span>
            <Input
              type="date"
              className="h-8 text-xs"
              value={filters.dateFrom ?? ""}
              onChange={(e) => set({ dateFrom: e.target.value || null })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Date to
            </span>
            <Input
              type="date"
              className="h-8 text-xs"
              value={filters.dateTo ?? ""}
              onChange={(e) => set({ dateTo: e.target.value || null })}
            />
          </div>
        </div>

        {/* Toggles */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={filters.p25EligibleOnly}
              onCheckedChange={(c) => set({ p25EligibleOnly: c === true })}
            />
            P25 eligible only <span className="text-muted-foreground/70">(closed only)</span>
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={filters.evidenceAvailableOnly}
              onCheckedChange={(c) => set({ evidenceAvailableOnly: c === true })}
            />
            MFE/MAE evidence available only{" "}
            <span className="text-muted-foreground/70">(closed only)</span>
          </label>
        </div>

        {/* Sort & group */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3">
          <LabeledSelect
            label="Sort by"
            value={sortKey}
            onChange={(v) => onSortKey(v as FoSortKey)}
          >
            {(Object.keys(SORT_KEY_LABELS) as FoSortKey[]).map((k) => (
              <SelectItem key={k} value={k}>
                {SORT_KEY_LABELS[k]}
              </SelectItem>
            ))}
          </LabeledSelect>
          <LabeledSelect
            label="Sort direction"
            value={sortDir}
            onChange={(v) => onSortDir(v as FoSortDir)}
          >
            <SelectItem value="desc">Descending</SelectItem>
            <SelectItem value="asc">Ascending</SelectItem>
          </LabeledSelect>
          <LabeledSelect
            label="Group by"
            value={groupBy}
            onChange={(v) => onGroupBy(v as FoGroupBy)}
          >
            {(Object.keys(GROUP_LABELS) as FoGroupBy[]).map((g) => (
              <SelectItem key={g} value={g}>
                {GROUP_LABELS[g]}
              </SelectItem>
            ))}
          </LabeledSelect>
        </div>

        {/* Result counts */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 pt-3 text-xs">
          <span className="font-medium">
            Showing {counts.showing} of {counts.total} F&amp;O rows
          </span>
          <span className="text-muted-foreground">Open: {counts.open}</span>
          <span className="text-muted-foreground">Closed: {counts.closed}</span>
          <span className="text-muted-foreground">Filters active: {counts.active}</span>
        </div>

        {/* Safety labels */}
        <div className="space-y-0.5 text-[11px] text-muted-foreground">
          <p>Paper trading only — no live order placement.</p>
          <p>Filters and grouping are display-only and do not affect trading logic.</p>
        </div>
      </CardContent>
    </Card>
  );
}
