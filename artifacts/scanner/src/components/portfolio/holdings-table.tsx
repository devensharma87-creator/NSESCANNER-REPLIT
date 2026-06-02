import { useMemo, useState } from "react";
import { ArrowUpDown, Trash2, AlertTriangle } from "lucide-react";
import type { EnrichedRow } from "@/lib/portfolio/types";
import { fmtINR, fmtSignedINR, fmtPct, fmtNum, pnlClass, actionViewClass } from "./format";

type SortKey =
  | "symbol"
  | "invested"
  | "currentValue"
  | "dayChange"
  | "totalReturn"
  | "totalReturnPct"
  | "weightPct"
  | "score";

function valueFor(row: EnrichedRow, key: SortKey): number | string {
  switch (key) {
    case "symbol":
      return row.raw.symbol;
    case "invested":
      return row.metrics.invested;
    case "currentValue":
      return row.metrics.currentValue ?? -Infinity;
    case "dayChange":
      return row.metrics.dayChange ?? -Infinity;
    case "totalReturn":
      return row.metrics.totalReturn ?? -Infinity;
    case "totalReturnPct":
      return row.metrics.totalReturnPct ?? -Infinity;
    case "weightPct":
      return row.metrics.weightPct ?? -Infinity;
    case "score":
      return row.analytics.score ?? -Infinity;
  }
}

export function HoldingsTable({
  rows,
  onSelect,
  onRemove,
}: {
  rows: EnrichedRow[];
  onSelect: (symbol: string) => void;
  onRemove: (symbol: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("weightPct");
  const [asc, setAsc] = useState(false);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = valueFor(a, sortKey);
      const bv = valueFor(b, sortKey);
      if (typeof av === "string" && typeof bv === "string") {
        return asc ? av.localeCompare(bv) : bv.localeCompare(av);
      }
      return asc ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return copy;
  }, [rows, sortKey, asc]);

  function toggle(key: SortKey) {
    if (key === sortKey) setAsc(a => !a);
    else {
      setSortKey(key);
      setAsc(false);
    }
  }

  const Th = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => (
    <th className={`px-2 py-2 ${right ? "text-right" : "text-left"}`}>
      <button
        onClick={() => toggle(k)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${
          sortKey === k ? "text-foreground" : "text-muted-foreground"
        }`}
        data-testid={`sort-${k}`}
      >
        {label}
        <ArrowUpDown className="h-3 w-3" />
      </button>
    </th>
  );

  return (
    <div className="overflow-x-auto rounded-md border border-border" data-testid="holdings-table">
      <table className="w-full min-w-[920px] text-xs">
        <thead className="bg-muted/40 text-[11px] uppercase tracking-wide">
          <tr>
            <Th k="symbol" label="Symbol" />
            <th className="px-2 py-2 text-right text-muted-foreground">Qty</th>
            <th className="px-2 py-2 text-right text-muted-foreground">Avg</th>
            <th className="px-2 py-2 text-right text-muted-foreground">CMP</th>
            <Th k="invested" label="Invested" right />
            <Th k="currentValue" label="Current" right />
            <Th k="dayChange" label="Day P&L" right />
            <Th k="totalReturn" label="Total P&L" right />
            <Th k="totalReturnPct" label="Return %" right />
            <Th k="weightPct" label="Weight" right />
            <Th k="score" label="Structure" right />
            <th className="px-2 py-2 text-left text-muted-foreground">Action View</th>
            <th className="px-2 py-2" />
          </tr>
        </thead>
        <tbody>
          {sorted.map(row => {
            const { raw, live, metrics, analytics, loading, errored } = row;
            return (
              <tr
                key={raw.symbol}
                className="cursor-pointer border-t border-border hover:bg-muted/30"
                onClick={() => onSelect(raw.symbol)}
                data-testid={`row-${raw.symbol}`}
              >
                <td className="px-2 py-2">
                  <div className="font-mono font-semibold">{raw.symbol}</div>
                  <div className="max-w-[150px] truncate text-[10px] text-muted-foreground">
                    {live.sector || raw.sector || raw.name}
                  </div>
                </td>
                <td className="px-2 py-2 text-right font-mono">{fmtNum(raw.qty, 0)}</td>
                <td className="px-2 py-2 text-right font-mono">{fmtINR(raw.rate, 2)}</td>
                <td className="px-2 py-2 text-right font-mono">
                  {loading ? (
                    <span className="text-muted-foreground">…</span>
                  ) : live.cmp != null ? (
                    fmtINR(live.cmp, 2)
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-500" title="Live price unavailable">
                      <AlertTriangle className="h-3 w-3" />—
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-right font-mono">{fmtINR(metrics.invested)}</td>
                <td className="px-2 py-2 text-right font-mono">{fmtINR(metrics.currentValue)}</td>
                <td className={`px-2 py-2 text-right font-mono ${pnlClass(metrics.dayChange)}`}>
                  {fmtSignedINR(metrics.dayChange)}
                </td>
                <td className={`px-2 py-2 text-right font-mono ${pnlClass(metrics.totalReturn)}`}>
                  {fmtSignedINR(metrics.totalReturn)}
                </td>
                <td className={`px-2 py-2 text-right font-mono ${pnlClass(metrics.totalReturnPct)}`}>
                  {fmtPct(metrics.totalReturnPct)}
                </td>
                <td className="px-2 py-2 text-right font-mono">{fmtPct(metrics.weightPct, 1)}</td>
                <td className="px-2 py-2 text-right font-mono">
                  {analytics.score == null ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    analytics.score
                  )}
                </td>
                <td className="px-2 py-2">
                  {analytics.label ? (
                    <span
                      className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] ${actionViewClass(
                        analytics.label,
                      )}`}
                    >
                      {analytics.label}
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">
                      {errored ? "data error" : "data unavailable"}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-right">
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      onRemove(raw.symbol);
                    }}
                    className="text-muted-foreground hover:text-red-500"
                    title="Remove holding"
                    data-testid={`remove-${raw.symbol}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
