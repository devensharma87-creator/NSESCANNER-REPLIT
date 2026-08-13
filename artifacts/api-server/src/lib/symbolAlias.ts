import { UNIVERSE } from "./universe";
import { getAllSymbols } from "./marketData/referenceData";
import { getBootCapabilities } from "./bootCapabilities";

/**
 * Maps free-form company-name mentions in news headlines to canonical NSE symbols.
 *
 * Strategy:
 *   1. Curated UNIVERSE → name + symbol (high quality, ~280 stocks).
 *   2. Bhavcopy SYMBOL list (~2486) → match by exact ticker token in title/desc.
 *   3. Hand-curated alias dictionary for common short-forms ("ONGC/OIL" → ONGC,
 *      "AB REALTY" → ABREL, etc.) gathered from market news conventions.
 *
 * We err on the side of high precision (false positives = wrong stock surfaced)
 * over recall, since this drives the user's "watch / avoid" deck.
 */

interface Alias { aliases: string[]; symbol: string; }

const HAND_CURATED: Alias[] = [
  { symbol: "ONGC", aliases: ["ONGC/OIL", "ONGC", "OIL & NATURAL GAS"] },
  { symbol: "OIL", aliases: ["OIL INDIA"] },
  { symbol: "IEX", aliases: ["INDIAN ENERGY EXCHANGE", "IEX"] },
  { symbol: "TATACAPITAL", aliases: ["TATA CAPITAL", "TATA CAP"] },
  { symbol: "HGINFRA", aliases: ["HG INFRA"] },
  { symbol: "ABREL", aliases: ["AB REALTY", "ADITYA BIRLA REAL ESTATE", "ADITYA BIRLA REALTY"] },
  { symbol: "MAHLOG", aliases: ["MAHINDRA LOGISTICS"] },
  { symbol: "EQUITASBNK", aliases: ["EQUITAS SFB", "EQUITAS SMALL FINANCE"] },
  { symbol: "GUJTHEM", aliases: ["GUJARAT THEMIS"] },
  { symbol: "RELIANCE", aliases: ["RELIANCE INDUSTRIES", "RIL"] },
  { symbol: "JIOFIN", aliases: ["JIO FINANCIAL"] },
  { symbol: "HDFCBANK", aliases: ["HDFC BANK"] },
  { symbol: "ICICIBANK", aliases: ["ICICI BANK"] },
  { symbol: "AXISBANK", aliases: ["AXIS BANK"] },
  { symbol: "KOTAKBANK", aliases: ["KOTAK MAHINDRA BANK", "KOTAK BANK"] },
  { symbol: "SBIN", aliases: ["STATE BANK OF INDIA", "SBI"] },
  { symbol: "INDUSINDBK", aliases: ["INDUSIND BANK"] },
  { symbol: "TCS", aliases: ["TATA CONSULTANCY", "TCS"] },
  { symbol: "INFY", aliases: ["INFOSYS"] },
  { symbol: "WIPRO", aliases: ["WIPRO"] },
  { symbol: "HCLTECH", aliases: ["HCL TECH", "HCL TECHNOLOGIES"] },
  { symbol: "TECHM", aliases: ["TECH MAHINDRA"] },
  { symbol: "LTIM", aliases: ["LTIMINDTREE", "LTI MINDTREE"] },
  { symbol: "TATAMOTORS", aliases: ["TATA MOTORS"] },
  { symbol: "M&M", aliases: ["MAHINDRA & MAHINDRA", "MAHINDRA AND MAHINDRA"] },
  { symbol: "MARUTI", aliases: ["MARUTI SUZUKI", "MARUTI"] },
  { symbol: "BAJAJ-AUTO", aliases: ["BAJAJ AUTO"] },
  { symbol: "EICHERMOT", aliases: ["EICHER MOTORS", "ROYAL ENFIELD"] },
  { symbol: "HEROMOTOCO", aliases: ["HERO MOTOCORP"] },
  { symbol: "TVSMOTOR", aliases: ["TVS MOTOR"] },
  { symbol: "ASHOKLEY", aliases: ["ASHOK LEYLAND"] },
  { symbol: "BAJFINANCE", aliases: ["BAJAJ FINANCE"] },
  { symbol: "BAJAJFINSV", aliases: ["BAJAJ FINSERV"] },
  { symbol: "SBILIFE", aliases: ["SBI LIFE"] },
  { symbol: "HDFCLIFE", aliases: ["HDFC LIFE"] },
  { symbol: "ICICIPRULI", aliases: ["ICICI PRUDENTIAL"] },
  { symbol: "ITC", aliases: ["ITC"] },
  { symbol: "HINDUNILVR", aliases: ["HINDUSTAN UNILEVER", "HUL"] },
  { symbol: "NESTLEIND", aliases: ["NESTLE INDIA", "NESTLE"] },
  { symbol: "BRITANNIA", aliases: ["BRITANNIA"] },
  { symbol: "DABUR", aliases: ["DABUR"] },
  { symbol: "MARICO", aliases: ["MARICO"] },
  { symbol: "GODREJCP", aliases: ["GODREJ CONSUMER"] },
  { symbol: "ADANIENT", aliases: ["ADANI ENTERPRISES"] },
  { symbol: "ADANIPORTS", aliases: ["ADANI PORTS", "APSEZ"] },
  { symbol: "ADANIGREEN", aliases: ["ADANI GREEN"] },
  { symbol: "ADANIPOWER", aliases: ["ADANI POWER"] },
  { symbol: "ATGL", aliases: ["ADANI TOTAL GAS"] },
  { symbol: "AMBUJACEM", aliases: ["AMBUJA CEMENTS", "AMBUJA"] },
  { symbol: "ACC", aliases: ["ACC"] },
  { symbol: "ULTRACEMCO", aliases: ["ULTRATECH CEMENT"] },
  { symbol: "SHREECEM", aliases: ["SHREE CEMENT"] },
  { symbol: "JSWSTEEL", aliases: ["JSW STEEL"] },
  { symbol: "TATASTEEL", aliases: ["TATA STEEL"] },
  { symbol: "HINDALCO", aliases: ["HINDALCO"] },
  { symbol: "VEDL", aliases: ["VEDANTA"] },
  { symbol: "SAIL", aliases: ["STEEL AUTHORITY", "SAIL"] },
  { symbol: "COALINDIA", aliases: ["COAL INDIA"] },
  { symbol: "NTPC", aliases: ["NTPC"] },
  { symbol: "POWERGRID", aliases: ["POWER GRID"] },
  { symbol: "TATAPOWER", aliases: ["TATA POWER"] },
  { symbol: "BHEL", aliases: ["BHARAT HEAVY ELECTRICALS", "BHEL"] },
  { symbol: "BEL", aliases: ["BHARAT ELECTRONICS"] },
  { symbol: "HAL", aliases: ["HINDUSTAN AERONAUTICS"] },
  { symbol: "BDL", aliases: ["BHARAT DYNAMICS"] },
  { symbol: "MAZDOCK", aliases: ["MAZAGON DOCK"] },
  { symbol: "COCHINSHIP", aliases: ["COCHIN SHIPYARD"] },
  { symbol: "SUNPHARMA", aliases: ["SUN PHARMA"] },
  { symbol: "DRREDDY", aliases: ["DR REDDY", "DR. REDDY"] },
  { symbol: "CIPLA", aliases: ["CIPLA"] },
  { symbol: "DIVISLAB", aliases: ["DIVI'S LAB", "DIVIS LAB"] },
  { symbol: "LUPIN", aliases: ["LUPIN"] },
  { symbol: "AUROPHARMA", aliases: ["AUROBINDO PHARMA"] },
  { symbol: "TORNTPHARM", aliases: ["TORRENT PHARMA"] },
  { symbol: "BIOCON", aliases: ["BIOCON"] },
  { symbol: "ZYDUSLIFE", aliases: ["ZYDUS LIFE", "ZYDUS"] },
  { symbol: "BHARTIARTL", aliases: ["BHARTI AIRTEL", "AIRTEL"] },
  { symbol: "IDEA", aliases: ["VODAFONE IDEA", "VI"] },
  { symbol: "INDIGO", aliases: ["INTERGLOBE AVIATION", "INDIGO"] },
  { symbol: "SPICEJET", aliases: ["SPICEJET"] },
  { symbol: "DMART", aliases: ["AVENUE SUPERMARTS", "DMART", "D-MART"] },
  { symbol: "TRENT", aliases: ["TRENT"] },
  { symbol: "TITAN", aliases: ["TITAN"] },
  { symbol: "ASIANPAINT", aliases: ["ASIAN PAINTS"] },
  { symbol: "BERGEPAINT", aliases: ["BERGER PAINTS"] },
  { symbol: "PIDILITIND", aliases: ["PIDILITE"] },
  { symbol: "LTF", aliases: ["L&T FINANCE", "LARSEN FINANCE", "LTFH", "L&T FIN"] },
  { symbol: "LTTS", aliases: ["L&T TECHNOLOGY SERVICES", "LTTS"] },
  { symbol: "LT", aliases: ["LARSEN & TOUBRO", "LARSEN AND TOUBRO", "LARSEN TOUBRO"] },
  { symbol: "SIEMENS", aliases: ["SIEMENS"] },
  { symbol: "ABB", aliases: ["ABB INDIA"] },
  { symbol: "DIXON", aliases: ["DIXON TECH", "DIXON TECHNOLOGIES"] },
  { symbol: "PERSISTENT", aliases: ["PERSISTENT"] },
  { symbol: "COFORGE", aliases: ["COFORGE"] },
  { symbol: "MPHASIS", aliases: ["MPHASIS"] },
  { symbol: "POLYCAB", aliases: ["POLYCAB"] },
  { symbol: "HAVELLS", aliases: ["HAVELLS"] },
  { symbol: "VOLTAS", aliases: ["VOLTAS"] },
  { symbol: "NYKAA", aliases: ["NYKAA", "FSN E-COMMERCE"] },
  { symbol: "ZOMATO", aliases: ["ZOMATO", "ETERNAL"] },
  { symbol: "PAYTM", aliases: ["PAYTM", "ONE 97"] },
  { symbol: "POLICYBZR", aliases: ["POLICYBAZAAR", "PB FINTECH"] },
  { symbol: "MOTHERSON", aliases: ["MOTHERSON SUMI", "SAMVARDHANA MOTHERSON"] },
  { symbol: "CIEINDIA", aliases: ["CIE AUTO", "CIE AUTOMOTIVE", "MAHINDRA CIE"] },
  { symbol: "IKS", aliases: ["IKS HEALTH", "INVENTURUS"] },
  { symbol: "IRCTC", aliases: ["IRCTC"] },
  { symbol: "RVNL", aliases: ["RAIL VIKAS"] },
  { symbol: "IRFC", aliases: ["IRFC", "INDIAN RAILWAY FINANCE"] },
  { symbol: "RAILTEL", aliases: ["RAILTEL"] },
  { symbol: "CONCOR", aliases: ["CONCOR", "CONTAINER CORP"] },
  { symbol: "PFC", aliases: ["POWER FINANCE"] },
  { symbol: "RECLTD", aliases: ["REC LTD", "REC LIMITED"] },
  { symbol: "IOC", aliases: ["INDIAN OIL", "IOCL"] },
  { symbol: "BPCL", aliases: ["BHARAT PETROLEUM"] },
  { symbol: "HINDPETRO", aliases: ["HINDUSTAN PETROLEUM", "HPCL"] },
  { symbol: "GAIL", aliases: ["GAIL"] },
  { symbol: "PETRONET", aliases: ["PETRONET LNG"] },
  { symbol: "IGL", aliases: ["INDRAPRASTHA GAS"] },
  { symbol: "MGL", aliases: ["MAHANAGAR GAS"] },
  { symbol: "GUJGASLTD", aliases: ["GUJARAT GAS"] },
  { symbol: "JSWENERGY", aliases: ["JSW ENERGY"] },
  { symbol: "NHPC", aliases: ["NHPC"] },
  { symbol: "SJVN", aliases: ["SJVN"] },
  { symbol: "PNB", aliases: ["PUNJAB NATIONAL BANK"] },
  { symbol: "BANKBARODA", aliases: ["BANK OF BARODA", "BOB"] },
  { symbol: "CANBK", aliases: ["CANARA BANK"] },
  { symbol: "UNIONBANK", aliases: ["UNION BANK"] },
  { symbol: "IDFCFIRSTB", aliases: ["IDFC FIRST BANK"] },
  { symbol: "FEDERALBNK", aliases: ["FEDERAL BANK"] },
  { symbol: "AUBANK", aliases: ["AU SMALL FINANCE", "AU SFB"] },
  { symbol: "BANDHANBNK", aliases: ["BANDHAN BANK"] },
  { symbol: "RBLBANK", aliases: ["RBL BANK"] },
  { symbol: "YESBANK", aliases: ["YES BANK"] },
  { symbol: "LICI", aliases: ["LIC", "LIFE INSURANCE CORP"] },
  { symbol: "GICRE", aliases: ["GIC RE"] },
  { symbol: "NEWGENSOFT", aliases: ["NEWGEN SOFTWARE"] },
];

