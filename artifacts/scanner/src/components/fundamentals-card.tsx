/**
 * FundamentalsCard — Gate E, Pack 5 23A.
 *
 * Canonical IndianAPI reference data consumer.
 * Data flows: scanner → /api/data/fundamentals/:symbol → IndianAPIProvider → IndianAPI.
 * NEVER calls IndianAPI directly. NEVER uses Upstox values here.
 * NOT for trading decisions — displayed as reference only.
 *
 * Handles all 6 states:
 *   loading | error | NOT_CONFIGURED | RATE_LIMITED | stale (warning) | available
 *
 * All null values rendered as "—" (never hidden, never fabricated).
 */

import { useGetStockFundamentals, getGetStockFundamentalsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Info, TrendingUp } from "lucide-react";

// ---------------------------------------------------------------------------
// Null formatting helpers
// ---------------------------------------------------------------------------

function fmtNum(v: number | null | undefined, decimals = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toFixed(decimals);
}

function fmtPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}%`;
}

function fmtCr(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 100_000) return `₹${(v / 100_000).toFixed(2)} L Cr`;
  if (v >= 1_000)   return `₹${(v / 1_000).toFixed(2)}k Cr`;
  return `₹${v.toFixed(0)} Cr`;
}

// ---------------------------------------------------------------------------
// Sub-component: a labelled data row
// ---------------------------------------------------------------------------

function FRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 border-b border-border/50 last:border-0">
      <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground whitespace-nowrap">{label}</span>
      <span className="font-mono text-xs font-semibold text-right">{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface FundamentalsCardProps {
  symbol: string;
}

export function FundamentalsCard({ symbol }: FundamentalsCardProps) {
  const { data, isLoading, isError, dataUpdatedAt } = useGetStockFundamentals(symbol, {
    query: {
      enabled:         !!symbol,
      staleTime:       5 * 60_000, // 5 min — reference data changes slowly
      queryKey:        getGetStockFundamentalsQueryKey(symbol),
    },
  });

  // Loading skeleton
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Fundamentals</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Network error
  if (isError || !data) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Fundamentals</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <span>Could not load fundamentals data.</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // NOT_CONFIGURED — key absent (normal state for most deployments)
  if (data.providerState === "NOT_CONFIGURED") {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Fundamentals</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-2 text-sm">
            <Info className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-muted-foreground">Fundamentals data is not configured.</p>
              <p className="text-[11px] text-muted-foreground/70 font-mono">IndianAPI key absent — reference data unavailable.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // RATE_LIMITED
  if (data.providerState === "RATE_LIMITED") {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Fundamentals</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <span>Rate limited — fundamentals temporarily unavailable.</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Generic error state (provider returned error but not RATE_LIMITED)
  if (!data.ok && !data.profile && !data.ratios) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Fundamentals</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
            <span>Fundamentals data unavailable for this symbol.</span>
          </div>
          {data.warnings.length > 0 && (
            <p className="mt-1.5 text-[10px] font-mono text-muted-foreground/70">{data.warnings[0]}</p>
          )}
        </CardContent>
      </Card>
    );
  }

  // Stale warning badge (meta.validationStatus = "stale")
  const isStale = data.meta.validationStatus === "stale";
  // Last updated label
  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : null;

  const { profile, ratios } = data;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5" />
            Fundamentals
          </CardTitle>
          <div className="flex items-center gap-2">
            {isStale && (
              <Badge variant="outline" className="text-[10px] font-mono border-amber-500/50 text-amber-400">
                <AlertTriangle className="w-2.5 h-2.5 mr-1" />
                Stale
              </Badge>
            )}
            <Badge variant="outline" className="text-[10px] font-mono text-muted-foreground">
              IndianAPI · Reference only
            </Badge>
          </div>
        </div>
        {/* NOT FOR TRADING — always displayed */}
        <p className="text-[10px] text-muted-foreground/60 font-mono mt-1">
          Reference data only — not for trading decisions
        </p>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Company profile */}
        {profile && (
          <div className="space-y-0.5">
            <div className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider mb-2">Profile</div>
            {profile.companyName && (
              <FRow label="Company" value={profile.companyName} />
            )}
            <FRow label="Sector"   value={profile.sector    ?? "—"} />
            <FRow label="Industry" value={profile.industry  ?? "—"} />
            <FRow label="ISIN"     value={profile.isin      ?? "—"} />
            <FRow label="Mkt Cap"  value={fmtCr(profile.marketCap)} />
          </div>
        )}

        {/* Financial ratios */}
        {ratios && (
          <div className="space-y-0.5">
            <div className="text-[10px] font-mono uppercase text-muted-foreground tracking-wider mb-2">
              Ratios {ratios.period && <span className="normal-case">({ratios.period})</span>}
            </div>
            <FRow label="P/E"           value={fmtNum(ratios.pe)} />
            <FRow label="P/B"           value={fmtNum(ratios.pb)} />
            <FRow label="EPS"           value={fmtNum(ratios.eps)} />
            <FRow label="Div Yield"     value={fmtPct(ratios.dividendYield)} />
            <FRow label="ROE"           value={fmtPct(ratios.roe)} />
            <FRow label="D/E"           value={fmtNum(ratios.debtToEquity)} />
          </div>
        )}

        {/* Warnings */}
        {data.warnings.length > 0 && (
          <div className="space-y-1">
            {data.warnings.map((w, i) => (
              <p key={i} className="text-[10px] font-mono text-muted-foreground/70">{w}</p>
            ))}
          </div>
        )}

        {/* Source provenance */}
        <div className="text-[10px] font-mono text-muted-foreground/50 border-t border-border/30 pt-2">
          Source: IndianAPI ({data.plan ?? "unknown plan"})
          {lastUpdated && ` · Updated ${lastUpdated}`}
        </div>
      </CardContent>
    </Card>
  );
}
