import { useEffect, useRef } from "react";

interface Props {
  /** TradingView symbol, e.g. "NSE:RELIANCE", "NSE:NIFTY", "BSE:SENSEX". */
  symbol: string;
  /** Default interval shown on first load. */
  interval?: "1" | "5" | "15" | "30" | "60" | "240" | "D" | "W" | "M";
  height?: number;
  /** Show full toolbar + indicators (default true). */
  fullFeatured?: boolean;
}

/**
 * Embeds TradingView's free Advanced Chart widget. Fully read-only — works
 * for everyone (no TradingView account needed) and looks exactly like the
 * TradingView site. If the user has a paid TV account they'll see their
 * saved indicators and templates when signed in.
 */
export function TradingViewChart({
  symbol,
  interval = "15",
  height = 520,
  fullFeatured = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;

    // TradingView re-mounts on each script append. Clear previous content.
    host.innerHTML = "";
    const widgetDiv = document.createElement("div");
    widgetDiv.className = "tradingview-widget-container__widget";
    widgetDiv.style.height = "100%";
    widgetDiv.style.width = "100%";
    host.appendChild(widgetDiv);

    const script = document.createElement("script");
    script.type = "text/javascript";
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      timezone: "Asia/Kolkata",
      theme: "dark",
      style: "1",
      locale: "in",
      hide_side_toolbar: !fullFeatured,
      hide_top_toolbar: false,
      withdateranges: true,
      allow_symbol_change: true,
      details: fullFeatured,
      studies: fullFeatured
        ? ["STD;EMA%1Length%209", "STD;EMA%1Length%2021", "STD;RSI", "STD;VWAP"]
        : [],
      support_host: "https://www.tradingview.com",
    });
    host.appendChild(script);

    return () => {
      // Clean up on unmount / symbol change.
      host.innerHTML = "";
    };
  }, [symbol, interval, fullFeatured]);

  return (
    <div className="rounded-md border border-border overflow-hidden bg-card">
      <div
        ref={containerRef}
        className="tradingview-widget-container"
        style={{ height, width: "100%" }}
      />
    </div>
  );
}
