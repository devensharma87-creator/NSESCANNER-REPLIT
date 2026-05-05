import { ShieldAlert } from "lucide-react";

export default function DisclaimerPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 lg:px-6 py-10 space-y-6">
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-amber-400">
          <ShieldAlert className="h-5 w-5" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Disclaimer</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Last updated: 05 May 2026
        </p>
      </header>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-semibold text-foreground">No investment advice</h2>
        <p>
          Hrishi Associates Market Scanner (the "Service") is an educational and
          analytical tool. The information, signals, watchlists, scans, option-chain
          analytics, sector views, FII/DII flows and any other content presented on
          this Service are <strong>not</strong> investment advice, a recommendation to
          buy or sell any security, derivative or other financial instrument, or a
          solicitation to enter into any transaction.
        </p>
        <p>
          Hrishi Associates is <strong>not</strong> a SEBI-registered investment
          adviser or research analyst. Nothing on this Service should be interpreted
          as personalised guidance for your financial situation, objectives or risk
          tolerance.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-semibold text-foreground">Signals are classifications, not instructions</h2>
        <p>
          Labels such as <em>Strong Bullish</em>, <em>Bullish</em>, <em>Bearish</em>,{" "}
          <em>Strong Bearish</em>, <em>Negative Catalyst Watchlist</em> and similar
          wording describe the <strong>state of the underlying indicators</strong> on
          a stock or instrument at the moment of computation. They do <strong>not</strong>{" "}
          mean you should buy, sell, hold or avoid anything. Two reasonable traders
          looking at the same signal may justifiably take opposite decisions.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-semibold text-foreground">Risk of loss</h2>
        <p>
          Trading in equities, futures and options carries substantial risk of loss
          and is not suitable for every investor. Leveraged products such as
          F&amp;O can lose more than the initial capital deployed. Past performance
          of any strategy, signal, indicator or backtest is no guarantee of future
          results.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-semibold text-foreground">Data accuracy</h2>
        <p>
          Market data is sourced from Zerodha Kite Connect (when an authenticated
          broker session is active), TradingView (where licensed by the upstream
          source) and Yahoo Finance / NSE archives as fallbacks. Data may be
          delayed, incomplete or temporarily incorrect due to upstream outages,
          rate-limiting, corporate actions, or processing errors. Always verify
          critical numbers against your broker terminal before placing any trade.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-semibold text-foreground">Your responsibility</h2>
        <p>
          You alone are responsible for your trading and investment decisions. Consult
          a SEBI-registered investment adviser or a qualified financial professional
          before acting on any analysis or content from this Service.
        </p>
      </section>
    </div>
  );
}
