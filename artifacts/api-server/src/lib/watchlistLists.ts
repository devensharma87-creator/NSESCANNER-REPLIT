/**
 * Pre-defined watchlists matching NSE / BSE official index constituents.
 * Symbols are NSE tickers (no .NS suffix). Sources: NSE indices semi-annual review
 * (Jan/Jul 2025) and BSE Sensex methodology.
 *
 * Categorisation rules:
 *  - A symbol may appear in multiple "umbrella" indices (e.g. SENSEX, BANKNIFTY,
 *    NIFTY500 all overlap with NIFTY100), but the three Nifty market-cap baskets
 *    (NIFTY100 / NIFTYMIDCAP100 / NIFTYSMALLCAP100) are MUTUALLY EXCLUSIVE per
 *    NSE methodology. We assert this at module load.
 */

export type WatchlistKey =
  | "NIFTY50"
  | "NIFTY100"
  | "NIFTYMIDCAP100"
  | "NIFTYSMALLCAP100"
  | "NIFTY500"
  | "SENSEX"
  | "BANKNIFTY";

export interface WatchlistMeta {
  key: WatchlistKey;
  label: string;
  description: string;
}

export const WATCHLIST_META: Record<WatchlistKey, WatchlistMeta> = {
  SENSEX: {
    key: "SENSEX",
    label: "BSE Sensex 30",
    description: "30 largest, most actively traded BSE-listed companies (Sensex constituents).",
  },
  BANKNIFTY: {
    key: "BANKNIFTY",
    label: "Bank Nifty",
    description: "12 most liquid Indian banking stocks (Nifty Bank index).",
  },
  NIFTY50: {
    key: "NIFTY50",
    label: "Nifty 50",
    description: "50 largest NSE-listed companies by free-float market cap.",
  },
  NIFTY100: {
    key: "NIFTY100",
    label: "Nifty 100",
    description: "Top 100 large-cap stocks (Nifty 50 + Nifty Next 50) by full market cap.",
  },
  NIFTYMIDCAP100: {
    key: "NIFTYMIDCAP100",
    label: "Nifty Midcap 100",
    description: "100 mid-cap stocks ranked 101-250 by full market cap.",
  },
  NIFTYSMALLCAP100: {
    key: "NIFTYSMALLCAP100",
    label: "Nifty Smallcap 100",
    description: "100 small-cap stocks ranked 251-500 by full market cap.",
  },
  NIFTY500: {
    key: "NIFTY500",
    label: "Nifty 500",
    description: "Top 500 NSE-listed companies — covers ~96% of total market cap.",
  },
};

// ──────────────────────────────────────────────────────────────────────────
// SENSEX 30 (BSE) — current constituents
// ──────────────────────────────────────────────────────────────────────────
export const SENSEX_SYMBOLS: string[] = [
  "RELIANCE","TCS","HDFCBANK","ICICIBANK","INFY","HINDUNILVR","ITC","SBIN","BHARTIARTL","KOTAKBANK",
  "LT","HCLTECH","ASIANPAINT","AXISBANK","MARUTI","SUNPHARMA","TITAN","BAJFINANCE","NTPC","ULTRACEMCO",
  "NESTLEIND","M&M","POWERGRID","TATASTEEL","TECHM","JSWSTEEL","INDUSINDBK","BAJAJFINSV","ADANIPORTS","TATAMOTORS",
];

// ──────────────────────────────────────────────────────────────────────────
// BANK NIFTY — 12 constituents
// ──────────────────────────────────────────────────────────────────────────
export const BANKNIFTY_SYMBOLS: string[] = [
  "HDFCBANK","ICICIBANK","SBIN","KOTAKBANK","AXISBANK","INDUSINDBK",
  "BANKBARODA","FEDERALBNK","IDFCFIRSTB","AUBANK","PNB","CANBK",
];

// ──────────────────────────────────────────────────────────────────────────
// NIFTY 50
// ──────────────────────────────────────────────────────────────────────────
export const NIFTY50_SYMBOLS: string[] = [
  "RELIANCE","TCS","HDFCBANK","ICICIBANK","INFY","HINDUNILVR","ITC","SBIN","BHARTIARTL","KOTAKBANK",
  "LT","HCLTECH","ASIANPAINT","AXISBANK","MARUTI","SUNPHARMA","TITAN","BAJFINANCE","NTPC","ULTRACEMCO",
  "WIPRO","NESTLEIND","M&M","POWERGRID","TATASTEEL","TECHM","JSWSTEEL","INDUSINDBK","BAJAJFINSV","HDFCLIFE",
  "DRREDDY","CIPLA","COALINDIA","BPCL","HEROMOTOCO","TATAMOTORS","BRITANNIA","SHRIRAMFIN","SBILIFE","EICHERMOT",
  "ONGC","GRASIM","BAJAJ-AUTO","ADANIPORTS","ADANIENT","HINDALCO","APOLLOHOSP","TATACONSUM","JIOFIN","TRENT",
];

// ──────────────────────────────────────────────────────────────────────────
// NIFTY NEXT 50 (Junior) — 50 stocks
// ──────────────────────────────────────────────────────────────────────────
export const NIFTYNEXT50_SYMBOLS: string[] = [
  "ABB","ADANIGREEN","ADANIPOWER","AMBUJACEM","DMART","BAJAJHLDNG","BANKBARODA","BERGEPAINT","BEL","BOSCHLTD",
  "CANBK","CHOLAFIN","COLPAL","DABUR","DLF","DIVISLAB","GAIL","GODREJCP","HAVELLS","ICICIGI",
  "ICICIPRULI","IOC","INDIGO","IRFC","JINDALSTEL","LICI","LTIM","MARICO","MOTHERSON","NAUKRI",
  "PIDILITIND","PFC","PNB","RECLTD","SIEMENS","SRF","TATAPOWER","TORNTPHARM","TVSMOTOR","VBL",
  "VEDL","ZOMATO","ZYDUSLIFE","HAL","ADANIENSOL","JSWENERGY","UNITDSPR","CGPOWER","PERSISTENT","INDUSTOWER",
];