interface ResolvedSymbol {
  symbol: string;
  matched: string; // the alias / token that matched
}

interface AliasIndex { byUpperToken: Map<string, string>; byPhrase: { phrase: string; symbol: string }[] }
let CACHE: AliasIndex | null = null;
let inflight: Promise<AliasIndex> | null = null;

async function buildIndex() {
  const byUpperToken = new Map<string, string>();
  const phrases: { phrase: string; symbol: string }[] = [];

  // 1) curated UNIVERSE (~280): map both NAME and SYMBOL — these are the only
  //    symbols we trust for token-only matching (bhavcopy contains many tickers
  //    that are common English words like SUPREME, HEALTHY, IT, DIVIDEND etc.
  //    which produce false positives when matched as bare tokens).
  for (const u of UNIVERSE) {
    byUpperToken.set(u.symbol.toUpperCase(), u.symbol);
    if (u.name) phrases.push({ phrase: u.name.toUpperCase(), symbol: u.symbol });
  }
  // 2) hand-curated aliases for short-forms used in market news (highest priority).
  for (const a of HAND_CURATED) {
    for (const ph of a.aliases) phrases.push({ phrase: ph.toUpperCase(), symbol: a.symbol });
  }
  // 3) bhavcopy symbols (~2486): warm the registry so /api/scan/full-nse and
  //    other consumers stay in sync. We do NOT add them to byUpperToken because
  //    free-floating English words would produce wrong-stock matches; they're
  //    only reachable via an explicit phrase alias above.
  await getAllSymbols().catch(() => null);

  // Sort phrases by length desc so we match the longest one first
  // ("BANK OF BARODA" before "BANK", "TATA MOTORS" before "TATA").
  phrases.sort((a, b) => b.phrase.length - a.phrase.length);

  return { byUpperToken, byPhrase: phrases };
}

