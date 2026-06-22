import { useMemo, useState } from "react";
import { ArrowUpDown, Trash2, AlertTriangle, Pencil } from "lucide-react";
import type { EnrichedRow } from "@/lib/portfolio/types";
import { etfCategory, describeEtfTrend } from "@/lib/portfolio/etf";
import {
  fmtINR,
  fmtSignedINR,
  fmtPct,
  fmtNum,
  pnlClass,
  actionViewClass,
  trendChipClass,
} from "./format";

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

/** Explicit, labelled unavailable cell — never a bare em-dash. */
function Unavailable({ reason }: { reason: string }) {
  return (
    <span className="text-muted-foreground" title={reason}>
      n/a
    </span>
  );
}

export function HoldingsTable({
  rows,
  onSelect,
  onRemove,
  onEdit,
}: {
  rows: EnrichedRow[];
  onSelect: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  onEdit: (symbol: string) => void;
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
            const { raw, live, metrics, analytics, loading, errored, resolution, manualCmp } = row;
            const reasonText = resolution.reason ?? (errored ? "data error" : "data unavailable");
            const provenance = [
              resolution.resolvedSymbol && resolution.resolvedSymbol !== resolution.originalSymbol
                ? `resolved → ${resolution.resolvedSymbol}`
                : null,
              resolution.dataSource ? `source: ${resolution.dataSource}` : null,
              resolution.instrumentType !== "Equity" ? resolution.instrumentType : null,
            ]
              .filter(Boolean)
              .join(" · ");
            const isEtf = !resolution.fundamentalsApplicable && resolution.instrumentType !== "Equity";
            const etfSymbol = resolution.resolvedSymbol ?? raw.symbol;
            const etfCat = isEtf ? etfCategory(etfSymbol, resolution.instrumentType) : null;
            const etfTrend = isEtf
              ? describeEtfTrend(live.cmp, live.dma50, live.dma200)
              : null;
            return (
              <tr
                key={raw.symbol}
                className="cursor-pointer border-t border-border hover:bg-muted/30"
                onClick={() => onSelect(raw.symbol)}
                data-testid={`row-${raw.symbol}`}
              >
                <td className="px-2 py-2">
                  <div className="flex items-center gap-1 font-mono font-semibold">
                    {raw.symbol}
                    {isEtf && (
                      <span
                        className="rounded border border-sky-500/40 bg-sky-500/10 px-1 text-[9px] font-medium text-sky-400"
                        title={`${resolution.instrumentType} — fundamentals not applicable`}
                      >
                        ETF
                      </span>
                    )}
                    {!loading && manualCmp != null && (
                      <span
                        className="rounded border border-violet-500/40 bg-violet-500/10 px-1 text-[9px] font-medium text-violet-400"
                        title={`Manual price — no live quote available, so this holding is valued using your entered CMP of ${fmtINR(manualCmp, 2)}. Not a live quote.`}
                      >
                        MANUAL
                      </span>
                    )}
                    {!loading && manualCmp == null && resolution.priceState && (
                      <span
                        className={`rounded border px-1 text-[9px] font-medium ${
                          resolution.priceState === "KITE LIVE"
                            ? "border-green-500/40 bg-green-500/10 text-green-400"
                            : resolution.priceState === "KITE STALE"
                              ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
                              : "border-red-500/40 bg-red-500/10 text-red-500"
                        }`}
                        title={
                          resolution.priceState === "KITE LIVE"
                            ? "Live price resolved and priced through central quote service"
                            : resolution.priceState === "KITE STALE"
                              ? "Stale price (older than 24h)"
                              : `Price unavailable: ${reasonText} (${provenance || "No metadata"}). Preserved; excluded from live valuation. Use Edit to enter a manual price.`
                        }
                      >
                        {resolution.priceState}
                      </span>
                    )}
                  </div>
                  <div className="max-w-[150px] truncate text-[10px] text-muted-foreground">
                    {live.sector || raw.sector || raw.name}
                  </div>
                </td>
                <td className="px-2 py-2 text-right font-mono">{fmtNum(raw.qty, 0)}</td>
                <td className="px-2 py-2 text-right font-mono">{fmtINR(raw.rate, 2)}</td>
                <td className="px-2 py-2 text-right font-mono">
                  {loading ? (
                    <span className="text-muted-foreground">…</span>
                  ) : manualCmp != null ? (
                    <span
                      className="inline-flex items-center gap-1 text-violet-400"
                      title={`Manual price (no live quote) — ${fmtINR(manualCmp, 2)}. Used for valuation until a live quote is available.`}
                    >
                      {fmtINR(manualCmp, 2)}
                      <span className="rounded border border-violet-500/40 bg-violet-500/10 px-1 text-[8px] font-medium">
                        M
                      </span>
                    </span>
                  ) : live.cmp != null ? (
                    fmtINR(live.cmp, 2)
                  ) : (
                    <span
                      className="inline-flex items-center gap-1 text-amber-500"
                      title={provenance ? `${reasonText} (${provenance})` : reasonText}
                    >
                      <AlertTriangle className="h-3 w-3" />
                      n/a
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-right font-mono">{fmtINR(metrics.invested)}</td>
                <td className="px-2 py-2 text-right font-mono">
                  {metrics.currentValue == null ? <Unavailable reason={reasonText} /> : fmtINR(metrics.currentValue)}
                </td>
                <td className={`px-2 py-2 text-right font-mono ${pnlClass(metrics.dayChange)}`}>
                  {metrics.dayChange == null ? <Unavailable reason={reasonText} /> : fmtSignedINR(metrics.dayChange)}
                </td>
                <td className={`px-2 py-2 text-right font-mono ${pnlClass(metrics.totalReturn)}`}>
                  {metrics.totalReturn == null ? <Unavailable reason={reasonText} /> : fmtSignedINR(metrics.totalReturn)}
                </td>
                <td className={`px-2 py-2 text-right font-mono ${pnlClass(metrics.totalReturnPct)}`}>
                  {metrics.totalReturnPct == null ? <Unavailable reason={reasonText} /> : fmtPct(metrics.totalReturnPct)}
                </td>
                <td className="px-2 py-2 text-right font-mono">
                  {metrics.weightPct == null ? <Unavailable reason={reasonText} /> : fmtPct(metrics.weightPct, 1)}
                </td>
                <td className="px-2 py-2 text-right font-mono">
                  {isEtf ? (
                    etfTrend ? (
                      <span
                        className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] ${trendChipClass(
                          etfTrend.tone,
                        )}`}
                        title="CMP vs 50/200-DMA — descriptive trend, not advice"
                      >
                        {etfTrend.text}
                      </span>
                    ) : (
                      <Unavailable reason="ETF trend needs 50/200-DMA (not available)" />
                    )
                  ) : analytics.score == null ? (
                    <Unavailable reason="Structure score needs live data" />
                  ) : (
                    analytics.score
                  )}
                </td>
                <td className="px-2 py-2">
                  {isEtf ? (
                    <span
                      className="inline-block whitespace-nowrap rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-400"
                      title={`ETF category — tracks ${etfSymbol}'s mandate; equity action view not applicable`}
                    >
                      {etfCat}
                    </span>
                  ) : analytics.label ? (
                    <span
                      className={`inline-block cursor-help whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] ${actionViewClass(
                        analytics.label,
                      )}`}
                      title={[
                        `${analytics.label}${analytics.score != null ? ` · structure score ${analytics.score}/100` : ""}`,
                        analytics.reasons.length ? `Why: ${analytics.reasons.join(" ")}` : "",
                        analytics.componentsUsed.length
                          ? `Based on: ${analytics.componentsUsed.join(", ")}.`
                          : "",
                        "Review-oriented label — not investment advice.",
                      ]
                        .filter(Boolean)
                        .join("\n")}
                    >
                      {analytics.label}
                    </span>
                  ) : (
                    <span
                      className="text-[10px] text-muted-foreground"
                      title={provenance ? `${reasonText} (${provenance})` : reasonText}
                    >
                      {reasonText}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={e => {
                        e.stopPropagation();
                        onEdit(raw.symbol);
                      }}
                      className="text-muted-foreground hover:text-foreground"
                      title="Edit holding"
                      data-testid={`edit-${raw.symbol}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
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
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
