import { useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  GraduationCap,
  BookOpen,
  LineChart,
  Activity,
  Crosshair,
  Layers,
  Shield,
  Brain,
  Landmark,
  Trophy,
  Library,
  Search,
  ExternalLink,
  Youtube,
  PlayCircle,
  ScrollText,
  Sparkles,
  Building2,
  Zap,
  Target,
  Compass,
  Lightbulb,
  TrendingUp,
  ListChecks,
} from "lucide-react";

type ResourceType = "Course" | "Article" | "Book" | "Site" | "Video" | "Doc";

interface VideoLink {
  title: string;
  channel: string;
  url: string;
  note?: string;
}

interface ResourceLink {
  title: string;
  type: ResourceType;
  url?: string;
  by?: string;
  note?: string;
}

interface Concept {
  term: string;
  desc: string;
}

interface Topic {
  id: string;
  number: string;
  title: string;
  oneLiner: string;
  icon: React.ElementType;
  summary: string;
  whyItMatters: string;
  keyConcepts: Concept[];
  videos: VideoLink[];
  resources: ResourceLink[];
  callouts?: { heading: string; body: string }[];
}

const TOPICS: Topic[] = [
  {
    id: "fundamentals",
    number: "01",
    title: "Fundamental Analysis",
    oneLiner: "Decide what a business is worth, then compare to what the market pays.",
    icon: Building2,
    summary:
      "Fundamental analysis values a company by studying its earnings, balance sheet, cash flow, management, industry position, and the macro environment. The output is an estimate of intrinsic value vs current price.",
    whyItMatters:
      "Trading without fundamentals is gambling on chart shapes. Even pure technicians use fundamentals to filter the universe — you don't want to short a company that just printed a record quarter.",
    keyConcepts: [
      { term: "P/E (Price to Earnings)", desc: "Price you pay for ₹1 of annual profit. Compare to sector and historical band." },
      { term: "P/B (Price to Book)", desc: "Price vs net asset value. Useful for banks, NBFCs, and asset-heavy businesses." },
      { term: "ROE & ROCE", desc: "How efficiently a company turns equity / capital into profit. Persistently >15% is strong." },
      { term: "Debt to Equity", desc: "Leverage. High D/E plus falling margins is a classic blow-up setup." },
      { term: "Free Cash Flow", desc: "Cash left after capex. Earnings can be massaged; FCF is harder to fake." },
      { term: "Earnings Growth (CAGR)", desc: "3y / 5y compounded growth in revenue & EPS. Trend matters more than a single quarter." },
      { term: "Promoter Holding & Pledge", desc: "Falling promoter stake or rising pledge is a red flag in Indian small/mid caps." },
      { term: "Moat", desc: "Durable advantage — brand, network effects, switching costs, low-cost production, regulation." },
    ],
    videos: [
      { title: "Fundamental Analysis playlist", channel: "CA Rachana Phadke Ranade", url: "https://www.youtube.com/@CARachanaRanade/playlists", note: "Beginner-friendly Indian stocks." },
      { title: "How to Analyse a Company / Annual Report", channel: "Pranjal Kamra (Finology)", url: "https://www.youtube.com/@pranjalkamra/playlists" },
      { title: "Stock Investing Basics", channel: "Asset Yogi", url: "https://www.youtube.com/@AssetYogi/playlists" },
      { title: "Aswath Damodaran — Valuation", channel: "Aswath Damodaran", url: "https://www.youtube.com/@AswathDamodaranonValuation", note: "NYU professor. Gold standard of valuation." },
    ],
    resources: [
      { title: "Zerodha Varsity — Fundamental Analysis", type: "Course", url: "https://zerodha.com/varsity/module/fundamental-analysis/" },
      { title: "Investopedia — Fundamental Analysis", type: "Article", url: "https://www.investopedia.com/terms/f/fundamentalanalysis.asp" },
      { title: "Screener.in", type: "Site", url: "https://www.screener.in", note: "Free Indian fundamentals screener." },
      { title: "Tijori Finance", type: "Site", url: "https://www.tijorifinance.com", note: "Free segmental & peer data." },
      { title: "The Intelligent Investor", type: "Book", by: "Benjamin Graham", note: "The bible. Read at least Ch. 8 & 20." },
      { title: "One Up On Wall Street", type: "Book", by: "Peter Lynch" },
      { title: "Financial Shenanigans", type: "Book", by: "Howard Schilit", note: "Spot accounting tricks." },
    ],
  },
  {
    id: "technical",
    number: "02",
    title: "Technical Analysis",
    oneLiner: "Read price, volume, and time to forecast probability — not certainty.",
    icon: LineChart,
    summary:
      "Technical analysis assumes price reflects all known information and that history rhymes. You study chart structure, support/resistance, trend, momentum, and volume to find higher-probability entries with defined risk.",
    whyItMatters:
      "Even the best fundamental thesis needs an entry. TA gives you a stop loss before you click buy — without one you have an opinion, not a trade.",
    keyConcepts: [
      { term: "Trend", desc: "Higher highs + higher lows = uptrend. Lower highs + lower lows = downtrend. Trade with it." },
      { term: "Support & Resistance", desc: "Price levels where supply or demand previously turned the market. Multi-touch & multi-timeframe = stronger." },
      { term: "Candlestick Patterns", desc: "Pin bar, engulfing, inside bar, doji. Read intent of buyers vs sellers in one bar." },
      { term: "Chart Patterns", desc: "Head & shoulders, double top/bottom, triangles, flags. Each has a measured move target." },
      { term: "Moving Averages", desc: "20/50/200 EMA. Slope = trend. Price above + rising 200 EMA is the simplest 'long only' filter." },
      { term: "RSI", desc: "0–100 momentum oscillator. Divergences with price often precede reversals." },
      { term: "MACD", desc: "Trend-following momentum. Histogram crossing zero = momentum shift." },
      { term: "Volume", desc: "Confirms moves. Breakouts on low volume usually fail. Climax volume marks exhaustion." },
      { term: "Multi-Timeframe", desc: "Bias on higher TF (daily/weekly). Entry on lower TF (1h/15m). Never the reverse." },
      { term: "Risk:Reward", desc: "Target distance to stop distance. 1.5R minimum; 2R+ preferred." },
    ],
    videos: [
      { title: "Price Action Trading playlist", channel: "Rayner Teo", url: "https://www.youtube.com/@RaynerTeo/playlists", note: "Clean price action. No noise." },
      { title: "Technical Analysis playlist", channel: "The Trading Channel (Nick Bencino)", url: "https://www.youtube.com/@TheTradingChannel/playlists" },
      { title: "Technical Analysis Course", channel: "The Chart Guys", url: "https://www.youtube.com/@TheChartGuys/playlists" },
      { title: "Indian Charting playlist", channel: "Power of Stocks (Subasish Pani)", url: "https://www.youtube.com/@PowerofStocks/playlists" },
      { title: "Trading Basics", channel: "Booming Bulls (Anish Singh Thakur)", url: "https://www.youtube.com/@BoomingBullsAcademy/playlists" },
    ],
    resources: [
      { title: "Zerodha Varsity — Technical Analysis", type: "Course", url: "https://zerodha.com/varsity/module/technical-analysis/" },
      { title: "ChartSchool by StockCharts", type: "Course", url: "https://chartschool.stockcharts.com/" },
      { title: "BabyPips School (TA fundamentals)", type: "Course", url: "https://www.babypips.com/learn/forex" },
      { title: "TradingView Help — Indicators & Strategies", type: "Doc", url: "https://www.tradingview.com/support/categories/education/" },
      { title: "Technical Analysis of the Financial Markets", type: "Book", by: "John J. Murphy", note: "The reference text." },
      { title: "Japanese Candlestick Charting Techniques", type: "Book", by: "Steve Nison" },
      { title: "Trading Price Action Trends", type: "Book", by: "Al Brooks" },
    ],
  },
  {
    id: "order-flow",
    number: "03",
    title: "Order Flow",
    oneLiner: "Watch real buy and sell orders hit the tape — see the trade before it shows on the chart.",
    icon: Activity,
    summary:
      "Order flow is the study of actual transactions happening in the market right now: who is buying at the ask, who is selling at the bid, where large limit orders are stacked, and how they get absorbed or pulled. It is the lowest-level view of price discovery — the chart is just a summary of order flow.",
    whyItMatters:
      "Charts lag reality by minutes. Order flow is reality. Knowing who is in control of a level — buyers absorbing or sellers initiating — is the difference between catching the turn and getting stopped out at the wick.",
    keyConcepts: [
      { term: "Bid / Ask / Spread", desc: "Bid = best buy. Ask = best sell. Spread is the cost of crossing immediately." },
      { term: "DOM (Depth of Market)", desc: "Live ladder showing limit orders stacked on each side. Big resting size = potential wall." },
      { term: "Time & Sales (Tape)", desc: "Every trade printed in real time, color-coded by aggressor. Speed and size tell intent." },
      { term: "Market vs Limit", desc: "Market orders take liquidity (move price). Limit orders provide liquidity (defend price)." },
      { term: "Absorption", desc: "Large size hits a level but price refuses to break — passive side is winning." },
      { term: "Iceberg / Hidden Orders", desc: "Big limit orders shown in small slices to hide intent. Watch repeated refills at one price." },
      { term: "Footprint Chart", desc: "Bar chart that shows traded volume at each price inside a candle (delta = buy minus sell)." },
      { term: "Cumulative Delta", desc: "Running total of aggressive buys minus aggressive sells. Divergences with price flag exhaustion." },
      { term: "Stop Runs / Liquidity Sweeps", desc: "Engineered moves into clusters of stops that fuel the real reversal." },
    ],
    callouts: [
      {
        heading: "How to start reading order flow (free path)",
        body:
          "1) Pick one liquid instrument (NIFTY fut, BANKNIFTY fut, or RELIANCE). 2) Open the Level 2 / DOM in your broker terminal. 3) Watch one key level (PDH, VWAP, opening range high). 4) Note: do aggressive sellers hit the bid and price drops, or does it bounce? Bounce = absorption — bias long. 5) Journal 20 sessions before risking real size.",
      },
    ],
    videos: [
      { title: "Order Flow Trading playlist", channel: "Axia Futures", url: "https://www.youtube.com/@AxiaFutures/playlists", note: "Prop firm. Best free order-flow content on YouTube." },
      { title: "How to Read the Tape", channel: "SMB Capital", url: "https://www.youtube.com/@smbcapital/playlists" },
      { title: "Volume Profile & Order Flow Basics", channel: "Trader Dale", url: "https://www.youtube.com/@TraderDale" },
      { title: "Footprint Chart Explained", channel: "OrderFlowsTrading", url: "https://www.youtube.com/@OrderflowsTrading" },
      { title: "Auction Market Theory", channel: "TraderTV Live", url: "https://www.youtube.com/@TraderTVLIVE" },
    ],
    resources: [
      { title: "Mind Over Markets", type: "Book", by: "James Dalton", note: "Auction market theory — foundation of order flow." },
      { title: "Markets in Profile", type: "Book", by: "James Dalton" },
      { title: "Reading Price Charts Bar by Bar", type: "Book", by: "Al Brooks" },
      { title: "Bookmap (paid, free trial)", type: "Site", url: "https://bookmap.com", note: "Best heatmap visualization of order flow." },
      { title: "Sierra Chart Documentation", type: "Doc", url: "https://www.sierrachart.com/index.php?page=doc/StudiesReference.html" },
    ],
  },
  {
    id: "smc",
    number: "04",
    title: "Smart Money Concept (SMC) / ICT",
    oneLiner: "Trade where institutions trade — find liquidity, then trade the reaction to it.",
    icon: Crosshair,
    summary:
      "Smart Money Concept (popularized by ICT — Inner Circle Trader) treats the market as a game between large institutions ('smart money') and retail. Instead of indicators, you map liquidity pools (where stops sit), order blocks (zones of institutional accumulation), fair value gaps (imbalances), and market structure shifts. You enter after the smart side has shown its hand.",
    whyItMatters:
      "Most retail loses by selling lows and buying highs — exactly where smart money harvests stops. Learning to identify these zones flips the script: you wait for the sweep, then enter with the same side as the institutions.",
    keyConcepts: [
      { term: "Liquidity / Liquidity Pool", desc: "Cluster of stops above swing highs (BSL — buy-side liquidity) or below swing lows (SSL — sell-side liquidity)." },
      { term: "Liquidity Sweep / Stop Hunt", desc: "Quick spike beyond a key level that triggers stops, then immediate reversal." },
      { term: "Order Block (OB)", desc: "Last opposing candle before a strong impulsive move. Often re-tested before continuation." },
      { term: "Fair Value Gap (FVG) / Imbalance", desc: "3-candle pattern where price moved so fast it left a gap. Often filled before trend resumes." },
      { term: "Break of Structure (BOS)", desc: "Price breaks a previous swing high (in uptrend) or low (in downtrend) — confirms trend continuation." },
      { term: "Change of Character (CHoCH)", desc: "First lower-low in an uptrend (or higher-high in a downtrend). Earliest sign of reversal." },
      { term: "Premium vs Discount", desc: "Above 50% of the dealing range = premium (sell zone). Below = discount (buy zone)." },
      { term: "Killzones / Sessions", desc: "London open, NY open — high-volume windows where institutional moves usually happen. India: 9:15–10:30 and 14:00–15:30." },
      { term: "Mitigation Block", desc: "Order block that has been partially tested. Often used as the second entry." },
    ],
    callouts: [
      {
        heading: "Simple SMC trade plan",
        body:
          "1) Mark daily and 4h swing highs/lows = liquidity. 2) Wait for price to sweep one of them. 3) Drop to 5m/15m and look for CHoCH in the opposite direction. 4) Identify the order block / FVG that caused CHoCH. 5) Enter on retracement into that zone with stop above/below the sweep wick. 6) Target opposite liquidity pool. Always 1:2 R:R minimum.",
      },
      {
        heading: "Honest disclaimer",
        body:
          "SMC is a framework, not a guarantee. ICT terminology can feel cult-like — many concepts are repackaged supply/demand and Wyckoff. Use it as a lens, not a religion. Backtest 100+ trades on your instrument before going live.",
      },
    ],
    videos: [
      { title: "ICT Mentorship 2022 (free, full)", channel: "The Inner Circle Trader", url: "https://www.youtube.com/@InnerCircleTrader/playlists", note: "The originator. Long but complete." },
      { title: "Smart Money Concepts playlists", channel: "TradingLab", url: "https://www.youtube.com/@TradingLab/playlists", note: "Cleaner explanations of ICT for beginners." },
      { title: "SMC Simplified", channel: "Patrick Wieland", url: "https://www.youtube.com/@PatrickWieland" },
      { title: "Wyckoff Method", channel: "Wyckoff Analytics", url: "https://www.youtube.com/@WyckoffAnalytics", note: "Foundation that SMC builds on." },
      { title: "Indian SMC on NIFTY / BANKNIFTY", channel: "Power of Stocks", url: "https://www.youtube.com/@PowerofStocks/playlists" },
    ],
    resources: [
      { title: "BabyPips — SMC primer", type: "Article", url: "https://www.babypips.com/learn/forex/smart-money-concepts" },
      { title: "Trades by Matt — SMC notes (free)", type: "Site", url: "https://www.youtube.com/@TradesByMatt" },
      { title: "Wyckoff: The Three Laws", type: "Article", url: "https://chartschool.stockcharts.com/table-of-contents/market-analysis/the-wyckoff-method-a-tutorial" },
      { title: "Trading and Exchanges", type: "Book", by: "Larry Harris", note: "Academic but the best book on market microstructure." },
    ],
  },
  {
    id: "structure",
    number: "05",
    title: "Market Structure & Behaviour",
    oneLiner: "Understand who is on the other side of your trade — and why.",
    icon: Layers,
    summary:
      "Markets are an auction between buyers and sellers, mediated by exchanges, market makers, brokers, and regulators. Price moves because of order imbalance, not news. News is a trigger; flow is the cause.",
    whyItMatters:
      "Once you understand structure, headlines stop scaring you. You see a 2% gap-up not as 'good news' but as 'where are stops, who is offering size into the open, and is volume confirming?'",
    keyConcepts: [
      { term: "Auction Market Theory", desc: "Price moves to find a level where two-sided trade can occur. Trends are one-sided auctions; ranges are balanced." },
      { term: "Volume Profile", desc: "Histogram of volume by price. POC = most-traded price = magnet. HVN = acceptance. LVN = rejection." },
      { term: "VWAP", desc: "Volume-weighted average price intraday. Institutional benchmark — many algos lean against it." },
      { term: "Open Interest (F&O)", desc: "Number of open contracts. Rising OI + rising price = fresh longs. Rising OI + falling price = fresh shorts." },
      { term: "Cash–Future Basis", desc: "Premium/discount of futures over cash. Reflects cost of carry + sentiment." },
      { term: "FII vs DII Flow", desc: "Foreign institutions vs Indian institutions. Persistent FII selling matched by DII buying = sideways grind." },
      { term: "Index vs Constituents", desc: "An index can be flat while breadth collapses underneath. Always check the underlying advance/decline." },
      { term: "Sector Rotation", desc: "Capital moves between sectors with macro cycle (rates, commodities, growth vs value)." },
    ],
    videos: [
      { title: "Market Microstructure (lectures)", channel: "MIT OpenCourseWare", url: "https://www.youtube.com/@mitocw" },
      { title: "Auction Market Theory", channel: "TraderTV Live", url: "https://www.youtube.com/@TraderTVLIVE" },
      { title: "Indian Market Structure", channel: "P R Sundar", url: "https://www.youtube.com/@PRSundarOfficialChannel/playlists" },
      { title: "How NSE Works", channel: "NSE India (official)", url: "https://www.youtube.com/@nseindia" },
    ],
    resources: [
      { title: "Trading and Exchanges", type: "Book", by: "Larry Harris" },
      { title: "Mind Over Markets", type: "Book", by: "James Dalton" },
      { title: "NSE India (official)", type: "Site", url: "https://www.nseindia.com" },
      { title: "SEBI Investor Site", type: "Site", url: "https://investor.sebi.gov.in" },
    ],
  },
  {
    id: "futures",
    number: "06",
    title: "Futures Deep Dive",
    oneLiner: "Linear leverage on a future date. No theta, no Greeks — but still a margin game.",
    icon: TrendingUp,
    summary:
      "A futures contract is a binding agreement to buy or sell an asset at a fixed price on a fixed future date. Unlike options the payoff is linear: a ₹1 move in spot = ₹1 × lot move in P&L. Futures give pure directional leverage with no time decay and no IV math, but demand daily mark-to-market discipline and full margin. Index futures (NIFTY, BANKNIFTY, FINNIFTY) are cash-settled; stock futures in India have been physically settled since Oct 2019.",
    whyItMatters:
      "Most retail jumps straight to options for the cheap premium and ends up fighting Greeks they don't understand. Futures are the cleaner instrument for directional conviction — no IV crush, no theta bleed, P&L scales linearly with the move. Many professional discretionary traders use futures for direction and options only for hedging or premium harvesting.",
    keyConcepts: [
      { term: "Forward vs Future", desc: "Forward = OTC, customised, counterparty risk. Future = exchange-traded, standardised, central counterparty (clearing corp), daily MTM. NSE/BSE list only futures." },
      { term: "Lot Size & Contract Value", desc: "Each future has a fixed lot size. Contract value = price × lot. NIFTY at 24,500 with lot 75 = ₹18.4L per lot, roughly ₹2.0–2.5L margin." },
      { term: "SPAN + Exposure Margin", desc: "SPAN covers worst-case 1-day loss across price/vol scenarios. Exposure adds a 3–5% buffer. Both are blocked at trade entry, freed on exit." },
      { term: "Mark-to-Market (MTM)", desc: "End-of-day P&L is debited or credited daily. Losing positions either get fresh margin from you or are squared off the next day." },
      { term: "Cost of Carry", desc: "F = S × e^(r−d)T. Future = spot × interest cost minus dividend yield over time-to-expiry. This is why front-month NIFTY usually trades at a small premium to spot." },
      { term: "Basis = Future − Spot", desc: "Tracks sentiment + carry. Premium widening = bullish positioning. Discount = bearish or dividend-rich. On expiry day basis must converge to zero." },
      { term: "Contango vs Backwardation", desc: "Contango = far month > near month (normal for indices). Backwardation = far < near (stress, dividend cycle, or supply tightness in commodities)." },
      { term: "Calendar / Spread Trade", desc: "Long one expiry, short another. Pure play on basis & carry. Lower margin than naked thanks to SEBI portfolio margining." },
      { term: "Cash-Future Arbitrage", desc: "Buy spot, short the same-month future when basis is rich. Lock in carry. The bread-and-butter of Indian institutional desks." },
      { term: "Open Interest (OI) Matrix", desc: "Combine OI change with price change. Price↑ + OI↑ = LONG BUILD-UP. Price↑ + OI↓ = SHORT COVERING. Price↓ + OI↑ = SHORT BUILD-UP. Price↓ + OI↓ = LONG UNWINDING. Single most useful F&O signal." },
      { term: "Rollover", desc: "Carrying a position from current expiry to the next: square off near-month, open same side in next. Rollover % > 70% near expiry suggests strong continued conviction." },
      { term: "Physical vs Cash Settlement", desc: "Index futures cash-settled. Stock futures physically settled — you must take or give delivery if held to expiry. Square off stock futures by Wednesday or face delivery margin spikes." },
      { term: "FII / DII Index Futures Net Position", desc: "Daily NSE/SEBI participant data shows institutional positioning. Sustained FII net-long = bullish bias; rising FII net-short = hedging or directional bear." },
      { term: "Stock Futures vs Cash Equity", desc: "5–10x leverage of cash, lower STT footprint than cash delivery (futures STT is on the sell side only at 0.0125%, vs cash delivery 0.1% both sides), no demat needed — but face physical settlement risk and overnight gap exposure." },
      { term: "Currency Futures", desc: "USDINR, EURINR on NSE/BSE. Smaller lot (~$1,000 equiv), regulated by RBI. Useful for hedging international exposure or trading rate cycles." },
      { term: "Commodity Futures (MCX)", desc: "Crude, Gold, Silver, Copper, NatGas. Different timings (until 11:30pm), different contract sizes. Influenced by USD, geopolitics, inventory cycles." },
      { term: "Pair / Ratio Trading", desc: "Long NIFTY / short BANKNIFTY (or vice versa) when ratio extends 2σ from mean. Pure relative-value play, no directional risk." },
      { term: "Liquidity by Expiry", desc: "Front month carries 80–90% of OI. Mid and far months are much thinner — wider spreads and slippage on size." },
    ],
    callouts: [
      {
        heading: "OI + Price interpretation matrix",
        body:
          "LONG BUILD-UP: price ↑, OI ↑, premium ↑ — fresh buyers entering with conviction. SHORT COVERING: price ↑, OI ↓, premium ↑ — bears closing, weakest rally. SHORT BUILD-UP: price ↓, OI ↑, premium ↓ — fresh shorts hammering. LONG UNWINDING: price ↓, OI ↓, premium ↓ — bulls exiting, weakest decline. Build-up trends are stronger than covering moves.",
      },
      {
        heading: "Rollover playbook",
        body:
          "1) Track rollover % daily through expiry week. 2) Compare to the 3-month average (≈70% on NIFTY, ≈75% on BANKNIFTY). 3) Rollover with rising cost (premium ↑) = bullish carry. 4) Rollover with falling cost (discount) = bearish positioning. 5) NEVER carry stock futures into expiry day unless you can take/give delivery — short delivery penalty is brutal.",
      },
      {
        heading: "Margin maths cheat sheet",
        body:
          "Total margin ≈ SPAN + Exposure ≈ 12–18% of contract value for indices, 18–25% for single stocks. Hedged positions (long future + long put, or paired calendar) get up to 70% reduction via SEBI portfolio margining. Always verify margin in your broker terminal BEFORE placing — surprise margin calls cause forced liquidation at the worst price.",
      },
    ],
    videos: [
      { title: "Futures Trading Fundamentals", channel: "Sensibull", url: "https://www.youtube.com/@sensibull/playlists" },
      { title: "Index & Stock Futures (Hindi)", channel: "Pranjal Kamra (Finology)", url: "https://www.youtube.com/@pranjalkamra/playlists" },
      { title: "Open Interest Analysis", channel: "Kunal Saraogi (Equityrush)", url: "https://www.youtube.com/@equityrush" },
      { title: "Futures Spread & Arbitrage", channel: "Trading Q&A by Zerodha", url: "https://www.youtube.com/@zerodhaonline" },
      { title: "Commodity Futures (MCX)", channel: "MCX India", url: "https://www.youtube.com/@MCXIndia" },
      { title: "Futures Market Mechanics", channel: "CME Group", url: "https://www.youtube.com/@CMEGroup", note: "US-focused but pure-mechanics content is universal." },
    ],
    resources: [
      { title: "Zerodha Varsity — Futures Trading", type: "Course", url: "https://zerodha.com/varsity/module/futures-trading/" },
      { title: "NSE F&O Product Specifications", type: "Doc", url: "https://www.nseindia.com/products-services/equity-derivatives-equity" },
      { title: "NSE — Daily Reports (OI, Bhavcopy, Participant)", type: "Doc", url: "https://www.nseindia.com/all-reports" },
      { title: "Hull — Options, Futures and Other Derivatives", type: "Book", by: "John C. Hull", note: "Industry-standard derivatives text. Read chapters 1–6." },
      { title: "Sensibull — Futures Analytics", type: "Site", url: "https://web.sensibull.com" },
      { title: "Quantsapp — F&O / OI Tools", type: "Site", url: "https://web.quantsapp.com" },
      { title: "NSE Margin / SPAN Calculator", type: "Doc", url: "https://www.nseindia.com/products-services/equity-derivatives-margins" },
      { title: "MCX Product Notes (Commodity)", type: "Doc", url: "https://www.mcxindia.com/products" },
    ],
  },
  {
    id: "options",
    number: "07",
    title: "Options & Derivatives — Deep Dive",
    oneLiner: "Asymmetric leverage. Master the Greeks and the volatility surface or get destroyed.",
    icon: Zap,
    summary:
      "Options are contracts giving the right (not obligation) to buy or sell at a strike before/at expiry. They unlock leverage, defined-risk speculation, hedging, and income strategies — but introduce a second dimension (volatility) and a third (time) on top of price. The same OTM call that doubles in a 1-day move can lose 90% of its value in a 0.5% drop in IV. Mastery means treating each option as a basket of Greeks, not a price.",
    whyItMatters:
      "F&O is where most Indian active traders live. SEBI's Jan 2023 study (and the Sep 2024 update) found ~89% of individual F&O traders lost money in FY22, with the average loser down ~₹1.1 lakh. SEBI flagged structural drivers — high turnover, transaction costs, and concentration in expiry-week buying — but did not break loss attribution down to 'ignored Greeks' specifically; that pattern is the consensus view of trading-desk coaches and educators. Either way: learn the math before touching the leverage. It is the cheapest tuition you will ever pay.",
    keyConcepts: [
      { term: "Call vs Put", desc: "Call = right to buy at strike. Put = right to sell at strike. Buyer pays premium and has limited risk. Seller collects premium and takes the risk." },
      { term: "ITM / ATM / OTM", desc: "In/At/Out of the money relative to spot. ITM has intrinsic value; OTM is pure time + IV premium that decays to zero if not breached." },
      { term: "Intrinsic vs Extrinsic Value", desc: "Intrinsic = max(0, S−K) for call, max(0, K−S) for put. Extrinsic = premium − intrinsic = pure time + IV value. Extrinsic decays to zero by expiry." },
      { term: "Delta", desc: "Change in option price per ₹1 move in underlying. Also approximates probability of expiring ITM (0.30 delta ≈ 30% chance ITM under lognormal model)." },
      { term: "Gamma", desc: "Rate of change of delta. Highest near ATM and near expiry — this is what makes 0DTE so wild and what blows up dealers in fast moves." },
      { term: "Theta", desc: "Time decay per day. Buyers pay it, sellers collect it. Non-linear: ~60–70% of weekly option theta arrives in the last 2 days." },
      { term: "Vega", desc: "Sensitivity to a 1-point IV change. Long options are long vega. Highest at ATM and falls off the wings. Long-dated options have much higher vega." },
      { term: "Charm (DδDt)", desc: "Delta decay over time. Why your delta-neutral position drifts overnight. Matters for portfolio gamma management." },
      { term: "Vanna (DδDvol)", desc: "Delta sensitivity to IV change. Why dealers hedge non-linearly when IV moves. Drives 'vanna rallies' after fear spikes." },
      { term: "Volga (DvegaDvol)", desc: "Vol-of-vol exposure. Important for vol traders and exotics desks." },
      { term: "Implied Volatility (IV)", desc: "Market's expectation of future annualised vol baked into the option premium. Compare to realised/historical vol to find rich/cheap options." },
      { term: "IV Rank vs IV Percentile", desc: "Rank = (IV − 52w low) / (52w high − 52w low) × 100. Percentile = % of past 252 days where IV was lower than today. Both useful — percentile is more robust to outliers." },
      { term: "Term Structure of IV", desc: "IV across expiries. Contango (back-month > front) = calm. Backwardation (front > back) = event/fear pricing. Watch around earnings & RBI/Fed meets." },
      { term: "Volatility Skew", desc: "OTM puts are usually pricier than equidistant OTM calls — 'put skew'. Reflects crash insurance demand. Track 25-delta put IV minus 25-delta call IV." },
      { term: "Vol Smile", desc: "U-shape across strikes (both far OTM expensive). Common in FX and commodities; on Indian indices it's mostly skew, not smile." },
      { term: "Vega Crush", desc: "Post-event collapse in IV (results, RBI, budget). Long options can lose 30–50% even if the move is in your direction. The classic earnings-buyer trap." },
      { term: "Implied Move", desc: "ATM straddle premium / spot ≈ 1σ expected move by expiry. If NIFTY straddle = 250 with spot 25,000, market is pricing ±1% by expiry." },
      { term: "Put-Call Parity", desc: "C − P = S − K·e^(−rT). Same-strike call minus put = synthetic forward. Arbitrage if violated. Foundation of synthetics." },
      { term: "Synthetic Positions", desc: "Long call + short put (same K) = synthetic long stock. Long stock + long put = synthetic long call. Useful when one leg is mispriced." },
      { term: "Open Interest (OI)", desc: "Live count of open contracts at each strike. Heavy OI = consensus support/resistance. Combine with OI change for directional read." },
      { term: "Max Pain", desc: "Strike where total option holders (call + put) lose the most. Price often gravitates here on expiry day. Track it but never trade off it alone." },
      { term: "Put-Call Ratio (PCR)", desc: "OI of puts / OI of calls. >1.3 = oversold (contrarian bullish). <0.6 = overbought (contrarian bearish). Volume PCR is more responsive than OI PCR." },
      { term: "Delta as Probability", desc: "Approx probability of expiring ITM. Probability of TOUCHING the strike before expiry ≈ 2× delta. Useful for stop placement on premium selling." },
      { term: "0DTE / Same-Day Expiry", desc: "Gamma explodes. 1% move = 5x option price swing. Avoid as a buyer (theta kills if no move); sell only with strict size + stop rules." },
      { term: "Pin Risk", desc: "On expiry, an option finishing 0.05 ITM/OTM can be auto-exercised or lapse. Indian indices avoid this via cash settlement; stocks do not." },
      { term: "Physical Settlement (Stock Options)", desc: "Post-Oct 2019 SEBI rule: ITM stock options give/take delivery. Square off ITM stock options by Tuesday/Wednesday before Thursday expiry to avoid 5–10% delivery margin block." },
      { term: "Margin Benefit for Hedges", desc: "Naked short option = full SPAN + Exposure margin. Same option hedged with a long option (spread) = up to 80% margin reduction. Big deal for capital efficiency." },
      { term: "IV Crush Around Results", desc: "IV inflates 2–5 days pre-event, collapses 30–50% the morning after. Long premium = trap. Sell calendars or strangles before, close after." },
    ],
    callouts: [
      {
        heading: "9 reasons retail loses in F&O (SEBI 2023 study summary)",
        body:
          "1) Buying weekly OTM options as 'lottery tickets'. 2) Position size too large for account. 3) No stop loss; hoping zero is just another price. 4) Ignoring theta — holding long options into the weekend. 5) Selling naked options without margin headroom. 6) Trading every expiry day for the 'big move'. 7) Doubling down after a loss (revenge). 8) No exit plan for either profit or loss. 9) Confusing IV rank (volatility) with directional bias.",
      },
      {
        heading: "Strike selection cheat sheet",
        body:
          "Directional buyer: ITM/ATM with 30+ days to expiry. Don't fight gamma & theta on weeklies. Premium seller: 15–20 delta short strikes (≈80–85% probability OTM). Spread buyer: long ATM + short ~30 delta = best risk/reward in low IV. Iron condor: ~15 delta wings, ~5–7 days to expiry. Always confirm liquidity (OI > 1,000, bid-ask < 5%).",
      },
      {
        heading: "Buyer or Seller? — when to be each",
        body:
          "BE A BUYER when: IV rank < 30, you expect a fast directional move within days, or before a known catalyst (earnings) with cheap calendar. BE A SELLER when: IV rank > 60, you expect chop or mean reversion, or after a fear spike where IV will revert. NEUTRAL: stick to defined-risk spreads either way.",
      },
      {
        heading: "Earnings / event playbook",
        body:
          "Pre-event (T-3 to T-1): front-month IV rises predictably, often more than back-month. AVOID buying naked options. Strategies that work: long calendar (sell front-month, buy back-month at same strike — you collect front IV crush, keep back vega), short straddle/strangle for the IV crush itself, defined-risk debit spread if directional. Post-event (T+1 morning): close short premium for the IV-crush profit. NEVER hold long premium into a result you cannot predict.",
      },
      {
        heading: "Before you trade your first contract",
        body:
          "1) Read all of Varsity Module 5 + 6 (free). 2) Paper-trade for 30 sessions tracking R-multiples. 3) Never buy weekly OTM as a 'lottery'. 4) Always compute max loss before entry. 5) Have an exit rule for both profit AND loss before you click. 6) Trade 1 lot until 6 consecutive profitable months.",
      },
    ],
    videos: [
      { title: "Options Trading playlist", channel: "P R Sundar", url: "https://www.youtube.com/@PRSundarOfficialChannel/playlists", note: "Veteran Indian options seller, ₹100Cr+ AUM." },
      { title: "Options Strategies playlist", channel: "Sensibull", url: "https://www.youtube.com/@sensibull/playlists" },
      { title: "Options Trading for Beginners", channel: "Project Finance / Project Option", url: "https://www.youtube.com/@projectfinance" },
      { title: "tastylive (formerly tastytrade)", channel: "tastylive", url: "https://www.youtube.com/@tastyliveshow", note: "Premium-selling philosophy. Hours of free content daily." },
      { title: "The Greeks Explained (deep)", channel: "InTheMoney (Adam Khoo)", url: "https://www.youtube.com/@InTheMoneyAdam" },
      { title: "Volatility & IV Skew", channel: "ORATS", url: "https://www.youtube.com/@ORATS" },
      { title: "Options Mechanics", channel: "Option Alpha", url: "https://www.youtube.com/@OptionAlpha" },
      { title: "Indian F&O Market Wraps", channel: "Vivek Bajaj (StockEdge)", url: "https://www.youtube.com/@elearnmarkets" },
    ],
    resources: [
      { title: "Zerodha Varsity — Options Theory", type: "Course", url: "https://zerodha.com/varsity/module/option-theory/" },
      { title: "Zerodha Varsity — Option Strategies", type: "Course", url: "https://zerodha.com/varsity/module/option-strategies/" },
      { title: "Sensibull (free strategy builder)", type: "Site", url: "https://web.sensibull.com" },
      { title: "Opstra Definedge (free tier)", type: "Site", url: "https://opstra.definedge.com" },
      { title: "Quantsapp (OI + IV analytics)", type: "Site", url: "https://web.quantsapp.com" },
      { title: "Options as a Strategic Investment", type: "Book", by: "Lawrence McMillan", note: "Encyclopedia of options. The reference text." },
      { title: "Option Volatility & Pricing", type: "Book", by: "Sheldon Natenberg", note: "The Greeks bible. Chapter 6 (volatility) is essential." },
      { title: "Volatility Trading", type: "Book", by: "Euan Sinclair", note: "Quant-flavoured. For when you're past basics." },
      { title: "Trading Volatility", type: "Book", by: "Colin Bennett", note: "Skew, term structure, dispersion. Free PDF online." },
      { title: "SEBI 2023 F&O study", type: "Doc", url: "https://www.sebi.gov.in/reports-and-statistics/research/jan-2023/study-analysis-of-profit-and-loss-of-individual-traders-dealing-in-equity-fando-segment_67525.html", note: "The infamous '9 of 10 lose' report. Essential reading." },
      { title: "NSE F&O Specifications", type: "Doc", url: "https://www.nseindia.com/products-services/equity-derivatives-equity" },
    ],
  },
  {
    id: "strategies-playbook",
    number: "08",
    title: "Options Strategies Playbook",
    oneLiner: "Every popular strategy in one place — when to use, max risk, IV regime, and adjustment notes.",
    icon: ListChecks,
    summary:
      "Options give you 50+ named strategies, but you only need 8–10 well-understood ones to cover every market view. This playbook organises them by direction (bullish / bearish / neutral) and by IV regime (low IV → buy options, high IV → sell options). Each entry shows the leg structure, payoff shape, ideal market, and the first adjustment you should consider when it goes against you.",
    whyItMatters:
      "Picking the right strategy for the right view + IV regime is half the edge. A bull call spread in low IV is brilliant — the same spread on a high-IV result-day stock is a guaranteed bleed even if you're directionally right. Match the structure to the regime, not to your gut.",
    keyConcepts: [
      { term: "Long Call (Bullish, Low IV)", desc: "Buy 1 call. Max loss = premium. Max profit = unlimited. Use when IV rank <30 and you expect a fast move within days. Avoid as a 'lottery' on weekly OTM." },
      { term: "Long Put (Bearish, Low IV)", desc: "Buy 1 put. Max loss = premium. Max profit = strike − premium. Same rules as long call but for downside. Pay for crash protection while it's cheap." },
      { term: "Bull Call Spread (Bullish, Any IV)", desc: "Buy lower-K call + sell higher-K call. Defined risk, defined reward. Cheaper than naked long call. Best when you expect a move TO a target, not infinity." },
      { term: "Bear Put Spread (Bearish, Any IV)", desc: "Buy higher-K put + sell lower-K put. Mirror of bull call spread. Defined-risk bearish play, works in all IV regimes." },
      { term: "Bull Put Spread (Bullish, High IV)", desc: "Sell higher-K put + buy lower-K put. Net credit. Profits if price stays above short strike. Premium harvesting on a bullish bias." },
      { term: "Bear Call Spread (Bearish, High IV)", desc: "Sell lower-K call + buy higher-K call. Net credit. Profits if price stays below short strike. Mirror of bull put spread." },
      { term: "Long Straddle (Vol Up, Low IV)", desc: "Buy ATM call + buy ATM put (same K, same expiry). Profits on a big move either way. Loses to time decay if price stalls. Pre-event play in cheap IV." },
      { term: "Short Straddle (Vol Down, High IV)", desc: "Sell ATM call + sell ATM put. Max profit at K. Unlimited risk both sides. Theta + vega working for you. Sized small + actively delta-managed." },
      { term: "Long Strangle (Vol Up, Cheap)", desc: "Buy OTM call + buy OTM put. Cheaper than straddle, needs a bigger move to profit. Same idea — long volatility before catalysts." },
      { term: "Short Strangle (Vol Down, Wider Wings)", desc: "Sell OTM call + sell OTM put. Wider profit zone than short straddle, lower premium. Workhorse of premium-selling traders. Manage at 21 DTE." },
      { term: "Iron Condor (Range, High IV)", desc: "Short OTM call spread + short OTM put spread (4 legs). Defined risk both sides. Profits if price stays inside the wings. Textbook neutral strategy." },
      { term: "Iron Butterfly (Pin, High IV)", desc: "Sell ATM call + sell ATM put + buy OTM call + buy OTM put. Tighter than iron condor — higher reward, lower probability. Pin play on expiry day." },
      { term: "Long Butterfly (Pin, Low IV)", desc: "Buy 1 lower call + sell 2 ATM calls + buy 1 higher call. Cheap directional 'pin' play. Profits if price expires at middle strike." },
      { term: "Calendar Spread (Time + Vol)", desc: "Sell front-month + buy back-month, same strike. Profits from front-month theta + back-month vega. Best in low IV expecting expansion." },
      { term: "Diagonal Spread (Direction + Time)", desc: "Sell short-dated OTM + buy longer-dated ITM, different strikes. 'Poor man's covered call'. Lower capital, similar payoff to covered call." },
      { term: "Ratio Spread (1×2)", desc: "Buy 1 ATM + sell 2 OTM (call or put side). Net small credit or zero cost. Profits in tight range, dangerous on big move past short strikes." },
      { term: "Jade Lizard", desc: "Short OTM put + short OTM call spread. No upside risk if width of call spread ≥ credit received. Income strategy in high IV." },
      { term: "Broken-Wing Butterfly", desc: "Asymmetric butterfly with one wing wider than the other. Skews payoff toward your directional bias. Often opened for net credit." },
      { term: "Covered Call (Income)", desc: "Long stock + short OTM call. Generate income on holdings. Cap upside above call strike. Standard income play for long-term holders." },
      { term: "Cash-Secured Put (Income / Entry)", desc: "Sell OTM put with cash to cover assignment. Either pocket the premium or get assigned at a discount. Starting leg of the Wheel strategy." },
      { term: "Protective Put (Hedge)", desc: "Long stock + long OTM put. Floor on losses. Cost = put premium. Pure insurance — not income." },
      { term: "Collar (Income + Hedge)", desc: "Long stock + long OTM put + short OTM call. Net cost ≈ zero. Caps both sides. The sleep-well-at-night structure for portfolios." },
    ],
    callouts: [
      {
        heading: "IV regime → strategy selector",
        body:
          "LOW IV (rank <30): be a buyer. Long calls/puts, debit spreads, long straddles before catalysts, calendars. HIGH IV (rank >70): be a seller. Credit spreads, short straddles/strangles, iron condors, jade lizards. NEUTRAL IV (30–70): mix — directional debit spreads or non-directional iron condors with tight management.",
      },
      {
        heading: "Adjustment 101",
        body:
          "Untested side rolls FORWARD in time or DOWN in strike (puts) / UP (calls) for credit. Tested side: avoid rolling for additional risk — accept the loss or convert to a different structure (e.g., short call → bull put spread). Never roll a loser into a bigger loser. Rule of thumb: take winners at 50% of max profit, take losers at 2× credit received.",
      },
      {
        heading: "What 'works' on Indian weeklies",
        body:
          "Iron condors and short strangles 4–7 days before NIFTY/SENSEX weekly expiry, with delta ≈ 15–20 and ~1× SD wings, deliver consistent positive theta — but require active management on big move days. Avoid selling premium against trending markets (price > 20EMA on 4h with IV rising). Skip expiry-day naked sells — gamma risk is not worth the last ₹50 of theta.",
      },
      {
        heading: "Strategy → market view quick map",
        body:
          "Strong bullish, fast: long call. Mild bullish, range: bull put spread. Strong bearish, fast: long put. Mild bearish, range: bear call spread. Range-bound, high IV: iron condor. Big move expected, direction unknown: long straddle/strangle. Income on holdings: covered call. Buying a stock cheaper: cash-secured put.",
      },
    ],
    videos: [
      { title: "Top 10 Options Strategies", channel: "Project Finance / Project Option", url: "https://www.youtube.com/@projectfinance" },
      { title: "Iron Condor Mastery", channel: "tastylive", url: "https://www.youtube.com/@tastyliveshow" },
      { title: "Indian Strategies (NIFTY/BANKNIFTY)", channel: "Sensibull", url: "https://www.youtube.com/@sensibull/playlists" },
      { title: "Calendar & Diagonal Spreads", channel: "InTheMoney", url: "https://www.youtube.com/@InTheMoneyAdam" },
      { title: "The Wheel Strategy explained", channel: "Markus Heitkoetter", url: "https://www.youtube.com/@RockwellTrading" },
      { title: "Adjustment Mastery", channel: "Option Alpha", url: "https://www.youtube.com/@OptionAlpha" },
    ],
    resources: [
      { title: "Sensibull Strategy Builder (free)", type: "Site", url: "https://web.sensibull.com" },
      { title: "Opstra Strategy Builder (free tier)", type: "Site", url: "https://opstra.definedge.com" },
      { title: "OptionStrat (free, US-listed)", type: "Site", url: "https://optionstrat.com" },
      { title: "Options as a Strategic Investment", type: "Book", by: "Lawrence McMillan", note: "Encyclopedic strategy reference." },
      { title: "The Complete Book of Option Spreads", type: "Book", by: "Scott Nations" },
      { title: "Options Volatility & Pricing", type: "Book", by: "Sheldon Natenberg", note: "Strategy + Greeks together." },
      { title: "tastylive Research", type: "Doc", url: "https://www.tastylive.com/concepts-strategies", note: "Free strategy decision frameworks." },
    ],
  },
  {
    id: "risk",
    number: "09",
    title: "Risk Management & Position Sizing",
    oneLiner: "Survive first. Win later.",
    icon: Shield,
    summary:
      "Risk management decides how much you lose when you are wrong. Position sizing decides how much you make when you are right. Get either wrong and edge does not matter — you blow up before the math plays out.",
    whyItMatters:
      "A 50% drawdown requires a 100% gain to break even. Most traders never recover from one. You can be right 70% of the time and still lose money if your risk is uncapped.",
    keyConcepts: [
      { term: "Risk per Trade (R)", desc: "Fixed % of capital you accept losing on a single idea. Industry norm: 0.5% – 1.5%. Never above 2%." },
      { term: "Stop Loss", desc: "Pre-defined exit on adverse move. Place by structure (below swing low) — not by P&L pain." },
      { term: "Position Size", desc: "= (Capital × Risk %) / (Entry − Stop). Math, not feeling, sets size." },
      { term: "R-Multiple Tracking", desc: "Express every trade outcome as multiples of initial risk. Goal: average +R > 0 over 50+ trades." },
      { term: "Max Daily / Weekly Loss", desc: "Hard kill switch. Hit 3R loss in a day → you walk. No exceptions." },
      { term: "Correlation", desc: "Five long bank trades are not five trades — they are one bet on banks. Cap correlated exposure." },
      { term: "Drawdown", desc: "Peak-to-trough decline. Expect 2× your worst losing streak. Plan for it psychologically." },
      { term: "Kelly Criterion", desc: "Mathematically optimal sizing given edge & odds. Use half-Kelly or quarter-Kelly in practice." },
    ],
    videos: [
      { title: "Risk Management playlist", channel: "Rayner Teo", url: "https://www.youtube.com/@RaynerTeo/playlists" },
      { title: "Position Sizing", channel: "Adam Khoo", url: "https://www.youtube.com/@AdamKhooSuccess" },
      { title: "Risk of Ruin", channel: "TastyLive", url: "https://www.youtube.com/@tastyliveshow" },
    ],
    resources: [
      { title: "Trade Your Way to Financial Freedom", type: "Book", by: "Van Tharp", note: "Definitive position sizing book." },
      { title: "The New Trading for a Living", type: "Book", by: "Alexander Elder" },
      { title: "Varsity — Trading Psychology & Risk", type: "Course", url: "https://zerodha.com/varsity/module/trading-psychology/" },
    ],
  },
  {
    id: "psychology",
    number: "10",
    title: "Trading Psychology — Deep Dive",
    oneLiner: "Your edge is real. Your discipline is what executes it. Master the inner game or watch the outer one collapse.",
    icon: Brain,
    summary:
      "Trading is a performance discipline more than an analytical one. Knowledge of strategy is necessary but never sufficient — fear, greed, FOMO, revenge trading, overconfidence, hindsight bias, and tilt destroy more accounts than bad analysis ever does. Building psychological process — pre-defined rules, daily routines, journaling, tilt protocols, and a probabilistic mindset — is as important as building a chart setup. The goal: become a process-driven operator instead of an outcome-chasing gambler.",
    whyItMatters:
      "Two traders given the exact same system will produce wildly different P&Ls. The one who follows the rules through a 10-trade losing streak compounds. The one who whispers 'just this once' on every loser blows up — usually within a year. Mark Douglas's research, Brett Steenbarger's coaching, and Jared Tendler's mental-game work all converge on one truth: the trader is the system.",
    keyConcepts: [
      { term: "Probabilistic Mindset", desc: "Each trade is one sample from a distribution. Outcome ≠ decision quality. A profitable bad trade is still bad; a losing good trade is still good. Judge yourself on process, not on any single result." },
      { term: "Mark Douglas's 5 Truths", desc: "1) Anything can happen. 2) You don't need to know what's next. 3) Wins and losses are randomly distributed across an edge. 4) An edge is a higher probability — never certainty. 5) Every moment in the market is unique. Tape these to your monitor." },
      { term: "7 Principles of Consistency", desc: "Mark Douglas's framework: I objectively identify edges. I pre-define risk on every trade. I completely accept the risk. I act on edges without hesitation. I pay myself when targets are hit. I monitor for self-sabotage. I follow the rules." },
      { term: "Process vs Outcome Scoring", desc: "Two scoreboards. Process: 'Did I follow my rules today? Yes/No' — that is the win. Outcome: P&L — long-run consequence of the process. Most traders track only outcome and quit during normal variance." },
      { term: "FOMO (Fear Of Missing Out)", desc: "Chasing a move because 'it's already running'. The cure: pre-defined entry zones. No zone = no trade. Print this rule." },
      { term: "Revenge Trading", desc: "Doubling size after a loss to 'win it back'. The single fastest path to ruin. Hard rule: walk away after 2 consecutive losses, no exceptions." },
      { term: "Confirmation Bias", desc: "Reading only news/charts that support your position. Antidote: write the bear case for every long (and vice versa) BEFORE entering." },
      { term: "Anchoring", desc: "Refusing to sell because 'I bought at 200'. The market does not care what you paid. Your stop is structural, not emotional." },
      { term: "Recency Bias", desc: "Last 3 winners feel like skill. Last 3 losers feel like the system is broken. Both are noise. Trust the 100-trade sample, not the last 3." },
      { term: "Loss Aversion (Kahneman)", desc: "Pain of a loss feels ~2× the pleasure of an equivalent gain. Drives premature profit-taking on winners and held-too-long losers. Awareness alone helps." },
      { term: "Sunk Cost Fallacy", desc: "'I've held it this long, can't sell now.' Capital is fungible — past decisions don't bind present action. Ask: would I open this position right now? If no, close it." },
      { term: "Overconfidence Bias", desc: "Hot streak feels like skill. Position size goes up; drawdown follows. Rule: size up only after 6 consecutive profitable months — never on a single hot streak." },
      { term: "Hindsight Bias", desc: "Post-mortem feels obvious in retrospect. The chart was not obvious in real time. Don't beat yourself up over 'should have caught that' moves you couldn't have." },
      { term: "Survivorship Bias", desc: "Twitter/YouTube shows only winners. The 90% who blew up don't post. Calibrate expectations against full population, not the loud minority." },
      { term: "Gambler's Fallacy / Hot Hand", desc: "'Three reds in a row, must be black next.' Trades are independent. Each setup stands alone — no streak owes you a winner." },
      { term: "Outcome Bias", desc: "Judging a decision by its result. A profitable bad trade is still a bad trade. Reward the decision quality, not the lucky outcome." },
      { term: "Tilt (Jared Tendler model)", desc: "Performance breakdown after a trigger. Seven types: revenge, hate-losing, mistake, entitlement, injustice, slowed-thinking, desperate. Recognize → label → reset BEFORE the next trade." },
      { term: "Self-Sabotage", desc: "Hitting profit target then giving it all back. Often a self-image conflict: 'I don't deserve this win.' Track its frequency in your journal — it's almost always a pattern." },
      { term: "Ego vs Account", desc: "Ego wants to be RIGHT. Account wants to make MONEY. They are different goals. The market pays only the second one." },
      { term: "Acceptance — the four things", desc: "Accept loss is part of the game. Accept you cannot predict. Accept the market doesn't know you exist. Accept being right ≠ being profitable. Resistance to any of these is where pain lives." },
      { term: "Reaction over Prediction", desc: "Pros react to setups, they don't predict them. The setup either prints or it doesn't — your job is to be ready, not psychic." },
      { term: "Risk of Ruin (psychological)", desc: "Even with a real edge, big size + variance = blow-up. Psychology says size right; math agrees. Never bet the farm on conviction — conviction is just a feeling." },
      { term: "Visualization & Mental Rehearsal", desc: "Pre-rehearse the worst-case (a 3R loss day, a flash crash). When it happens you execute the plan instead of freezing. Athletes do this — traders should too." },
      { term: "Body & Brain Maintenance", desc: "Sleep <6h ≈ trader IQ drops 20%. Caffeine + adrenaline = revenge entries. Treat trading like an athletic event — your nervous system is the asset." },
      { term: "Screen Fatigue", desc: "90-minute focus blocks max. Walk away every 2h. Fresh eyes catch what tired eyes miss — and tired eyes invent setups that aren't there." },
      { term: "Daily Routine", desc: "Pre-market plan → trade window → post-market journal → off. No 'checking charts' after the close. Decision fatigue is real and cumulative." },
      { term: "21-Day Reset Rule", desc: "After a >10% drawdown, halve size for 21 days. Restore size only when rules are followed perfectly. Rebuild trust with yourself before rebuilding size." },
      { term: "A/B/C Trade Grading", desc: "A = perfect setup, full size. B = OK setup, half size. C = no real setup → NO TRADE. Most retail trade C all day and wonder why P&L bleeds." },
      { term: "Identity-Based Discipline", desc: "Don't say 'I'm trying to be disciplined'. Say 'I am a disciplined trader who follows rules'. Identity drives behaviour more reliably than willpower." },
      { term: "Detachment from Money", desc: "On the screen, ₹10,000 P&L is a number. The moment you think 'that's a week's groceries' your stop will move. Trade in R-multiples, not rupees, during the session." },
    ],
    callouts: [
      {
        heading: "Five things to repeat daily (Mark Douglas's 5 Truths)",
        body:
          "Tape these to your monitor and read aloud before market open. 1) Anything can happen. 2) I don't need to know what's next to make money. 3) Wins and losses are randomly distributed across an edge. 4) An edge is just a higher probability of one outcome over another. 5) Every moment in the market is unique. Repetition rewires the response. This is the cheapest psychology training you will ever get.",
      },
      {
        heading: "Daily psychological checklist (pre-market)",
        body:
          "1) Slept >6h. 2) No personal stress carryover (fight, illness, financial pressure). 3) Reviewed yesterday's journal. 4) Have a written watchlist + plan for today. 5) Risk for the day is capped (e.g., 2R max loss). 6) Phone on do-not-disturb. If ANY answer is no, paper-trade only today. Forcing real money on a bad day is how a slump becomes a blow-up.",
      },
      {
        heading: "End-of-day journal template",
        body:
          "For every trade, capture: setup name + chart screenshot, entry/stop/target, reason in one sentence, outcome in R-multiples, did I follow the plan? (Y/N), emotional state during (calm/anxious/euphoric), one-sentence lesson. Review weekly: count rule violations, count A/B/C grade trades, look for repeating patterns. The journal IS the scorecard — P&L is just the side-effect.",
      },
      {
        heading: "Tilt protocol — what to do after a big loss",
        body:
          "1) Close the platform immediately. 2) Walk 15 minutes away from screens (no phone). 3) Write down what triggered the loss + which rule was broken (one paragraph). 4) No new trade for the rest of the day, no exceptions. 5) Tomorrow: paper-trade only, full session. 6) Day after: real trade at HALF size. 7) Resume normal size only when 5 consecutive trades follow rules perfectly. Rebuild trust before rebuilding size.",
      },
      {
        heading: "Drawdown survival kit",
        body:
          "Expect 2× your worst losing streak. A system with 50% hit rate WILL deliver 8-trade losing streaks — that's just probability. Plan for 6-month drawdowns mentally and financially. Keep 6 months of living expenses OUTSIDE trading capital. Traders who survive are the ones who can pay rent through the bad month. Money problems destroy decision quality faster than any bad strategy.",
      },
      {
        heading: "The 4-question pre-trade gate",
        body:
          "Before clicking buy, answer in your head (or aloud): 1) Is this an A, B, or C setup? 2) What is my exact stop? 3) What is my exact target (or trail rule)? 4) If this loses, am I OK with this size? If you can't answer all four in 5 seconds, the trade is not ready. Skip it.",
      },
    ],
    videos: [
      { title: "Trader Psychology playlist", channel: "SMB Capital", url: "https://www.youtube.com/@smbcapital/playlists", note: "Hosts regular Brett Steenbarger sessions." },
      { title: "Mind of a Trader (live + theory)", channel: "Tom Hougaard", url: "https://www.youtube.com/@TraderTomHougaard", note: "Best Mark Douglas interpretation on YouTube." },
      { title: "Mental Game of Trading", channel: "Jared Tendler", url: "https://www.youtube.com/@JaredTendler", note: "Tilt protocols and the inner game." },
      { title: "Chat With Traders — psychology episodes", channel: "Chat With Traders", url: "https://www.youtube.com/@ChatWithTraders/videos", note: "Long-form interviews. Many feature Brett Steenbarger, Mark Minervini, others." },
      { title: "How To Trade — mindset playlists", channel: "Trading Coach UK (Akil Stokes)", url: "https://www.youtube.com/@TradeEmpowered/playlists" },
      { title: "Atomic Habits — for traders", channel: "James Clear", url: "https://www.youtube.com/@JamesClearAuthor" },
      { title: "Daily Mind Routine for Traders", channel: "InTheMoney (Adam)", url: "https://www.youtube.com/@InTheMoneyAdam" },
      { title: "Indian trader interviews — psychology", channel: "Vivek Bajaj (StockEdge)", url: "https://www.youtube.com/@elearnmarkets" },
    ],
    resources: [
      { title: "Trading in the Zone", type: "Book", by: "Mark Douglas", note: "The single most-recommended trading psychology book. Read it twice." },
      { title: "The Disciplined Trader", type: "Book", by: "Mark Douglas", note: "Companion to 'Zone'. Older but foundational." },
      { title: "The Daily Trading Coach", type: "Book", by: "Brett Steenbarger", note: "101 lessons in self-coaching. One per day for 101 days." },
      { title: "The Mental Game of Trading", type: "Book", by: "Jared Tendler", note: "Tilt frameworks transferred from poker. Actionable." },
      { title: "Thinking, Fast and Slow", type: "Book", by: "Daniel Kahneman", note: "Cognitive biases — apply directly to trading decisions." },
      { title: "The Inner Game of Tennis", type: "Book", by: "W. Timothy Gallwey", note: "Pioneering performance psychology. Trading = performance sport." },
      { title: "Atomic Habits", type: "Book", by: "James Clear", note: "Habit formation = trading routine formation." },
      { title: "Discipline Equals Freedom", type: "Book", by: "Jocko Willink", note: "Identity-based discipline. Brutal and effective." },
      { title: "Peak Performance", type: "Book", by: "Brad Stulberg", note: "Stress + recovery cycle for sustainable performance." },
      { title: "Psycho-Cybernetics", type: "Book", by: "Maxwell Maltz", note: "Foundational self-image psychology. Older but timeless." },
      { title: "Reminiscences of a Stock Operator", type: "Book", by: "Edwin Lefèvre", note: "Jesse Livermore. Every page is psychology." },
      { title: "TraderFeed (Brett Steenbarger blog)", type: "Site", url: "https://traderfeed.blogspot.com", note: "20+ years of trading psychology essays. Free." },
      { title: "Edgewonk (paid journal)", type: "Site", url: "https://edgewonk.com" },
      { title: "TraderSync (free tier journal)", type: "Site", url: "https://tradersync.com" },
      { title: "Zerodha Varsity — Trading Psychology", type: "Course", url: "https://zerodha.com/varsity/module/trading-psychology/" },
    ],
  },
  {
    id: "indian-market",
    number: "11",
    title: "Indian Market Specifics",
    oneLiner: "NSE, BSE, SEBI, STT, F&O lot sizes, expiry schedules — know the rules of the game you're playing.",
    icon: Landmark,
    summary:
      "Trading the Indian market means understanding NSE & BSE structure, SEBI regulations, the cash–F&O segment split, settlement (T+1), STT/CTT, peak margin rules, and the unique lot-size / weekly expiry calendar of NIFTY, BANKNIFTY, FINNIFTY, MIDCPNIFTY, and SENSEX.",
    whyItMatters:
      "Strategies that work in the US may be illegal, taxed differently, or impossible in India (e.g. naked short selling cash, intraday lower margins post-Sep 2021, weekly index expiry consolidation). Always trade the rules of your jurisdiction.",
    keyConcepts: [
      { term: "Exchanges", desc: "NSE (dominant equity + F&O), BSE (older, SENSEX index, growing F&O share)." },
      { term: "Regulator", desc: "SEBI sets rules. AMFI for mutual funds. RBI for currency derivatives." },
      { term: "Settlement", desc: "T+1 for equities (since 2023). T+0 pilot live for select stocks." },
      { term: "Margin Rules", desc: "Peak margin (post-Sep 2021): no upfront margin reporting via broker leverage. SPAN + Exposure for F&O." },
      { term: "Lot Sizes (current)", desc: "NIFTY 75 (post Dec 2024), BANKNIFTY 30, FINNIFTY 65, MIDCPNIFTY 140, SENSEX 20. Verify on NSE/BSE site — they revise periodically." },
      { term: "Weekly Expiry", desc: "Post-Nov 2024 SEBI consolidation: each exchange has ONE weekly expiry. NSE = NIFTY (Thu). BSE = SENSEX (Tue). All other indices monthly only." },
      { term: "STT / CTT", desc: "Securities Transaction Tax. Higher on options sell-side; flat on equity. Material at high turnover." },
      { term: "Circuit Limits", desc: "Stocks have 2/5/10/20% daily price bands. Index circuits at 10/15/20% halt the market." },
      { term: "MWPL & Ban Period", desc: "Stock crosses 95% of market-wide position limit → enters F&O ban. No fresh positions allowed." },
      { term: "BTST / STBT", desc: "Buy/Sell Today, Sell/Buy Tomorrow. Watch out — short delivery penalties are steep." },
    ],
    videos: [
      { title: "How NSE Works", channel: "NSE India (official)", url: "https://www.youtube.com/@nseindia" },
      { title: "BSE Investor Education", channel: "BSE India (official)", url: "https://www.youtube.com/@bsedotindia" },
      { title: "SEBI Investor Education", channel: "SEBI Official", url: "https://www.youtube.com/@SEBI_India" },
      { title: "Indian F&O Market Explained", channel: "Sensibull", url: "https://www.youtube.com/@sensibull/playlists" },
      { title: "Taxation for Traders", channel: "Quicko / Zerodha", url: "https://www.youtube.com/@zerodhaonline" },
    ],
    resources: [
      { title: "Zerodha Varsity (full curriculum)", type: "Course", url: "https://zerodha.com/varsity/" },
      { title: "NSE India (official)", type: "Site", url: "https://www.nseindia.com" },
      { title: "BSE India (official)", type: "Site", url: "https://www.bseindia.com" },
      { title: "NISM (certification + study material)", type: "Site", url: "https://www.nism.ac.in" },
      { title: "SEBI Investor Site", type: "Site", url: "https://investor.sebi.gov.in" },
      { title: "Quicko — Trader Taxation Guide", type: "Article", url: "https://learn.quicko.com/taxation-on-trading-and-investing" },
      { title: "NSE F&O Lot Sizes (live)", type: "Doc", url: "https://www.nseindia.com/products-services/equity-derivatives-list-underlyings-information" },
    ],
  },
  {
    id: "pro-path",
    number: "12",
    title: "Path to Becoming a Pro Analyst",
    oneLiner: "Education + screen time + capital discipline + journaling. There is no shortcut.",
    icon: Trophy,
    summary:
      "A professional market analyst combines deep domain knowledge (fundamentals + technicals + macro), real screen experience, repeatable process, risk discipline, and continuous learning. Most professionals took 3–7 years to become consistently profitable. Plan accordingly.",
    whyItMatters:
      "Setting a realistic timeline prevents the two biggest killers: quitting too soon, and over-sizing too soon. Treat year 1 as tuition, year 2 as apprentice, year 3+ as practitioner.",
    keyConcepts: [
      { term: "Foundations (months 0–6)", desc: "Read Varsity end-to-end. Open paper-trading account. Journal every demo trade. Read 2 books from each section above." },
      { term: "Specialise (months 6–18)", desc: "Pick ONE style: positional swing, intraday momentum, options selling, or pair trading. Master one before adding a second." },
      { term: "Backtest & Forward Test (months 12–24)", desc: "100+ trades on paper or with 1-lot. Compute hit rate, avg R, max drawdown. Strategy must be profitable before scaling." },
      { term: "Go Live Small (months 18–36)", desc: "Trade real capital at 0.25% risk per trade. Keep day job income. Goal: prove edge survives execution + tax + slippage." },
      { term: "Scale (months 36+)", desc: "Increase size only when 6 consecutive profitable months + journal proves discipline. Never scale on a hot streak alone." },
      { term: "Certifications (optional but valuable)", desc: "NISM Series VIII (Equity Derivatives), Series XV (Research Analyst), CFA (global), CMT (technical)." },
      { term: "Daily Routine", desc: "Pre-market 30 min: GIFT Nifty (formerly SGX Nifty), global cues, news, FII/DII data. Post-market 30 min: journal trades, review setups, mark levels for tomorrow." },
      { term: "Tools Stack", desc: "Charting (TradingView), screener (Screener.in / Chartink), broker terminal, journal (TraderSync / Excel), notes (Notion / Obsidian)." },
    ],
    callouts: [
      {
        heading: "30-day starter plan",
        body:
          "Week 1 — Read Varsity Module 1 (Intro) + Module 2 (TA basics). Open free TradingView + Screener.in. Week 2 — Module 3 (FA) + Module 4 (Futures). Pick 5 stocks to follow daily. Week 3 — Module 5 (Options Theory). Begin paper-trading 1 setup only. Week 4 — Module 6 (Strategies) + Module 9 (Risk & Psychology). Journal 20 paper trades. By day 30 you will know what you don't know — that is the actual goal.",
      },
    ],
    videos: [
      { title: "Path to Pro Trader", channel: "SMB Capital", url: "https://www.youtube.com/@smbcapital/playlists" },
      { title: "Build Your Trading Routine", channel: "Rayner Teo", url: "https://www.youtube.com/@RaynerTeo/playlists" },
      { title: "Full-Time Trader interviews", channel: "Etienne Crete (Desire To Trade)", url: "https://www.youtube.com/@desiretotradeFX" },
    ],
    resources: [
      { title: "NISM Certifications", type: "Site", url: "https://www.nism.ac.in" },
      { title: "CFA Institute", type: "Site", url: "https://www.cfainstitute.org" },
      { title: "CMT Association", type: "Site", url: "https://cmtassociation.org" },
      { title: "Market Wizards (series)", type: "Book", by: "Jack Schwager", note: "Interviews with the greats. Read all 4." },
      { title: "Reminiscences of a Stock Operator", type: "Book", by: "Edwin Lefèvre", note: "Fictionalised Jesse Livermore. Timeless." },
      { title: "Pit Bull", type: "Book", by: "Marty Schwartz" },
      { title: "How to Make Money in Stocks", type: "Book", by: "William O'Neil", note: "CAN SLIM method." },
      { title: "SMB Capital — full trader talks", type: "Video", url: "https://www.youtube.com/@smbcapital/videos", note: "Hours of free interviews with prop traders." },
    ],
  },
  {
    id: "free-stack",
    number: "13",
    title: "Free Resource Stack (Bookmark This)",
    oneLiner: "Everything you actually need is free. Start here.",
    icon: Library,
    summary:
      "You do not need a paid course to learn trading. The resources below are free, reputable, and cover every topic above in depth. Start with Varsity, supplement with the books you keep seeing referenced, and watch one channel consistently rather than flipping between ten.",
    whyItMatters:
      "Most paid courses repackage what is on this list. Save the money — put it in your trading account once you have an edge.",
    keyConcepts: [],
    videos: [],
    resources: [
      { title: "Zerodha Varsity (free, full curriculum)", type: "Course", url: "https://zerodha.com/varsity/" },
      { title: "Investopedia (definitions + articles)", type: "Site", url: "https://www.investopedia.com" },
      { title: "Khan Academy — Finance & Capital Markets", type: "Course", url: "https://www.khanacademy.org/economics-finance-domain/core-finance" },
      { title: "BabyPips School", type: "Course", url: "https://www.babypips.com/learn/forex" },
      { title: "ChartSchool by StockCharts", type: "Course", url: "https://chartschool.stockcharts.com/" },
      { title: "TradingView Education", type: "Doc", url: "https://www.tradingview.com/support/categories/education/" },
      { title: "NSE India (official)", type: "Site", url: "https://www.nseindia.com" },
      { title: "BSE India (official)", type: "Site", url: "https://www.bseindia.com" },
      { title: "SEBI Investor Site", type: "Site", url: "https://investor.sebi.gov.in" },
      { title: "Screener.in (Indian fundamentals)", type: "Site", url: "https://www.screener.in" },
      { title: "Tijori Finance", type: "Site", url: "https://www.tijorifinance.com" },
      { title: "Sensibull (options analytics)", type: "Site", url: "https://web.sensibull.com" },
      { title: "Opstra (free tier)", type: "Site", url: "https://opstra.definedge.com" },
      { title: "Trendlyne", type: "Site", url: "https://trendlyne.com" },
      { title: "Quicko (taxation)", type: "Site", url: "https://learn.quicko.com" },
    ],
  },
];