/** Nifty 100 = Nifty 50 + Nifty Next 50 */
export const NIFTY100_SYMBOLS: string[] = [...NIFTY50_SYMBOLS, ...NIFTYNEXT50_SYMBOLS];

// ──────────────────────────────────────────────────────────────────────────
// NIFTY MIDCAP 100 — official constituents (101–250 by full market cap)
// COLPAL removed (moved to Next 50). DIVISLAB removed (in Next 50).
// IRCTC, ABBOTINDIA, OFSS etc. are genuine midcaps.
// ──────────────────────────────────────────────────────────────────────────
export const NIFTYMIDCAP100_SYMBOLS: string[] = [
  "ABCAPITAL","ABFRL","ACC","AIAENG","ALKEM","APLAPOLLO","ASHOKLEY","ASTRAL","AUROPHARMA","BALKRISIND",
  "BANDHANBNK","BANKINDIA","BHARATFORG","BHEL","BIOCON","COFORGE","CONCOR","CUMMINSIND","DALBHARAT","DEEPAKNTR",
  "DELHIVERY","DIXON","ESCORTS","EXIDEIND","FACT","FEDERALBNK","FLUOROCHEM","FORTIS","GMRINFRA","GODREJPROP",
  "GUJGASLTD","HDFCAMC","HINDPETRO","HONAUT","IDFCFIRSTB","IDEA","IGL","INDHOTEL","IPCALAB","IRCTC",
  "JUBLFOOD","KPITTECH","L&TFH","LICHSGFIN","LUPIN","M&MFIN","MAXHEALTH","MAZDOCK","MFSL","MPHASIS",
  "MRF","MUTHOOTFIN","NHPC","NMDC","NYKAA","OBEROIRLTY","OFSS","OIL","PAGEIND","PATANJALI",
  "PAYTM","PEL","PETRONET","PHOENIXLTD","PIIND","POLICYBZR","POLYCAB","POONAWALLA","PRESTIGE","RVNL",
  "SAIL","SOLARINDS","SONACOMS","SUNDARMFIN","SUNTV","SUPREMEIND","SYNGENE","TATACOMM","TATAELXSI","TATATECH",
  "THERMAX","TIINDIA","TORNTPOWER","TUBEINVEST","UBL","UNIONBANK","UPL","VOLTAS","YESBANK","MANKIND",
  "JSL","NLCINDIA","KEI","HUDCO","ABBOTINDIA","GLAND","LODHA","CRISIL","KALYANKJIL","SUZLON",
];

// ──────────────────────────────────────────────────────────────────────────
// NIFTY SMALLCAP 100 — official constituents (251–500 by full market cap)
// Removed bogus: NHIMHIM, NSLNISP. Removed mid-overlap: AUBANK (in BANKNIFTY).
// ──────────────────────────────────────────────────────────────────────────
export const NIFTYSMALLCAP100_SYMBOLS: string[] = [
  "AARTIIND","ANGELONE","APARINDS","ASTERDM","ATGL","ATUL","BIKAJI","BLUESTARCO","BSE","BALRAMCHIN",
  "BLS","BSOFT","CAMS","CASTROLIND","CDSL","CEATLTD","CENTRALBK","CESC","CHAMBLFERT","CHENNPETRO",
  "CGCL","CRAFTSMAN","CYIENT","DOMS","ELECTCAST","EIDPARRY","ENGINERSIN","EPL","ERIS","FINCABLES",
  "FINPIPE","FIVESTAR","FSL","GESHIP","GICRE","GILLETTE","GLENMARK","GNFC","GODFRYPHLP","GPPL",
  "GRSE","GSPL","HBLPOWER","HFCL","HSCL","IDBI","IEX","INTELLECT","IOB","IRCON",
  "JBCHEPHARM","JBMA","JKCEMENT","JMFINANCIL","JUSTDIAL","JYOTHYLAB","KAJARIACER","KARURVYSYA","KEC","KFINTECH",
  "KIRLOSBROS","KIRLOSENG","KPRMILL","LATENTVIEW","LAURUSLABS","LXCHEM","MASTEK","MCX","METROBRAND","MGL",
  "MMTC","NATCOPHARM","NATIONALUM","NBCC","NCC","OLECTRA","PCBL","PGHL","PNBHOUSING","PRINCEPIPE",
  "PVRINOX","RADICO","RBLBANK","REDINGTON","ROUTE","SCI","SCHAEFFLER","SHYAMMETL","SOBHA","STARCEMENT",
  "STARHEALTH","SWANENERGY","SYRMA","TANLA","TATAINVEST","TBOTEK","TEJASNET","TRIDENT","WHIRLPOOL","ZENSARTECH",
];

