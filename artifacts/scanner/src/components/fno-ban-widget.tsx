import { useGetFnoBanList, getGetFnoBanListQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertOctagon, Ban, ShieldCheck, Loader2, AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import { SectionSourceLabel } from "@/components/ui/section-source-label";

/**
 * F&O Ban List widget for the Home page.
 *
 * NSE bans F&O trading on stocks whose Market-Wide Position Limit (MWPL)
 * is breached. Banned stocks are restricted to **square-off-only** trades
 * — opening a fresh position carries a hefty exchange penalty.
 *
 * The widget renders four states:
 *   1. Loading           — neutral skeleton
 *   2. STALE/LAST KNOWN  — available=true but stale=true: serving expired
 *                          cache because NSE upstream refresh failed. Shows
 *                          last-known symbols with a warning that these
 *                          cannot authorize current admission decisions.
 *   3. Available         — green "all clear" tile if list is empty,
 *                          red warning tile listing every banned symbol otherwise
 *   4. Unavailable       — muted "data source down" tile. We never silently say
 *                          "no bans" if we don't know (no cache at all).
 *
 * Stale semantics (owner requirement):
 *   - available=true, stale=true  → STALE/LAST KNOWN (symbols shown with warning)
 *   - available=true, stale=false → current: ALL CLEAR (empty) or BANNED (>0 symbols)
 *   - available=false             → UNAVAILABLE (no data at all, no last-good)
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

  // UNAVAILABLE: no data at all (all upstreams failed, no cache ever populated).
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

  // STALE / LAST KNOWN: available=true but stale=true.
  // The refresh failed; we are serving an expired cache entry.
  // These symbols cannot authorize a current "banned/not-banned" admission decision.
  if (data.stale) {
    const asOf = data.fetchedAt
      ? new Date(data.fetchedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })
      : null;
    return (
      <Card className="border-amber-500/30 bg-gradient-to-b from-amber-500/5 to-transparent">
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="text-base font-mono flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-amber-500" /> F&amp;O BAN LIST
          </CardTitle>
          <div className="flex items-center gap-2">
            <SectionSourceLabel sectionId="fno-ban" runtime={{ hasData: true }} />
            <span className="text-[10px] font-mono uppercase tracking-wider text-amber-500 font-bold">
              STALE · LAST KNOWN
            </span>
          </div>
        </CardHeader>
        <CardContent className="pt-1 pb-3">
          <p className="text-[10px] font-mono text-amber-500/80 mb-2">
            NSE refresh failed — showing last-known data
            {asOf ? ` (as of ${asOf} IST)` : ""}. Cannot authorize current admission decisions.
          </p>
          {data.symbols.length === 0 ? (
            <p className="text-xs font-mono text-muted-foreground">No symbols were on the ban list at last sync.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {data.symbols.map((sym) => (
                <Link
                  key={sym}
                  href={`/stock/${sym}`}
                  className="px-2 py-1 rounded border border-amber-500/30 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 text-[11px] font-mono font-bold tabular-nums transition-colors"
                  title={`${sym} was on the ban list at last NSE sync — current status unknown`}
                >
                  {sym}
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ALL CLEAR: available=true, stale=false, no banned symbols.
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

  // BANNED: available=true, stale=false, symbols present.
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
