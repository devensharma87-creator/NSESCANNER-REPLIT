/**
 * Trendlyne web-widget embed.
 *
 * Trendlyne ships a small number of free, sanctioned web widgets (SWOT,
 * Checklist, QVT Score, Forecaster, etc.) as `<blockquote>` placeholders
 * that their `tl-widgets.js` script transforms into iframes at runtime.
 *
 * No API key is required — these are explicitly published for embedding
 * in third-party sites. See the `data-get-url` pattern at
 * https://trendlyne.com (each widget has its own URL slug).
 *
 * SPA caveat: the loader script auto-processes all matching blockquotes
 * once when it executes. On client-side route changes the script has
 * already run, so we re-append the script tag whenever the symbol or
 * widget set changes — re-running the loader is idempotent (it skips
 * blockquotes it has already converted) and the file is small + CDN
 * cached, so the cost is negligible.
 */
import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type TrendlyneWidgetKind = "swot" | "checklist" | "qvtscore" | "forecaster" | "technical";

const WIDGET_LOADER_SRC =
  "https://cdn-static.trendlyne.com/static/js/webwidgets/tl-widgets.js";

// Brand-tuned colour params that Trendlyne accepts on every widget URL.
// Kept in one place so we can re-skin all four widgets at once later.
const COLOR_PARAMS =
  "posCol=00A25B&primaryCol=006AFF&negCol=EB3B00&neuCol=F7941E";

const WIDGET_LABELS: Record<TrendlyneWidgetKind, string> = {
  swot: "SWOT analysis",
  checklist: "Checklist",
  qvtscore: "Quality / Valuation / Technicals",
  forecaster: "Analyst forecaster",
  technical: "Technical analysis",
};

function buildUrl(kind: TrendlyneWidgetKind, symbol: string): string {
  // Trendlyne accepts the NSE symbol as the slug for the vast majority of
  // stocks. For symbols it doesn't recognise, the iframe shows an empty
  // shell (no broken layout) — we let that be the "no data" state.
  const safeSym = encodeURIComponent(symbol.toUpperCase());
  return `https://trendlyne.com/web-widget/${kind}-widget/Poppins/${safeSym}/?${COLOR_PARAMS}`;
}

function TrendlyneWidget({ kind, symbol }: { kind: TrendlyneWidgetKind; symbol: string }) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
          Trendlyne · {WIDGET_LABELS[kind]}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-2">
        {/*
          The `key` forces React to recreate the blockquote whenever the
          symbol or widget kind changes — without it the loader script
          would skip the (already-processed) element on subsequent runs.
        */}
        <blockquote
          key={`${kind}-${symbol}`}
          className="trendlyne-widgets"
          data-get-url={buildUrl(kind, symbol)}
          data-theme="light"
        />
      </CardContent>
    </Card>
  );
}

/**
 * Stacks the four widgets we ship by default for a given stock. Renders
 * SWOT, Checklist, QVT score and Forecaster in a 2-column grid on
 * medium+ screens, single column on mobile.
 *
 * Use only for actual NSE stocks — the widgets are not defined for
 * indices (NIFTY, BANKNIFTY, etc).
 */
export function TrendlyneInsights({ symbol }: { symbol: string }) {
  useEffect(() => {
    // Re-inject the loader on every (re-)mount so SPA navigation between
    // stocks always processes the freshly-rendered blockquotes.
    const s = document.createElement("script");
    s.src = WIDGET_LOADER_SRC;
    s.async = true;
    s.charset = "utf-8";
    document.body.appendChild(s);
    return () => {
      // Leave the previously-mounted iframes alone — Trendlyne's loader
      // tracks state on its own. We only need to remove our injected tag
      // so the DOM doesn't grow unbounded over many navigations.
      try { document.body.removeChild(s); } catch { /* already gone */ }
    };
  }, [symbol]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <TrendlyneWidget kind="swot" symbol={symbol} />
      <TrendlyneWidget kind="checklist" symbol={symbol} />
      <TrendlyneWidget kind="qvtscore" symbol={symbol} />
      <TrendlyneWidget kind="forecaster" symbol={symbol} />
      <TrendlyneWidget kind="technical" symbol={symbol} />
    </div>
  );
}