// ──────────────────────────────────────────────────────────────────────────
// NIFTY 500 — top 500 NSE listed by full market cap.
// We compose it as: NIFTY100 + MIDCAP100 + SMALLCAP100 (=300) + curated 200
// additional broad-market symbols (already covered by Yahoo). The list is
// de-duplicated and ordered with large/mid/small first, then the long tail.
// ──────────────────────────────────────────────────────────────────────────
const NIFTY500_EXTRA: string[] = [
  // Banks / NBFCs
  "SOUTHBANK","KARURVYSYA","CUB","CSBBANK","UJJIVANSFB","EQUITASBNK","UJJIVAN","SURYODAY","DHANBANK","JKBANK",
  "MAHABANK","UCOBANK","SHRIRAMFIN","SUNDARMFIN","CHOLAHLDNG","PFC","RECLTD","REPCOHOME","HOMEFIRST","APTUS",
  "MANAPPURAM","IIFL","ANANTRAJ","EDELWEISS","NAM-INDIA","ABSLAMC","UTIAMC","SHRIPISTON","CREDITACC","SPANDANA",
  // IT / Tech
  "ZENSARTECH","BIRLASOFT","SONATSOFTW","NIITLTD","ONMOBILE","NEWGEN","HAPPSTMNDS","ECLERX","RATEGAIN","MAPMYINDIA",
  "INTELLECT","RAMCOSYS","LTTS","SAREGAMA","NETWORK18","TV18BRDCST","DBCORP","JAGRAN","HATHWAY","DEN",
  // Pharma / Health
  "APLLTD","AJANTPHARM","CAPLIPOINT","GRANULES","SHILPAMED","MARKSANS","NEULANDLAB","MOREPENLAB","SUVEN",
  "HCG","KIMS","KRSNAA","YATHARTH","JUBLPHARMA","SEQUENT","STAR","HIKAL","BLISSGVS","ASTRAZEN","SANOFI",
  // Auto / Auto Anc
  "ENDURANCE","SUNDRMFAST","SUBROS","WHEELS","JTEKTINDIA","HBLENGINE","JAYAGROGN","BAJAJELEC","UNICHEMLAB","UNOMINDA",
  "MINDACORP","LUMAXIND","GABRIEL","SHARDAMOTR","FIEMIND","SUPRAJIT","RAMKY","UTKARSHBNK","ELECON","FORCEMOT",
  // Capital goods / Defence / Industrials
  "TIMKEN","SKFINDIA","ELGIEQUIP","GRINDWELL","ESABINDIA","CARBORUNIV","INOXWIND","TITAGARH","BEML","DATAPATTNS",
  "PARADEEP","RITES","IRCON","HAPPYFORGE","KIRLPNU","GREAVESCOT","ZAGGLE","RHIM","KSB","ISEC",
  // Cement / Construction / Real Estate
  "RAMCOCEM","INDIACEM","JKLAKSHMI","HEIDELBERG","BIRLACORPN","ORIENTCEM","SAGCEM","NCC","GPIL","KNRCON",
  "PNCINFRA","HGINFRA","JKIL","ITDC","SUNTECK","MAHLIFE","KOLTEPATIL","ANANTRAJ","ARVIND","BRIGADE",
  // FMCG / Consumer / Retail
  "VBL","TATACONSUM","HONASA","CCL","CCLPRODUCT","ALKYLAMINE","HERITGFOOD","KAYNES","PRSMJOHNSN","RELAXO",
  "BATAINDIA","SAFARI","CAMPUS","RAYMOND","ARVIND","WELSPUNLIV","VIPIND","PCJEWELLER","RAJESHEXPO","SENCO",
  "VAIBHAVGBL","DEVYANI","SAPPHIRE","WESTLIFE","BARBEQUE","HONDA","PARAGMILK","LAXMIORG","BAJAJCON","JYOTHYLAB",
  // Power / Energy / Renewables
  "ADANITRANS","TATAPOWER","CESC","JSWENERGY","SJVN","NHPC","INDIAGRID","POWERINDIA","KPIL","WAAREEENER",
  "WAAREERTL","INOXGREEN","KEC","SKIPPER","STERLITE","BORORENEW","ORIENTGREEN","WEBELSOLAR","CONCORDBIO","SBFC",
  // Metals / Mining / Chemicals
  "WELCORP","WELSPUNIND","RATNAMANI","JSLHISAR","HINDCOPPER","KIOCL","MOIL","GMDCLTD","SARDAEN","JINDALSAW",
  "APARINDS","GRPLTD","NAVINFLUOR","CLEAN","PIDILITIND","SUMICHEM","TATACHEM","COROMANDEL","EXCELINDUS","FACT",
  "GHCL","TATACHEMICALS","JBMA","HEG","GRAPHITE","UJJIVAN","SOMICONVEY","DCMSHRIRAM","INDOCO","NUVAMA",
  // Travel / Hospitality / Logistics
  "EASEMYTRIP","IXIGO","YATRA","THOMASCOOK","CHALET","LEMONTREE","SAMHI","TAJGVK","BLUEDART","TCI",
  "GATEWAY","ALLCARGO","MAHLOG","TVSSCS","SHIPCORP","BLACKBOX","RAILTEL","ROUTE","SUNCLAY","SBC",
  // Misc
  "CYIENTDLM","TARSONS","UPL","TATAINVEST","JINDWORLD","JCHAC","WONDERLA","NUVOCO","MEGH","SCHNEIDER",
  "GREENLAM","CENTURYTEX","RAJRATAN","AVANTIFEED","GODREJAGRO","KAVERISEED","RALLIS","ASTRAMICRO","BSOFT","ZEEL",
];

export const NIFTY500_SYMBOLS: string[] = (() => {
  const all = [
    ...NIFTY100_SYMBOLS,
    ...NIFTYMIDCAP100_SYMBOLS,
    ...NIFTYSMALLCAP100_SYMBOLS,
    ...NIFTY500_EXTRA,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of all) if (!seen.has(s)) { seen.add(s); out.push(s); }
  return out.slice(0, 500);
})();