async function getIndex() {
  if (CACHE) return CACHE;
  if (!inflight) inflight = buildIndex().then(c => { CACHE = c; return c; });
  return inflight;
}

// Common English / market-jargon words that happen to also be NSE bhavcopy
// tickers — token-only matches against these produce false positives, so we
// reject them. Phrase matches (curated UNIVERSE name or hand-curated alias)
// are unaffected.
const STOPWORD_TICKERS = new Set([
  "BUY", "SELL", "GAIN", "LOSS", "BANK", "CASH", "DEBT", "FUND", "GOLD",
  "HIGH", "LOW", "OIL", "GAS", "USA", "GDP", "RBI", "SEBI", "FED", "ECB",
  "FII", "DII", "PSU", "NSE", "BSE", "GST", "INDIA", "ASIA", "DOW", "S&P",
  "Q1", "Q2", "Q3", "Q4", "FY", "EBITDA", "EPS", "PE", "PB", "ROE", "ROCE",
  "AUM", "NIM", "GNPA", "NPA", "IPO", "FPO", "QIP", "OFS", "STT",
  "DIVIDEND", "TECH", "CONSUMER", "POWER", "FINANCE", "AUTO", "STEEL",
  "CEMENT", "PHARMA", "REALTY", "ENERGY", "INFRA", "MEDIA", "RETAIL",
  "PRIME", "INDEX", "GROWTH", "VALUE", "MOMENTUM", "QUALITY", "NIFTY",
  "SENSEX", "BANKNIFTY", "FINNIFTY", "MIDCAP", "SMALLCAP", "LARGE",
  "GLOBAL", "WORLD", "DAILY", "WEEKLY", "MONTHLY", "FUTURE", "OPTION",
  "CALL", "PUT", "SHORT", "LONG", "TRUST", "BOND", "ETF", "FOF", "AIF",
  "DEAL", "OFFER", "ORDER", "PLAN", "FUND", "RATE", "PRICE", "SHARE",
  "CHIEF", "GROUP", "HOLDING", "HOLDINGS", "GREEN", "BLUE", "RED",
  "JUNIOR", "SENIOR", "MASTER", "GOLDEN", "SILVER", "DIAMOND", "ROYAL",
  "MAGIC", "POWER", "WONDER", "STAR", "SUN", "MOON",
]);

