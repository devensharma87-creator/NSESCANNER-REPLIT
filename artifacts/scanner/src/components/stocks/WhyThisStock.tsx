/**
 * W2A — "Why this stock?" explanation panel for `/stocks-to-watch`.
 * Pure read-only display of EXISTING row fields. Missing fields render a clean
 * "—" placeholder, never a crash. No scoring/derivation of trading values.
 */
import { num, type SwingRow } from "@/lib/stocksToWatchView";

function val(s: string | null | undefined, dp?: number): string {
  if (s == null || s === "") return "—";
  if (dp != null) {
    const n = num(s);
    return Number.isFinite(n) ? n.toFixed(dp) : "—";
  }
  return s;
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-mono tabular-nums text-foreground/90">{children}</span>
    </div>
  );
}

export function WhyThisStock({ row }: { row: SwingRow }) {
  return (
    <div className="space-y-3 text-xs" data-testid="why-this-stock">
      {/* Score breakdown */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
          Score breakdown
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          <Stat label="Total">{val(row.score, 1)}</Stat>
          <Stat label="Technical">{val(row.technicalScore, 1)}</Stat>
          <Stat label="SMC">{val(row.smcScore, 1)}</Stat>
          <Stat label="Volume">{val(row.volumeScore, 1)}</Stat>
          <Stat label="Momentum">{val(row.momentumScore, 1)}</Stat>
          <Stat label="Fundamental">{val(row.fundamentalScore, 1)}</Stat>
          <Stat label="Risk">{val(row.riskScore, 1)}</Stat>
          <Stat label="Context">{val(row.contextScore, 1)}</Stat>
          <Stat label="RS score">{val(row.rsScore, 1)}</Stat>
          <Stat label="RS 20">{val(row.rs20, 1)}</Stat>
          <Stat label="RS 50">{val(row.rs50, 1)}</Stat>
          <Stat label="RS 120">{val(row.rs120, 1)}</Stat>
        </div>
      </div>

      {/* Levels */}
      <div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
          Levels &amp; plan
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2">
          <Stat label="Entry">{val(row.entry, 2)}</Stat>
          <Stat label="Stop">{val(row.stopLoss, 2)}</Stat>
          <Stat label="Target 1">{val(row.target1, 2)}</Stat>
          <Stat label="Target 2">{val(row.target2, 2)}</Stat>
          <Stat label="R:R → T1">{val(row.rrToT1, 2)}</Stat>
          <Stat label="Trigger px">{val(row.triggerPrice, 2)}</Stat>
          <Stat label="Buy zone">
            {val(row.buyZoneLower, 2)} – {val(row.buyZoneUpper, 2)}
          </Stat>
        </div>
        <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-muted-foreground">
          <div>Stop basis: <span className="text-foreground/80">{val(row.stopBasis)}</span></div>
          <div>Target basis: <span className="text-foreground/80">{val(row.targetBasis)}</span></div>
          <div>Buy-zone basis: <span className="text-foreground/80">{val(row.buyZoneBasis)}</span></div>
        </div>
        {row.triggerText && (
          <div className="mt-1.5 text-[11px] text-muted-foreground">
            Trigger: <span className="text-foreground/80">{row.triggerText}</span>
          </div>
        )}
      </div>

      {/* Context */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <Stat label="Sector">{val(row.sector)}</Stat>
        <Stat label="Industry">{val(row.industry)}</Stat>
        <Stat label="Weekly trend">{val(row.weeklyTrend)}</Stat>
        <Stat label="Candle">{val(row.candleSignal)}</Stat>
        <Stat label="Structure">{val(row.marketStructure)}</Stat>
        <Stat label="Fundamentals">{val(row.fundamentalStatus)}</Stat>
      </div>

      {/* Reasons */}
      {row.reasons?.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            Reasons
          </div>
          <ul className="list-disc pl-4 space-y-0.5 text-foreground/80">
            {row.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Warnings */}
      {row.warnings?.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
            Warnings
          </div>
          <ul className="list-disc pl-4 space-y-0.5 text-amber-500/90">
            {row.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
