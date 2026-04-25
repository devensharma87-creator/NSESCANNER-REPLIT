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
    id: "options",
    number: "06",
    title: "Options & Derivatives",
    oneLiner: "Use leverage and asymmetry — but respect the Greeks or get destroyed.",
    icon: Zap,
    summary:
      "Options are contracts giving the right (not obligation) to buy/sell at a strike. They unlock leverage, defined-risk speculation, hedging, and income strategies. The catch: time, volatility, and gamma can wipe you out faster than any equity trade.",
    whyItMatters:
      "F&O is where most Indian active traders live. SEBI's own data shows 9 of 10 retail F&O traders lose money — almost always because they ignored Greeks, sized too big, or held losing options into expiry. Learn the math before the leverage.",
    keyConcepts: [
      { term: "Call vs Put", desc: "Call = right to buy. Put = right to sell. Buyer pays premium; seller collects premium and takes the risk." },
      { term: "ITM / ATM / OTM", desc: "In / At / Out of the money. ITM has intrinsic value; OTM is pure time + volatility premium." },
      { term: "Delta", desc: "Change in option price per ₹1 move in underlying. Also approximates probability of expiring ITM." },
      { term: "Gamma", desc: "Rate of change of delta. Highest near ATM and near expiry — what makes 0DTE so wild." },
      { term: "Theta", desc: "Time decay per day. Buyers hate it, sellers love it. Accelerates in the last 2 weeks before expiry." },
      { term: "Vega", desc: "Sensitivity to implied volatility. Long options are long vega; short options are short vega." },
      { term: "Implied Volatility (IV)", desc: "Market's expectation of future move. Compare to historical volatility to find rich/cheap options." },
      { term: "Open Interest", desc: "Live count of open contracts at each strike. Heavy OI = strong support/resistance per market consensus." },
      { term: "Max Pain", desc: "Strike where total option holders lose the most. Price often gravitates here on expiry day — debated, but worth tracking." },
      { term: "Strategies", desc: "Spreads (bull call, bear put), straddles, strangles, iron condors, calendars, ratio spreads. Each has a defined payoff diagram." },
    ],
    callouts: [
      {
        heading: "Before you trade your first options contract",
        body:
          "1) Read all of Varsity Module 5 + 6 (free). 2) Paper-trade for 30 sessions. 3) Never buy weekly OTM as a 'lottery' — that is the #1 way retail loses. 4) Always know max loss before entry. 5) Have an exit rule for both profit AND loss before you click buy.",
      },
    ],
    videos: [
      { title: "Options Trading playlist", channel: "P R Sundar", url: "https://www.youtube.com/@PRSundarOfficialChannel/playlists", note: "Veteran Indian options seller." },
      { title: "Options Strategies playlist", channel: "Sensibull", url: "https://www.youtube.com/@sensibull/playlists" },
      { title: "Options Trading for Beginners", channel: "Project Finance / Project Option", url: "https://www.youtube.com/@projectfinance" },
      { title: "tastylive (formerly tastytrade)", channel: "tastylive", url: "https://www.youtube.com/@tastyliveshow", note: "Premium-selling philosophy. Free hours of content daily." },
      { title: "The Greeks Explained", channel: "InTheMoney", url: "https://www.youtube.com/@InTheMoneyAdam" },
    ],
    resources: [
      { title: "Zerodha Varsity — Options Theory", type: "Course", url: "https://zerodha.com/varsity/module/option-theory/" },
      { title: "Zerodha Varsity — Option Strategies", type: "Course", url: "https://zerodha.com/varsity/module/option-strategies/" },
      { title: "Sensibull (free strategy builder)", type: "Site", url: "https://web.sensibull.com" },
      { title: "Opstra (free tier)", type: "Site", url: "https://opstra.definedge.com" },
      { title: "Options as a Strategic Investment", type: "Book", by: "Lawrence McMillan", note: "Encyclopedia of options." },
      { title: "Option Volatility & Pricing", type: "Book", by: "Sheldon Natenberg", note: "The Greeks bible." },
      { title: "NSE F&O Specifications", type: "Doc", url: "https://www.nseindia.com/products-services/equity-derivatives-equity" },
    ],
  },
  {
    id: "risk",
    number: "07",
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
    number: "08",
    title: "Trading Psychology",
    oneLiner: "Your edge is real. Your discipline is what executes it.",
    icon: Brain,
    summary:
      "Trading is a performance discipline. Knowledge of strategy is necessary but never sufficient — fear, greed, FOMO, revenge trading, and overconfidence destroy more accounts than bad analysis. Building psychological process is as important as building a chart setup.",
    whyItMatters:
      "Two traders with the same system will get wildly different results. The one who sticks to the rules through losing streaks wins. The one who 'just this once' overrides the plan blows up.",
    keyConcepts: [
      { term: "Probabilistic Mindset", desc: "Each trade is one sample. Outcome ≠ decision quality. Judge process, not single results." },
      { term: "FOMO", desc: "Chasing a move because 'it's already running'. The cure: pre-defined entry zones — no zone, no trade." },
      { term: "Revenge Trading", desc: "Doubling size after a loss to 'win it back'. Number-one path to ruin. Walk away after 2 consecutive losses." },
      { term: "Confirmation Bias", desc: "Reading only news that supports your position. Force yourself to write the bear case for every long." },
      { term: "Anchoring", desc: "Refusing to sell because 'I bought at 200'. The market does not care what you paid." },
      { term: "Recency Bias", desc: "Last 3 winners feel like skill. Last 3 losers feel like the system is broken. Both are noise." },
      { term: "Journaling", desc: "Daily log of trades + emotion + rule violations. Single highest-leverage habit you can build." },
    ],
    videos: [
      { title: "Trader Psychology playlist", channel: "SMB Capital", url: "https://www.youtube.com/@smbcapital/playlists", note: "Hosts regular Brett Steenbarger and Mark Douglas content." },
      { title: "Mind of a Trader", channel: "Tom Hougaard", url: "https://www.youtube.com/@TraderTomHougaard" },
      { title: "Mental Game of Trading", channel: "Jared Tendler", url: "https://www.youtube.com/@JaredTendler" },
    ],
    resources: [
      { title: "Trading in the Zone", type: "Book", by: "Mark Douglas", note: "The single most-recommended trading psychology book." },
      { title: "The Disciplined Trader", type: "Book", by: "Mark Douglas" },
      { title: "The Daily Trading Coach", type: "Book", by: "Brett Steenbarger" },
      { title: "Thinking, Fast and Slow", type: "Book", by: "Daniel Kahneman", note: "Cognitive biases — apply directly to trading." },
      { title: "Edgewonk (paid journal)", type: "Site", url: "https://edgewonk.com" },
      { title: "TraderSync (free tier)", type: "Site", url: "https://tradersync.com" },
    ],
  },
  {
    id: "indian-market",
    number: "09",
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
    number: "10",
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
    number: "11",
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
        ...t.videos.map((v) => `${v.title} ${v.channel}`),
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