// ──────────────────────────────────────────────────────────────────────────
// Display name lookup
// ──────────────────────────────────────────────────────────────────────────
const NAMES: Record<string, string> = {
  "M&M": "Mahindra & Mahindra",
  "BAJAJ-AUTO": "Bajaj Auto",
  "L&TFH": "L&T Finance",
  "M&MFIN": "M&M Financial Services",
  "ICICIGI": "ICICI Lombard General Insurance",
  "ICICIPRULI": "ICICI Prudential Life",
  "LICI": "Life Insurance Corporation of India",
  "JIOFIN": "Jio Financial Services",
  "ADANIENSOL": "Adani Energy Solutions",
  "ADANIENT": "Adani Enterprises",
  "ADANIPORTS": "Adani Ports & SEZ",
  "ADANIGREEN": "Adani Green Energy",
  "ADANIPOWER": "Adani Power",
  "ATGL": "Adani Total Gas",
  "ADANITRANS": "Adani Transmission",
  "DMART": "Avenue Supermarts (DMart)",
  "NAUKRI": "Info Edge (Naukri)",
  "PFC": "Power Finance Corp",
  "RECLTD": "REC Limited",
  "PNB": "Punjab National Bank",
  "BANKBARODA": "Bank of Baroda",
  "CANBK": "Canara Bank",
  "UNIONBANK": "Union Bank of India",
  "BANKINDIA": "Bank of India",
  "CENTRALBK": "Central Bank of India",
  "IOB": "Indian Overseas Bank",
  "IDBI": "IDBI Bank",
  "MAHABANK": "Bank of Maharashtra",
  "UCOBANK": "UCO Bank",
  "JKBANK": "Jammu & Kashmir Bank",
  "DHANBANK": "Dhanlaxmi Bank",
  "SOUTHBANK": "South Indian Bank",
  "KARURVYSYA": "Karur Vysya Bank",
  "CUB": "City Union Bank",
  "CSBBANK": "CSB Bank",
  "UJJIVANSFB": "Ujjivan Small Finance Bank",
  "EQUITASBNK": "Equitas Small Finance Bank",
  "UJJIVAN": "Ujjivan Financial Services",
  "SURYODAY": "Suryoday Small Finance Bank",
  "FEDERALBNK": "Federal Bank",
  "IDFCFIRSTB": "IDFC First Bank",
  "BANDHANBNK": "Bandhan Bank",
  "RBLBANK": "RBL Bank",
  "YESBANK": "Yes Bank",
  "AUBANK": "AU Small Finance Bank",
  "SAIL": "Steel Authority of India",
  "BHEL": "Bharat Heavy Electricals",
  "GAIL": "GAIL India",
  "IOC": "Indian Oil Corp",
  "HINDPETRO": "Hindustan Petroleum",
  "BPCL": "Bharat Petroleum",
  "ONGC": "Oil & Natural Gas Corp",
  "OIL": "Oil India",
  "IGL": "Indraprastha Gas",
  "MGL": "Mahanagar Gas",
  "GUJGASLTD": "Gujarat Gas",
  "HUDCO": "Housing & Urban Development",
  "IRFC": "Indian Railway Finance Corp",
  "IRCON": "Ircon International",
  "RVNL": "Rail Vikas Nigam",
  "RITES": "RITES Limited",
  "RAILTEL": "RailTel Corp of India",
  "IRCTC": "Indian Railway Catering & Tourism Corp",
  "CONCOR": "Container Corp of India",
  "MAZDOCK": "Mazagon Dock Shipbuilders",
  "GRSE": "Garden Reach Shipbuilders",
  "BEL": "Bharat Electronics",
  "HAL": "Hindustan Aeronautics",
  "BEML": "BEML Limited",
  "DATAPATTNS": "Data Patterns India",
  "SOLARINDS": "Solar Industries",
  "CGPOWER": "CG Power & Industrial Solutions",
  "POLYCAB": "Polycab India",
  "HAVELLS": "Havells India",
  "VBL": "Varun Beverages",
  "UNITDSPR": "United Spirits",
  "UBL": "United Breweries",
  "MARICO": "Marico",
  "DABUR": "Dabur India",
  "GODREJCP": "Godrej Consumer Products",
  "COLPAL": "Colgate-Palmolive India",
  "PIDILITIND": "Pidilite Industries",
  "BERGEPAINT": "Berger Paints",
  "AMBUJACEM": "Ambuja Cements",
  "DALBHARAT": "Dalmia Bharat",
  "JKCEMENT": "JK Cement",
  "JKLAKSHMI": "JK Lakshmi Cement",
  "RAMCOCEM": "Ramco Cements",
  "INDIACEM": "India Cements",
  "HEIDELBERG": "HeidelbergCement India",
  "BIRLACORPN": "Birla Corporation",
  "ORIENTCEM": "Orient Cement",
  "SAGCEM": "Sagar Cements",
  "ACC": "ACC Limited",
  "STARCEMENT": "Star Cement",
  "NUVOCO": "Nuvoco Vistas",
  "ABCAPITAL": "Aditya Birla Capital",
  "ABFRL": "Aditya Birla Fashion & Retail",
  "BAJAJHLDNG": "Bajaj Holdings & Investment",
  "INDUSTOWER": "Indus Towers",
  "IDEA": "Vodafone Idea",
  "POLICYBZR": "PB Fintech (Policybazaar)",
  "PAYTM": "One 97 Communications (Paytm)",
  "ZOMATO": "Zomato (Eternal)",
  "NYKAA": "FSN E-Commerce (Nykaa)",
  "DELHIVERY": "Delhivery",
  "TATATECH": "Tata Technologies",
  "TATACOMM": "Tata Communications",
  "TATAELXSI": "Tata Elxsi",
  "TATAINVEST": "Tata Investment Corp",
  "TATAPOWER": "Tata Power",
  "ABB": "ABB India",
  "SIEMENS": "Siemens India",
  "POWERINDIA": "Hitachi Energy India",
  "CUMMINSIND": "Cummins India",
  "BHARATFORG": "Bharat Forge",
  "ASHOKLEY": "Ashok Leyland",
  "ESCORTS": "Escorts Kubota",
  "EXIDEIND": "Exide Industries",
  "BALKRISIND": "Balkrishna Industries",
  "BOSCHLTD": "Bosch Limited",
  "MOTHERSON": "Samvardhana Motherson",
  "MRF": "MRF Limited",
  "TIINDIA": "Tube Investments of India",
  "TUBEINVEST": "Tube Investments of India",
  "SONACOMS": "Sona BLW Precision Forgings",
  "ENDURANCE": "Endurance Technologies",
  "SUNDRMFAST": "Sundram Fasteners",
  "DIXON": "Dixon Technologies",
  "KAYNES": "Kaynes Technology India",
  "KPITTECH": "KPIT Technologies",
  "PERSISTENT": "Persistent Systems",
  "COFORGE": "Coforge",
  "MPHASIS": "Mphasis",
  "OFSS": "Oracle Financial Services",
  "LTIM": "LTIMindtree",
  "LTTS": "L&T Technology Services",
  "INDIGO": "InterGlobe Aviation (IndiGo)",
  "INDHOTEL": "Indian Hotels Co",
  "TRENT": "Trent (Tata Group)",
  "PAGEIND": "Page Industries",
  "JUBLFOOD": "Jubilant FoodWorks",
  "DEVYANI": "Devyani International",
  "SAPPHIRE": "Sapphire Foods India",
  "WESTLIFE": "Westlife Foodworld",
  "BIKAJI": "Bikaji Foods",
  "VOLTAS": "Voltas",
  "BLUESTARCO": "Blue Star",
  "WHIRLPOOL": "Whirlpool of India",
  "FORTIS": "Fortis Healthcare",
  "MAXHEALTH": "Max Healthcare",
  "ASTERDM": "Aster DM Healthcare",
  "GLAND": "Gland Pharma",
  "ABBOTINDIA": "Abbott India",
  "MANKIND": "Mankind Pharma",
  "ZYDUSLIFE": "Zydus Lifesciences",
  "TORNTPHARM": "Torrent Pharmaceuticals",
  "TORNTPOWER": "Torrent Power",
  "AUROPHARMA": "Aurobindo Pharma",
  "BIOCON": "Biocon",
  "LUPIN": "Lupin",
  "ALKEM": "Alkem Laboratories",
  "IPCALAB": "Ipca Laboratories",
  "GLENMARK": "Glenmark Pharmaceuticals",
  "LAURUSLABS": "Laurus Labs",
  "JBCHEPHARM": "JB Chemicals & Pharma",
  "ERIS": "Eris Lifesciences",
  "NATCOPHARM": "Natco Pharma",
  "SYNGENE": "Syngene International",
  "PEL": "Piramal Enterprises",
  "PIIND": "PI Industries",
  "DEEPAKNTR": "Deepak Nitrite",
  "FLUOROCHEM": "Gujarat Fluorochemicals",
  "SRF": "SRF Limited",
  "ATUL": "Atul Limited",
  "AARTIIND": "Aarti Industries",
  "GNFC": "Gujarat Narmada Valley Fert",
  "CHAMBLFERT": "Chambal Fertilisers",
  "EIDPARRY": "EID Parry (India)",
  "BALRAMCHIN": "Balrampur Chini Mills",
  "TRIDENT": "Trident Limited",
  "KPRMILL": "KPR Mill",
  "PGHL": "Procter & Gamble Health",
  "GILLETTE": "Gillette India",
  "RADICO": "Radico Khaitan",
  "JYOTHYLAB": "Jyothy Labs",
  "VEDL": "Vedanta",
  "JINDALSTEL": "Jindal Steel & Power",
  "JSL": "Jindal Stainless",
  "JSWENERGY": "JSW Energy",
  "NHPC": "NHPC Limited",
  "NLCINDIA": "NLC India",
  "SJVN": "SJVN Limited",
  "PETRONET": "Petronet LNG",
  "GSPL": "Gujarat State Petronet",
  "NMDC": "NMDC Limited",
  "NATIONALUM": "National Aluminium (NALCO)",
  "HINDCOPPER": "Hindustan Copper",
  "RATNAMANI": "Ratnamani Metals & Tubes",
  "APLAPOLLO": "APL Apollo Tubes",
  "WELCORP": "Welspun Corp",
  "WELSPUNIND": "Welspun Living",
  "WELSPUNLIV": "Welspun Living",
  "DLF": "DLF Limited",
  "GODREJPROP": "Godrej Properties",
  "OBEROIRLTY": "Oberoi Realty",
  "PRESTIGE": "Prestige Estates",
  "BRIGADE": "Brigade Enterprises",
  "PHOENIXLTD": "Phoenix Mills",
  "LODHA": "Macrotech Developers (Lodha)",
  "SOBHA": "Sobha Limited",
  "SUNTECK": "Sunteck Realty",
  "MAHLIFE": "Mahindra Lifespace Developers",
  "KOLTEPATIL": "Kolte-Patil Developers",
  "ANANTRAJ": "Anant Raj",
  "PNBHOUSING": "PNB Housing Finance",
  "LICHSGFIN": "LIC Housing Finance",
  "MUTHOOTFIN": "Muthoot Finance",
  "MFSL": "Max Financial Services",
  "POONAWALLA": "Poonawalla Fincorp",
  "STARHEALTH": "Star Health Insurance",
  "MOTILALOFS": "Motilal Oswal Financial",
  "ANGELONE": "Angel One",
  "JMFINANCIL": "JM Financial",
  "CAMS": "Computer Age Management Services",
  "KFINTECH": "KFin Technologies",
  "BSE": "BSE Limited",
  "MCX": "Multi Commodity Exchange",
  "CDSL": "Central Depository Services",
  "IEX": "Indian Energy Exchange",
  "GICRE": "General Insurance Corp",
  "CRISIL": "CRISIL Limited",
  "GMRINFRA": "GMR Airports Infrastructure",
  "NBCC": "NBCC India",
  "NCC": "NCC Limited",
  "KEC": "KEC International",
  "HFCL": "HFCL Limited",
  "HBLPOWER": "HBL Power Systems",
  "TANLA": "Tanla Platforms",
  "MASTEK": "Mastek Limited",
  "INTELLECT": "Intellect Design Arena",
  "BSOFT": "BirlaSoft",
  "BIRLASOFT": "BirlaSoft",
  "CYIENT": "Cyient",
  "CYIENTDLM": "Cyient DLM",
  "LATENTVIEW": "Latent View Analytics",
  "JUSTDIAL": "Just Dial",
  "ROUTE": "Route Mobile",
  "TBOTEK": "TBO Tek",
  "TEJASNET": "Tejas Networks",
  "FSL": "Firstsource Solutions",
  "ELECTCAST": "Electrosteel Castings",
  "JBMA": "JBM Auto",
  "CRAFTSMAN": "Craftsman Automation",
  "SCHAEFFLER": "Schaeffler India",
  "CEATLTD": "CEAT Limited",
  "CASTROLIND": "Castrol India",
  "SCI": "Shipping Corp of India",
  "GESHIP": "Great Eastern Shipping",
  "CHENNPETRO": "Chennai Petroleum Corp",
  "GPPL": "Gujarat Pipavav Port",
  "EPL": "EPL Limited",
  "FINPIPE": "Finolex Industries",
  "FINCABLES": "Finolex Cables",
  "PRINCEPIPE": "Prince Pipes & Fittings",
  "SUPREMEIND": "Supreme Industries",
  "ASTRAL": "Astral Limited",
  "KAJARIACER": "Kajaria Ceramics",
  "BLS": "BLS International",
  "DOMS": "DOMS Industries",
  "FIVESTAR": "Five-Star Business Finance",
  "CGCL": "Capri Global Capital",
  "REDINGTON": "Redington",
  "OLECTRA": "Olectra Greentech",
  "MMTC": "MMTC Limited",
  "PCBL": "PCBL Limited (Phillips Carbon Black)",
  "SHYAMMETL": "Shyam Metalics",
  "SUNDARMFIN": "Sundaram Finance",
  "PVRINOX": "PVR Inox",
  "SUNTV": "Sun TV Network",
  "SWANENERGY": "Swan Energy",
  "GODFRYPHLP": "Godfrey Phillips India",
  "METROBRAND": "Metro Brands",
  "KALYANKJIL": "Kalyan Jewellers",
  "KEI": "KEI Industries",
  "THERMAX": "Thermax",
  "SYRMA": "Syrma SGS Technology",
  "AIAENG": "AIA Engineering",
  "HSCL": "Himadri Speciality Chemical",
  "LXCHEM": "Laxmi Organic Industries",
  "HONAUT": "Honeywell Automation",
  "KIRLOSBROS": "Kirloskar Brothers",
  "KIRLOSENG": "Kirloskar Oil Engines",
  "HDFCAMC": "HDFC Asset Management",
  "NUVAMA": "Nuvama Wealth Management",
  "ABSLAMC": "Aditya Birla Sun Life AMC",
  "UTIAMC": "UTI Asset Management",
  "NAM-INDIA": "Nippon Life India AMC",
  "FACT": "Fertilisers and Chemicals Travancore",
  "ENGINERSIN": "Engineers India",
  "SUZLON": "Suzlon Energy",
  "INOXWIND": "Inox Wind",
  "WAAREEENER": "Waaree Energies",
  "WAAREERTL": "Waaree Renewable Technologies",
  "INOXGREEN": "Inox Green Energy Services",
  "ZENSARTECH": "Zensar Technologies",
  "SONATSOFTW": "Sonata Software",
  "NEWGEN": "Newgen Software",
  "HAPPSTMNDS": "Happiest Minds Technologies",
  "ECLERX": "eClerx Services",
  "MAPMYINDIA": "C.E. Info Systems (MapmyIndia)",
  "RATEGAIN": "Rategain Travel Technologies",
  "RAMCOSYS": "Ramco Systems",
  "SAREGAMA": "Saregama India",
  "NETWORK18": "Network18 Media",
  "TV18BRDCST": "TV18 Broadcast",
  "ZEEL": "Zee Entertainment Enterprises",
  "DBCORP": "D B Corp",
  "JAGRAN": "Jagran Prakashan",
  "HATHWAY": "Hathway Cable & Datacom",
  "DEN": "Den Networks",
  "EASEMYTRIP": "EaseMyTrip",
  "IXIGO": "Le Travenues Technology (ixigo)",
  "YATRA": "Yatra Online",
  "THOMASCOOK": "Thomas Cook (India)",
  "CHALET": "Chalet Hotels",
  "LEMONTREE": "Lemon Tree Hotels",
  "SAMHI": "Samhi Hotels",
  "TAJGVK": "Taj GVK Hotels & Resorts",
  "BLUEDART": "Blue Dart Express",
  "TCI": "Transport Corp of India",
  "GATEWAY": "Gateway Distriparks",
  "ALLCARGO": "Allcargo Logistics",
  "MAHLOG": "Mahindra Logistics",
  "TVSSCS": "TVS Supply Chain Solutions",
  "BLACKBOX": "Black Box",
  "APLLTD": "Alembic Pharmaceuticals",
  "AJANTPHARM": "Ajanta Pharma",
  "CAPLIPOINT": "Caplin Point Laboratories",
  "GRANULES": "Granules India",
  "SHILPAMED": "Shilpa Medicare",
  "MARKSANS": "Marksans Pharma",
  "NEULANDLAB": "Neuland Laboratories",
  "MOREPENLAB": "Morepen Laboratories",
  "SUVEN": "Suven Pharmaceuticals",
  "HCG": "HealthCare Global Enterprises",
  "KIMS": "Krishna Institute of Medical Sciences",
  "KRSNAA": "Krsnaa Diagnostics",
  "YATHARTH": "Yatharth Hospital",
  "JUBLPHARMA": "Jubilant Pharmova",
  "SEQUENT": "Sequent Scientific",
  "ASTRAZEN": "AstraZeneca Pharma India",
  "SANOFI": "Sanofi India",
  "BATAINDIA": "Bata India",
  "RELAXO": "Relaxo Footwears",
  "CAMPUS": "Campus Activewear",
  "SAFARI": "Safari Industries",
  "VIPIND": "VIP Industries",
  "RAYMOND": "Raymond",
  "ARVIND": "Arvind Limited",
  "PCJEWELLER": "PC Jeweller",
  "SENCO": "Senco Gold",
  "TIMKEN": "Timken India",
  "SKFINDIA": "SKF India",
  "ELGIEQUIP": "Elgi Equipments",
  "GRINDWELL": "Grindwell Norton",
  "ESABINDIA": "ESAB India",
  "CARBORUNIV": "Carborundum Universal",
  "TITAGARH": "Titagarh Rail Systems",
  "PARADEEP": "Paradeep Phosphates",
  "GREAVESCOT": "Greaves Cotton",
  "RHIM": "RHI Magnesita India",
  "KSB": "KSB Limited",
  "ISEC": "ICICI Securities",
  "EDELWEISS": "Edelweiss Financial Services",
  "MANAPPURAM": "Manappuram Finance",
  "IIFL": "IIFL Finance",
  "REPCOHOME": "Repco Home Finance",
  "HOMEFIRST": "Home First Finance",
  "APTUS": "Aptus Value Housing Finance",
  "SHRIPISTON": "Shriram Pistons & Rings",
  "CREDITACC": "CreditAccess Grameen",
  "SPANDANA": "Spandana Sphoorty Financial",
  "KIRLPNU": "Kirloskar Pneumatic",
  "ZAGGLE": "Zaggle Prepaid Ocean Services",
  "PNCINFRA": "PNC Infratech",
  "HGINFRA": "H.G. Infra Engineering",
  "JKIL": "J Kumar Infraprojects",
  "KNRCON": "KNR Constructions",
  "ITDC": "Indian Tourism Development Corp",
  "GPIL": "Godawari Power & Ispat",
  "JINDALSAW": "Jindal Saw",
  "GREENLAM": "Greenlam Industries",
  "CENTURYTEX": "Century Textiles & Industries",
  "RAJRATAN": "Rajratan Global Wire",
  "AVANTIFEED": "Avanti Feeds",
  "GODREJAGRO": "Godrej Agrovet",
  "KAVERISEED": "Kaveri Seed Company",
  "RALLIS": "Rallis India",
  "ASTRAMICRO": "Astra Microwave Products",
  "WONDERLA": "Wonderla Holidays",
  "JCHAC": "Johnson Controls-Hitachi Air Conditioning India",
  "TARSONS": "Tarsons Products",
  "CYIENT": "Cyient",
  "JSLHISAR": "Jindal Stainless (Hisar)",
  "KIOCL": "KIOCL Limited",
  "MOIL": "MOIL Limited",
  "GMDCLTD": "Gujarat Mineral Development Corp",
  "SARDAEN": "Sarda Energy & Minerals",
  "GRPLTD": "GRP Limited",
  "NAVINFLUOR": "Navin Fluorine International",
  "CLEAN": "Clean Science and Technology",
  "SUMICHEM": "Sumitomo Chemical India",
  "TATACHEM": "Tata Chemicals",
  "TATACHEMICALS": "Tata Chemicals",
  "COROMANDEL": "Coromandel International",
  "EXCELINDUS": "Excel Industries",
  "GHCL": "GHCL Limited",
  "INDOCO": "Indoco Remedies",
  "DCMSHRIRAM": "DCM Shriram",
  "HEG": "HEG Limited",
  "GRAPHITE": "Graphite India",
  "SOMICONVEY": "Somi Conveyor Beltings",
  "BLISSGVS": "Bliss GVS Pharma",
  "HIKAL": "Hikal Limited",
  "STAR": "Strides Pharma Science",
  "ALKYLAMINE": "Alkyl Amines Chemicals",
  "ALOKINDS": "Alok Industries",
  "HONASA": "Honasa Consumer (Mamaearth)",
  "CCL": "CCL Products",
  "CCLPRODUCT": "CCL Products",
  "HERITGFOOD": "Heritage Foods",
  "PRSMJOHNSN": "Prism Johnson",
  "PARAGMILK": "Parag Milk Foods",
  "LAXMIORG": "Laxmi Organic Industries",
  "BAJAJCON": "Bajaj Consumer Care",
  "BAJAJELEC": "Bajaj Electricals",
  "STERLITE": "Sterlite Technologies",
  "SKIPPER": "Skipper Limited",
  "BORORENEW": "Borosil Renewables",
  "ORIENTGREEN": "Orient Green Power",
  "WEBELSOLAR": "Websol Energy System",
  "CONCORDBIO": "Concord Biotech",
  "SBFC": "SBFC Finance",
  "CHOLAHLDNG": "Cholamandalam Financial Holdings",
  "SCHNEIDER": "Schneider Electric Infrastructure",
  "INDIAGRID": "India Grid Trust (IndiGrid)",
  "KPIL": "Kalpataru Projects International",
  "JINDWORLD": "Jindal Worldwide",
  "MEGH": "Megha Engineering",
  "NUVOCO": "Nuvoco Vistas Corp",
  "FIEMIND": "Fiem Industries",
  "FORCEMOT": "Force Motors",
  "GABRIEL": "Gabriel India",
  "JTEKTINDIA": "JTEKT India",
  "JAYAGROGN": "Jay Bharat Maruti",
  "WHEELS": "Wheels India",
  "SHARDAMOTR": "Shardamotor Industries",
  "SUBROS": "Subros Limited",
  "SUNDRMFAST": "Sundram Fasteners",
  "SUPRAJIT": "Suprajit Engineering",
  "MINDACORP": "Minda Corporation",
  "LUMAXIND": "Lumax Industries",
  "UNOMINDA": "UNO Minda",
  "UNICHEMLAB": "Unichem Laboratories",
  "RAMKY": "Ramky Infrastructure",
  "UTKARSHBNK": "Utkarsh Small Finance Bank",
  "ELECON": "Elecon Engineering",
  "ONMOBILE": "OnMobile Global",
  "NIITLTD": "NIIT Learning Systems",
  "VAIBHAVGBL": "Vaibhav Global",
  "SHRIRAMFIN": "Shriram Finance",
  "RAJESHEXPO": "Rajesh Exports",
  "BARBEQUE": "Barbeque Nation Hospitality",
  "HONDA": "Honda India Power Products",
  "SHIPCORP": "Shipping Corp of India",
  "SUNCLAY": "Sundaram-Clayton",
  "SBC": "SBC Exports",
  "HAPPYFORGE": "Happy Forgings",
  "RAMKYINFRA": "Ramky Infrastructure",
  "BLACKBOX2": "Black Box Limited",
  "CCLPRODUCTS": "CCL Products",
};

