import { BookOpen } from "lucide-react";
import { Seo } from "@/components/seo";

export default function MethodologyPage() {
  return (
    <div className="max-w-3xl mx-auto px-4 lg:px-6 py-10 space-y-6">
      <Seo
        path="/legal/methodology"
        title="Methodology & Data Sources"
        description="How Market Scanner by Dev computes signals, scans and option-chain analytics for the Indian markets, and where the underlying NSE/BSE data comes from. Educational use only."
      />
      <header className="space-y-2">
        <div className="flex items-center gap-2 text-primary">
          <BookOpen className="h-5 w-5" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Methodology &amp; Data Sources</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          How signals are computed and where the underlying numbers come from.
        </p>
      </header>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-semibold text-foreground">Data sources</h2>
        <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
          <li>
            <strong className="text-foreground">Zerodha Kite Connect</strong> — primary
            real-time tick stream and quote API for NSE EQ, NSE F&amp;O, indices and
            option chains. Used whenever a broker session is authenticated.
          </li>
          <li>
            <strong className="text-foreground">TradingView</strong> — used for select
            global indices and currencies where the upstream feed is licensed for
            redistribution. Update freshness shown explicitly per instrument.
          </li>
          <li>
            <strong className="text-foreground">Yahoo Finance</strong> — ~15-minute
            delayed fallback for the cash universe and certain global instruments
            when Kite is unavailable, rate-limited or not subscribed for a segment.
            <strong className="text-foreground"> F&amp;O Top-50 names never accept
            Yahoo data</strong> — they show as "no data" if Kite is down rather
            than risk a stale-quote signal on a leveraged instrument.
          </li>
          <li>
            <strong className="text-foreground">NSE archives</strong> — daily bhavcopy
            (delivery %, volumes), F&amp;O ban list (fo_secban.csv) and FII/DII
            participation reports. Refreshed at the cadence published by NSE.
          </li>
          <li>
            <strong className="text-foreground">NiftyTrader / public archives</strong> — historical
            participant-wise OI used to back-fill 30+ days of context for the
            FII/DII derivatives view.
          </li>
        </ul>
      </section>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-semibold text-foreground">Refresh cadences</h2>
        <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
          <li>Live ticks (Kite WebSocket): real-time when a broker session is active.</li>
          <li>Full NSE scanner sweep: every 60 seconds.</li>
          <li>Indices board / global cues: every 5 seconds.</li>
          <li>Option chain &amp; OI snapshots: every 30 seconds during market hours.</li>
          <li>Bhavcopy (delivery %): once per session, at NSE publish time.</li>
          <li>F&amp;O ban list: every 30 minutes (cached in memory).</li>
          <li>FII/DII: refreshed when NSE publishes the daily report.</li>
        </ul>
      </section>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-semibold text-foreground">Signal computation</h2>
        <p>
          The signal classification (<em>Strong Bullish</em> / <em>Bullish</em> /{" "}
          <em>Neutral</em> / <em>Bearish</em> / <em>Strong Bearish</em>) is a
          weighted aggregation of independent indicator scores. Each indicator
          contributes a numeric vote on a fixed scale; the final classification is
          determined by the signed sum and configurable thresholds.
        </p>
        <p>
          Indicator families currently in use: trend (EMA stack 9/20/50/100/200,
          MACD, ADX), momentum (RSI, ROC), mean-reversion (Bollinger, distance from
          VWAP), breadth (sector A/D, broad-market participation), volume (relative
          volume, delivery %), and derivatives (PCR, OI change %, IV percentile,
          IV rank, max-pain distance).
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-semibold text-foreground">Strategy payoffs</h2>
        <p>
          Option strategy payoffs and EV / probability-of-profit metrics on the
          Strategies page assume: mid-price fills (no slippage modelled beyond what
          your broker quotes), zero brokerage and STT, Black-Scholes-Merton pricing
          for unquoted strikes, and held-to-expiry payoffs. Real-world results will
          differ due to bid/ask spread, IV term-structure, early exit, taxes and
          broker fees. These tools are educational — see the per-strategy assumption
          card for the full caveat list.
        </p>
      </section>

      <section className="space-y-3 text-sm leading-relaxed">
        <h2 className="text-base font-semibold text-foreground">Known limitations</h2>
        <ul className="list-disc list-inside space-y-1.5 text-muted-foreground">
          <li>EMA200 requires ≥ 200 daily bars; newly listed names show "—".</li>
          <li>IV percentile / IV rank build accuracy as the rolling 1-year window fills.</li>
          <li>Kite rate-limits can throttle scans during opening volatility; the system uses exponential backoff (5–30 min) to avoid blacklisting.</li>
          <li>F&amp;O ban list is sourced from NSE; if the NSE archive is unreachable the UI shows "Ban status unavailable" rather than silently defaulting to "no ban".</li>
        </ul>
      </section>
    </div>
  );
}