export async function resolveSymbols(text: string): Promise<ResolvedSymbol[]> {
  const idx = await getIndex();
  if (!idx) return [];
  const upper = text.toUpperCase();
  const found = new Map<string, string>();

  // 1) Phrase match (longest first) — high precision.
  for (const p of idx.byPhrase) {
    if (found.has(p.symbol)) continue;
    const i = upper.indexOf(p.phrase);
    if (i < 0) continue;
    // ensure token boundary on both sides
    const left = i === 0 || /[^A-Z0-9]/.test(upper[i - 1]!);
    const rightIdx = i + p.phrase.length;
    const right = rightIdx >= upper.length || /[^A-Z0-9]/.test(upper[rightIdx]!);
    if (left && right) found.set(p.symbol, p.phrase);
  }

  // 2) Token-boundary ticker match (but skip ambiguous stopwords).
  const tokens = upper.match(/[A-Z][A-Z0-9&-]{1,14}/g) ?? [];
  for (const tok of tokens) {
    if (found.size > 0) break; // phrase match already won
    if (STOPWORD_TICKERS.has(tok)) continue;
    const sym = idx.byUpperToken.get(tok);
    if (sym && !found.has(sym)) found.set(sym, tok);
  }

  return Array.from(found.entries()).map(([symbol, matched]) => ({ symbol, matched }));
}

// warm (guarded: skip in test env — P0.1B tripwire; and in boot-proof mode,
// where this reaches the NSE bhavcopy over the network at import time)
if (process.env['NODE_ENV'] !== 'test' && getBootCapabilities().providerNetwork) {
  void getIndex().catch(() => undefined);
}
