import { useGetFnoBanList, getGetFnoBanListQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertOctagon, Ban, ShieldCheck, Loader2 } from "lucide-react";
import { Link } from "wouter";
import { SectionSourceLabel } from "@/components/ui/section-source-label";

/**
 * F&O Ban List widget for the Home page.
 *
 * NSE bans F&O trading on stocks whose Market-Wide Position Limit (MWPL)
 * is breached. Banned stocks are restricted to **square-off-only** trades
 * — opening a fresh position carries a hefty exchange penalty.
 *
 * The widget renders three states:
 *   1. Loading       — neutral skeleton
 *   2. Available     — green "all clear" tile if list is empty,
 *                      red warning tile listing every banned symbol otherwise
 *   3. Unavailable   — muted "data source down" tile (NSE upstream blocked
 *                      a non-Indian IP, etc.). We never silently say
 *                      "no bans" if we don't know.
 */
export default function FnoBanWidget() {
  const { data, isLoading } = useGetFnoBanList({
    query: {
      // Refresh every 15 minutes — list changes once a day at ~19:00 IST,
      // but a steady poll lets us recover from cold-start upstream failures.
      refetchInterval: 15 * 60 * 1000,
      refetchIntervalInBackground: false,
      queryKey: getGetFnoBanListQueryKey(),
      staleTime: 5 * 60 * 1000,
    },
  });

  if (isLoading) {
    return (
      <Card className="border-border">
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="text-base font-mono flex items-center gap-2">
            <Ban className="w-5 h-5 text-muted-foreground" /> F&amp;O BAN LIST
          </CardTitle>
        </CardHeader>
        <CardContent className="py-4 flex items-center gap-2 text-xs font-mono text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading from NSE…
        </CardContent>
      </Card>
    );
  }

  if (!data || data.available === false) {
    return (
      <Card className="border-border bg-muted/10">
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="text-base font-mono flex items-center gap-2">
            <Ban className="w-5 h-5 text-muted-foreground" /> F&amp;O BAN LIST
          </CardTitle>
          <div className="flex items-center gap-2">
            <SectionSourceLabel sectionId="fno-ban" runtime={{ hasData: false }} />
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              unavailable
            </span>
          </div>
        </CardHeader>
        <CardContent className="py-3 text-xs font-mono text-muted-foreground">
          NSE upstream unreachable — list will resume once the archive responds.
        </CardContent>
      </Card>
    );
  }

  if (data.symbols.length === 0) {
    return (
      <Card className="border-signal-strong-buy/20 bg-gradient-to-b from-signal-strong-buy/5 to-transparent">
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="text-base font-mono flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-signal-strong-buy" /> F&amp;O BAN LIST
          </CardTitle>
          <div className="flex items-center gap-2">
            <SectionSourceLabel sectionId="fno-ban" runtime={{ hasData: true }} />
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              all clear
            </span>
          </div>
        </CardHeader>
        <CardContent className="py-3 text-xs font-mono text-muted-foreground">
          No F&amp;O underlyings are currently restricted.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-signal-strong-sell/30 bg-gradient-to-b from-signal-strong-sell/5 to-transparent">
      <CardHeader className="pb-2 flex-row items-center justify-between">
        <CardTitle className="text-base font-mono flex items-center gap-2">
          <AlertOctagon className="w-5 h-5 text-signal-strong-sell" /> F&amp;O BAN LIST
        </CardTitle>
        <div className="flex items-center gap-2">
          <SectionSourceLabel sectionId="fno-ban" runtime={{ hasData: true }} />
          <span className="text-[10px] font-mono uppercase tracking-wider text-signal-strong-sell font-bold">
            {data.count} restricted · square-off only
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-2 pb-3">
        <div className="flex flex-wrap gap-1.5">
          {data.symbols.map((sym) => (
            <Link
              key={sym}
              href={`/stock/${sym}`}
              className="px-2 py-1 rounded border border-signal-strong-sell/30 bg-signal-strong-sell/10 text-signal-strong-sell hover:bg-signal-strong-sell/20 hover:border-signal-strong-sell text-[11px] font-mono font-bold tabular-nums transition-colors"
              title={`${sym} is on the F&O ban list — fresh F&O positions blocked, square-off only`}
            >
              {sym}
            </Link>
          ))}
        </div>
        <p className="mt-2.5 text-[10px] font-mono text-muted-foreground">
          MWPL breached — fresh F&amp;O positions are blocked. Existing positions
          can only be reduced/squared off until the breach is cured.
        </p>
      </CardContent>
    </Card>
  );
}
