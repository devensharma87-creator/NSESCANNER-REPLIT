/**
 * Portfolio Analyser — methodology & disclosures (Phase 2).
 *
 * Plain-language explanation of how every figure is derived and, crucially,
 * what is NOT computed (so nothing on the page can be mistaken for fabricated
 * data or investment advice).
 */
import { useState } from "react";
import { ChevronDown, BookOpen } from "lucide-react";
import { Card } from "@/components/ui/card";
import { LONG_TERM_THRESHOLD_DAYS } from "@/lib/portfolio/holdingPeriod";
import { MARKET_CAP_BUCKETS } from "@/lib/portfolio/allocation";

function Item({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[180px_1fr]">
      <dt className="font-medium text-foreground">{term}</dt>
      <dd className="text-muted-foreground">{children}</dd>
    </div>
  );
}

export function Methodology() {
  const [open, setOpen] = useState(false);
  return (
    <Card className="p-3" data-testid="methodology">
      <button
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen(o => !o)}
        data-testid="methodology-toggle"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <BookOpen className="h-4 w-4" /> Methodology &amp; what is / isn&apos;t computed
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <dl className="mt-3 space-y-2 border-t border-border pt-3 text-xs">
          <Item term="Live price (CMP)">
            Sourced from the existing Kite/Yahoo feed used across the app. When unavailable for a
            symbol it is labelled explicitly — never back-filled or guessed.
          </Item>
          <Item term="Total P&L">
            qty × (CMP − average rate). Computed only for holdings with a live CMP; undated/unpriced
            holdings keep their invested value but are excluded from return figures.
          </Item>
          <Item term="Day P&L">
            qty × (CMP − previous close), summed over holdings with both values available.
          </Item>
          <Item term="Annualised return">
            <strong>XIRR</strong> (Newton-Raphson on dated cash-flows) when every holding has a
            purchase date. If some lack dates it is shown as an{" "}
            <strong>Annualised Return Estimate</strong> over the dated subset; with no dates it reads{" "}
            <strong>XIRR unavailable</strong>. Dividends and partial sells are not modelled in the
            cash-flow series.
          </Item>
          <Item term="Structure score (0–100)">
            A transparent blend of <em>objective</em> signals that were actually available:
            price-vs-50/200-DMA structure, RSI condition, realised-return quality, and concentration.
            Bands: <strong>0–39 weak</strong>, <strong>40–59 mixed</strong>,{" "}
            <strong>60–79 constructive</strong>, <strong>80–100 strong</strong>. Each holding lists
            its contributing reasons and any signals excluded for lack of data. It is analytics, not a
            buy/sell call — fundamentals (P/E etc.) are display-only and never scored.
          </Item>
          <Item term="Concentration (HHI)">
            Herfindahl-Hirschman Index on current-value weights (0–10000). Higher = more
            concentrated. Single-stock and sector concentration flags are factual thresholds, not
            advice.
          </Item>
          <Item term="Weighted beta">
            Current-value-weighted average of per-stock beta, over holdings that actually carry a beta
            value; the coverage % is shown so partial coverage is transparent.
          </Item>
          <Item term="Market-cap buckets">
            Large-cap ≥ ₹{MARKET_CAP_BUCKETS.LARGE_MIN_CR.toLocaleString("en-IN")} cr, Mid-cap ≥ ₹
            {MARKET_CAP_BUCKETS.MID_MIN_CR.toLocaleString("en-IN")} cr, else Small-cap. Shown only when
            market-cap data is available.
          </Item>
          <Item term="Holding period">
            Long-term when held ≥ {LONG_TERM_THRESHOLD_DAYS} days, else short-term; undated holdings
            are bucketed separately. This is a factual classification — <strong>not tax advice</strong>{" "}
            and no tax liability is computed.
          </Item>
          <Item term="Dividends">
            Only the amounts you enter per holding are summed (for yield-on-cost and total-return-incl-
            dividends). Nothing is fetched or estimated.
          </Item>
          <Item term="Benchmark">
            Portfolio-vs-index return is shown only when a benchmark close series is available for the
            window; otherwise it is marked unavailable. Sector over/under-weight vs the index is{" "}
            <strong>not fabricated</strong> — no index sector-weight reference is wired in.
          </Item>
          <Item term="Privacy">
            Saved portfolios are stored per-user (scoped to your account) and are never exposed to
            other users or to public/shared views.
          </Item>
          <Item term="News scope">
            Headlines in the deep-dive are filtered to the selected symbol only and link to the
            original source; they are not portfolio-wide and are not investment recommendations.
          </Item>
        </dl>
      )}
    </Card>
  );
}
