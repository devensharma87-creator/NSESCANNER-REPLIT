import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Card } from "@/components/ui/card";
import type { SectorAllocation } from "@/lib/portfolio/types";
import { SECTOR_CONCENTRATION_PCT } from "@/lib/portfolio/score";
import { fmtPct, fmtSignedINR, pnlClass } from "./format";

const PALETTE = [
  "#38bdf8",
  "#34d399",
  "#fbbf24",
  "#f472b6",
  "#a78bfa",
  "#fb923c",
  "#22d3ee",
  "#f87171",
  "#4ade80",
  "#c084fc",
];

type SectorSlice = { name: string; value: number; color: string };

type SectorTooltipPayloadEntry = {
  name?: string;
  value?: number;
  payload?: SectorSlice;
};

function SectorTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: SectorTooltipPayloadEntry[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const entry = payload[0];
  const name = entry?.payload?.name ?? entry?.name ?? "";
  const value = typeof entry?.value === "number" ? entry.value : entry?.payload?.value;
  const color = entry?.payload?.color;
  return (
    <div
      style={{
        background: "#0f172a",
        color: "#e5edf8",
        border: "1px solid rgba(148,163,184,0.35)",
        borderRadius: 8,
        padding: "8px 10px",
        fontSize: 12,
        lineHeight: 1.3,
        boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {color && (
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 8,
              borderRadius: 2,
              background: color,
            }}
          />
        )}
        <span style={{ fontWeight: 600 }}>{name}</span>
        {typeof value === "number" && (
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{value.toFixed(1)}%</span>
        )}
      </span>
    </div>
  );
}

export function SectorAllocationPanel({ allocation }: { allocation: SectorAllocation[] }) {
  const chartData = allocation
    .filter(a => a.weightPct != null && a.weightPct > 0)
    .map((a, i) => ({ name: a.sector, value: a.weightPct as number, color: PALETTE[i % PALETTE.length] }));

  return (
    <Card className="p-3" data-testid="sector-allocation">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Sector Allocation</h3>
        <span className="text-[10px] text-muted-foreground">by current value</span>
      </div>

      {chartData.length === 0 ? (
        <div className="py-8 text-center text-xs text-muted-foreground">
          Live values pending — allocation will appear once prices load.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
          <div className="h-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={45}
                  outerRadius={75}
                  paddingAngle={2}
                  strokeWidth={0}
                >
                  {chartData.map(d => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip
                  content={<SectorTooltip />}
                  wrapperStyle={{ zIndex: 50, outline: "none" }}
                  allowEscapeViewBox={{ x: false, y: true }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="min-w-0 space-y-1">
            {allocation.map((a, i) => {
              const concentrated = a.weightPct != null && a.weightPct > SECTOR_CONCENTRATION_PCT;
              return (
                <div
                  key={a.sector}
                  className="flex items-center justify-between gap-2 text-xs"
                  data-testid={`sector-${a.sector}`}
                >
                  <span className="flex min-w-0 items-center gap-1.5 truncate">
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ background: PALETTE[i % PALETTE.length] }}
                    />
                    <span className="truncate">{a.sector}</span>
                    {concentrated && (
                      <span className="rounded bg-red-500/15 px-1 text-[9px] text-red-400">
                        concentrated
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-2 font-mono">
                    <span className="text-muted-foreground">{fmtPct(a.weightPct, 1)}</span>
                    <span className={pnlClass(a.pnl)}>{fmtSignedINR(a.pnl)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="mt-3 border-t border-border pt-2 text-[10px] text-muted-foreground">
        Benchmark comparison (vs Nifty 500 sector weights) is{" "}
        <span className="text-amber-500">unavailable</span> — no benchmark feed is wired in this
        version, so over/under-weight vs the index is not shown.
      </p>
    </Card>
  );
}