const TYPE_CLASS: Record<ResourceType, string> = {
  Course: "text-signal-strong-buy border-signal-strong-buy/40 bg-signal-strong-buy/10",
  Article: "text-primary border-primary/40 bg-primary/10",
  Book: "text-foreground border-foreground/30 bg-foreground/[0.06]",
  Site: "text-signal-buy border-signal-buy/40 bg-signal-buy/10",
  Video: "text-signal-strong-sell border-signal-strong-sell/40 bg-signal-strong-sell/10",
  Doc: "text-muted-foreground border-border bg-secondary/40",
};

export default function LearnPage() {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TOPICS;
    return TOPICS.filter((t) => {
      const hay = [
        t.title,
        t.oneLiner,
        t.summary,
        t.whyItMatters,
        ...t.keyConcepts.map((k) => `${k.term} ${k.desc}`),
        ...(t.callouts ?? []).map((c) => `${c.heading} ${c.body}`),
        ...t.videos.map((v) => `${v.title} ${v.channel} ${v.note ?? ""}`),
        ...t.resources.map((r) => `${r.title} ${r.by ?? ""} ${r.note ?? ""}`),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [query]);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - 110;
      window.scrollTo({ top, behavior: "smooth" });
    }
  };

  return (
    <div className="w-full px-4 py-6">
      {/* Header */}
      <div className="border-b border-border pb-5 mb-6">
        <div className="flex items-center gap-3 mb-2">
          <GraduationCap className="h-6 w-6 text-primary" />
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight font-mono uppercase">Learn</h1>
          <Badge variant="outline" className="font-mono text-[10px] uppercase tracking-wider">
            Curated · Free · Practical
          </Badge>
        </div>
        <p className="text-sm md:text-[15px] text-muted-foreground max-w-3xl leading-relaxed">
          Everything you need to study markets seriously — fundamentals, technicals, order flow, smart money concepts,
          options, risk, psychology, Indian-market specifics, and a step-by-step path from beginner to professional. All
          resources below are free.
        </p>
        <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-mono">
          <Badge variant="outline" className="border-border bg-secondary/40">
            <BookOpen className="h-3 w-3 mr-1" /> {TOPICS.length} topics
          </Badge>
          <Badge variant="outline" className="border-border bg-secondary/40">
            <PlayCircle className="h-3 w-3 mr-1" /> {TOPICS.reduce((n, t) => n + t.videos.length, 0)} video sources
          </Badge>
          <Badge variant="outline" className="border-border bg-secondary/40">
            <Library className="h-3 w-3 mr-1" /> {TOPICS.reduce((n, t) => n + t.resources.length, 0)} resources
          </Badge>
          <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
            Educational only — not financial advice
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)] gap-6">
        {/* TOC sidebar */}
        <aside className="hidden lg:block">
          <div className="sticky top-[120px]">
            <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-2 px-2">
              Contents
            </div>
            <nav className="flex flex-col gap-0.5">
              {TOPICS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => scrollTo(t.id)}
                  className="group text-left text-[12.5px] font-mono px-2 py-1.5 rounded hover-row text-foreground/70 hover:text-foreground flex items-center gap-2"
                >
                  <span className="text-muted-foreground/60 tabular-nums">{t.number}</span>
                  <span className="truncate">{t.title}</span>
                </button>
              ))}
            </nav>
            <div className="mt-4 pt-4 border-t border-border px-2">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground font-mono">
                <Compass className="h-3 w-3" />
                Tap any section to jump
              </div>
            </div>
          </div>
        </aside>

        {/* Main */}
        <div className="min-w-0">
          {/* Search */}
          <div className="relative mb-6">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search topics, terms, books, channels…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 bg-background border-border h-10"
            />
          </div>

          {filtered.length === 0 && (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground font-mono">
                No matches. Try fewer keywords.
              </CardContent>
            </Card>
          )}

          <div className="flex flex-col gap-6">
            {filtered.map((t) => (
              <TopicSection key={t.id} topic={t} />
            ))}
          </div>

          {/* Footer note */}
          <div className="mt-10 border border-border rounded-md bg-card p-5">
            <div className="flex items-center gap-2 mb-2">
              <Lightbulb className="h-4 w-4 text-primary" />
              <h3 className="font-mono text-sm uppercase tracking-wider">Final note</h3>
            </div>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Information is not skill. Reading every link above without screen time and journaling will not make you a
              trader. Pick one topic, one channel, one book — and stay there for 60 days before moving on. Slow is fast.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function TopicSection({ topic }: { topic: Topic }) {
  const Icon = topic.icon;
  return (
    <section
      id={topic.id}
      className="border border-border rounded-md bg-card overflow-hidden scroll-mt-28"
    >
      {/* Header */}
      <div className="border-b border-border p-5 bg-secondary/20">
        <div className="flex items-start gap-4">
          <div className="shrink-0 h-11 w-11 rounded-md bg-background border border-border flex items-center justify-center">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">{topic.number}</span>
              <h2 className="text-lg md:text-xl font-bold tracking-tight font-mono">{topic.title}</h2>
            </div>
            <p className="text-[13px] md:text-sm text-muted-foreground italic">{topic.oneLiner}</p>
          </div>
        </div>
      </div>

      <div className="p-5 flex flex-col gap-5">
        {/* Summary + why */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <ScrollText className="h-3.5 w-3.5 text-muted-foreground" />
              <h3 className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">What it is</h3>
            </div>
            <p className="text-sm leading-relaxed text-foreground/90">{topic.summary}</p>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Target className="h-3.5 w-3.5 text-muted-foreground" />
              <h3 className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">Why it matters</h3>
            </div>
            <p className="text-sm leading-relaxed text-foreground/90">{topic.whyItMatters}</p>
          </div>
        </div>

        {/* Callouts */}
        {topic.callouts && topic.callouts.length > 0 && (
          <div className="flex flex-col gap-3">
            {topic.callouts.map((c, i) => (
              <div
                key={i}
                className="border border-primary/30 bg-primary/5 rounded-md p-4"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <h4 className="font-mono text-[12px] uppercase tracking-wider text-primary">{c.heading}</h4>
                </div>
                <p className="text-[13px] leading-relaxed text-foreground/90">{c.body}</p>
              </div>
            ))}
          </div>
        )}

        {/* Key concepts */}
        {topic.keyConcepts.length > 0 && (
          <div>
            <h3 className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground mb-3">
              Key concepts
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {topic.keyConcepts.map((k) => (
                <div
                  key={k.term}
                  className="border border-border rounded p-3 bg-background/40 hover-row"
                >
                  <div className="font-mono text-[12.5px] font-bold text-foreground mb-0.5">{k.term}</div>
                  <div className="text-[12.5px] text-muted-foreground leading-relaxed">{k.desc}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Videos */}
        {topic.videos.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Youtube className="h-3.5 w-3.5 text-signal-strong-sell" />
              <h3 className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                Free YouTube — channels & playlists
              </h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {topic.videos.map((v, i) => (
                <a
                  key={i}
                  href={v.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border border-border rounded p-3 bg-background/40 hover-row flex items-start gap-3 group"
                >
                  <PlayCircle className="h-4 w-4 mt-0.5 shrink-0 text-signal-strong-sell" />
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-[12.5px] font-semibold text-foreground group-hover:text-primary truncate">
                      {v.title}
                    </div>
                    <div className="text-[11.5px] text-muted-foreground truncate">{v.channel}</div>
                    {v.note && (
                      <div className="text-[11px] text-muted-foreground/80 mt-1 italic">{v.note}</div>
                    )}
                  </div>
                  <ExternalLink className="h-3 w-3 mt-1 shrink-0 text-muted-foreground group-hover:text-primary" />
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Resources */}
        {topic.resources.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Library className="h-3.5 w-3.5 text-signal-buy" />
              <h3 className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                Resources — books, courses, sites
              </h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {topic.resources.map((r, i) => {
                const inner = (
                  <>
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="font-mono text-[12.5px] font-semibold text-foreground truncate">
                        {r.title}
                      </div>
                      <Badge
                        variant="outline"
                        className={`shrink-0 text-[9.5px] font-mono uppercase tracking-wider ${TYPE_CLASS[r.type]}`}
                      >
                        {r.type}
                      </Badge>
                    </div>
                    {r.by && (
                      <div className="text-[11.5px] text-muted-foreground">by {r.by}</div>
                    )}
                    {r.note && (
                      <div className="text-[11px] text-muted-foreground/80 mt-1 italic">{r.note}</div>
                    )}
                  </>
                );
                return r.url ? (
                  <a
                    key={i}
                    href={r.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="border border-border rounded p-3 bg-background/40 hover-row block group"
                  >
                    {inner}
                    <div className="mt-1 text-[10.5px] text-muted-foreground/80 truncate flex items-center gap-1 group-hover:text-primary">
                      <ExternalLink className="h-3 w-3" />
                      {r.url.replace(/^https?:\/\//, "")}
                    </div>
                  </a>
                ) : (
                  <div
                    key={i}
                    className="border border-border rounded p-3 bg-background/40"
                  >
                    {inner}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