export function watchlistName(symbol: string): string {
  return NAMES[symbol] ?? symbol;
}

export function getWatchlistSymbols(key: WatchlistKey): string[] {
  switch (key) {
    case "SENSEX": return SENSEX_SYMBOLS;
    case "BANKNIFTY": return BANKNIFTY_SYMBOLS;
    case "NIFTY50": return NIFTY50_SYMBOLS;
    case "NIFTY100": return NIFTY100_SYMBOLS;
    case "NIFTYMIDCAP100": return NIFTYMIDCAP100_SYMBOLS;
    case "NIFTYSMALLCAP100": return NIFTYSMALLCAP100_SYMBOLS;
    case "NIFTY500": return NIFTY500_SYMBOLS;
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Self-validation: enforce mutual exclusivity of the 3 Nifty mcap baskets,
// and assert no internal duplicates anywhere. Throws at module load if violated.
// ──────────────────────────────────────────────────────────────────────────
function assertUnique(list: string[], name: string) {
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const s of list) {
    if (seen.has(s)) dups.push(s);
    else seen.add(s);
  }
  if (dups.length) throw new Error(`[watchlistLists] ${name} has duplicates: ${dups.join(",")}`);
}

assertUnique(SENSEX_SYMBOLS, "SENSEX");
assertUnique(BANKNIFTY_SYMBOLS, "BANKNIFTY");
assertUnique(NIFTY50_SYMBOLS, "NIFTY50");
assertUnique(NIFTYNEXT50_SYMBOLS, "NIFTYNEXT50");
assertUnique(NIFTY100_SYMBOLS, "NIFTY100");
assertUnique(NIFTYMIDCAP100_SYMBOLS, "NIFTYMIDCAP100");
assertUnique(NIFTYSMALLCAP100_SYMBOLS, "NIFTYSMALLCAP100");
assertUnique(NIFTY500_SYMBOLS, "NIFTY500");

{
  const n100 = new Set(NIFTY100_SYMBOLS);
  const mid  = new Set(NIFTYMIDCAP100_SYMBOLS);
  const sml  = new Set(NIFTYSMALLCAP100_SYMBOLS);
  const midOverlap = NIFTYMIDCAP100_SYMBOLS.filter(s => n100.has(s));
  const smlOverlap = NIFTYSMALLCAP100_SYMBOLS.filter(s => n100.has(s) || mid.has(s));
  if (midOverlap.length) throw new Error(`[watchlistLists] MIDCAP100 overlaps NIFTY100: ${midOverlap.join(",")}`);
  if (smlOverlap.length) throw new Error(`[watchlistLists] SMALLCAP100 overlaps NIFTY100/MIDCAP100: ${smlOverlap.join(",")}`);
}
