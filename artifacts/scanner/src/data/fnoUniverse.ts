export interface FnoEntry {
  sym: string;
  label: string;
  sector: string;
  kind: "INDEX" | "EQUITY";
  lot?: number;
}

export const FNO_INDICES: FnoEntry[] = [
  { sym: "NIFTY",      label: "NIFTY 50",     sector: "Indices", kind: "INDEX", lot: 65 },
  { sym: "BANKNIFTY",  label: "BANK NIFTY",   sector: "Indices", kind: "INDEX", lot: 30 },
  { sym: "FINNIFTY",   label: "FIN NIFTY",    sector: "Indices", kind: "INDEX", lot: 60 },
  { sym: "MIDCPNIFTY", label: "MIDCAP NIFTY", sector: "Indices", kind: "INDEX", lot: 120 },
  { sym: "NIFTYNXT50", label: "NIFTY NEXT 50", sector: "Indices", kind: "INDEX", lot: 25 },
  { sym: "SENSEX",     label: "SENSEX",        sector: "Indices", kind: "INDEX", lot: 20 },
  { sym: "BANKEX",     label: "BANKEX",        sector: "Indices", kind: "INDEX", lot: 30 },
];

export const FNO_EQUITIES: FnoEntry[] = [
  { sym: "HDFCBANK",   label: "HDFC Bank",            sector: "Banking", kind: "EQUITY" },
  { sym: "ICICIBANK",  label: "ICICI Bank",           sector: "Banking", kind: "EQUITY" },
  { sym: "SBIN",       label: "State Bank of India",  sector: "Banking", kind: "EQUITY" },
  { sym: "AXISBANK",   label: "Axis Bank",            sector: "Banking", kind: "EQUITY" },
  { sym: "KOTAKBANK",  label: "Kotak Mahindra Bank",  sector: "Banking", kind: "EQUITY" },
  { sym: "INDUSINDBK", label: "IndusInd Bank",        sector: "Banking", kind: "EQUITY" },
  { sym: "IDFCFIRSTB", label: "IDFC First Bank",      sector: "Banking", kind: "EQUITY" },
  { sym: "FEDERALBNK", label: "Federal Bank",         sector: "Banking", kind: "EQUITY" },
  { sym: "BANKBARODA", label: "Bank of Baroda",       sector: "Banking", kind: "EQUITY" },
  { sym: "PNB",        label: "Punjab National Bank", sector: "Banking", kind: "EQUITY" },
  { sym: "CANBK",      label: "Canara Bank",          sector: "Banking", kind: "EQUITY" },
  { sym: "AUBANK",     label: "AU Small Finance",     sector: "Banking", kind: "EQUITY" },
  { sym: "BANDHANBNK", label: "Bandhan Bank",         sector: "Banking", kind: "EQUITY" },
  { sym: "RBLBANK",    label: "RBL Bank",             sector: "Banking", kind: "EQUITY" },

  { sym: "BAJFINANCE", label: "Bajaj Finance",         sector: "Financials", kind: "EQUITY" },
  { sym: "BAJAJFINSV", label: "Bajaj Finserv",         sector: "Financials", kind: "EQUITY" },
  { sym: "BAJAJHLDNG", label: "Bajaj Holdings",        sector: "Financials", kind: "EQUITY" },
  { sym: "SBILIFE",    label: "SBI Life Insurance",    sector: "Financials", kind: "EQUITY" },
  { sym: "HDFCLIFE",   label: "HDFC Life Insurance",   sector: "Financials", kind: "EQUITY" },
  { sym: "ICICIPRULI", label: "ICICI Prudential Life", sector: "Financials", kind: "EQUITY" },
  { sym: "ICICIGI",    label: "ICICI Lombard",         sector: "Financials", kind: "EQUITY" },
  { sym: "LICI",       label: "LIC of India",          sector: "Financials", kind: "EQUITY" },
  { sym: "CHOLAFIN",   label: "Cholamandalam Finance", sector: "Financials", kind: "EQUITY" },
  { sym: "MUTHOOTFIN", label: "Muthoot Finance",       sector: "Financials", kind: "EQUITY" },
  { sym: "HDFCAMC",    label: "HDFC AMC",              sector: "Financials", kind: "EQUITY" },
  { sym: "SHRIRAMFIN", label: "Shriram Finance",       sector: "Financials", kind: "EQUITY" },
  { sym: "M&MFIN",     label: "M&M Financial",         sector: "Financials", kind: "EQUITY" },
  { sym: "POONAWALLA", label: "Poonawalla Fincorp",    sector: "Financials", kind: "EQUITY" },
  { sym: "MFSL",       label: "Max Financial",         sector: "Financials", kind: "EQUITY" },
  { sym: "SBICARD",    label: "SBI Cards",             sector: "Financials", kind: "EQUITY" },
  { sym: "RECLTD",     label: "REC Limited",           sector: "Financials", kind: "EQUITY" },
  { sym: "PFC",        label: "Power Finance Corp",    sector: "Financials", kind: "EQUITY" },
  { sym: "IRFC",       label: "Indian Rly Finance",    sector: "Financials", kind: "EQUITY" },
  { sym: "JIOFIN",     label: "Jio Financial",         sector: "Financials", kind: "EQUITY" },
  { sym: "ABCAPITAL",  label: "Aditya Birla Capital",  sector: "Financials", kind: "EQUITY" },
  { sym: "ANGELONE",   label: "Angel One",             sector: "Financials", kind: "EQUITY" },
  { sym: "CDSL",       label: "CDSL",                  sector: "Financials", kind: "EQUITY" },
  { sym: "POLICYBZR",  label: "PB Fintech",            sector: "Financials", kind: "EQUITY" },
  { sym: "MCX",        label: "Multi Commodity Exch",  sector: "Financials", kind: "EQUITY" },

  { sym: "TCS",       label: "TCS",                sector: "IT", kind: "EQUITY" },
  { sym: "INFY",      label: "Infosys",            sector: "IT", kind: "EQUITY" },
  { sym: "WIPRO",     label: "Wipro",              sector: "IT", kind: "EQUITY" },
  { sym: "HCLTECH",   label: "HCL Technologies",   sector: "IT", kind: "EQUITY" },
  { sym: "TECHM",     label: "Tech Mahindra",      sector: "IT", kind: "EQUITY" },
  { sym: "LTIM",      label: "LTIMindtree",        sector: "IT", kind: "EQUITY" },
  { sym: "MPHASIS",   label: "Mphasis",            sector: "IT", kind: "EQUITY" },
  { sym: "PERSISTENT",label: "Persistent Systems", sector: "IT", kind: "EQUITY" },
  { sym: "COFORGE",   label: "Coforge",            sector: "IT", kind: "EQUITY" },
  { sym: "KPITTECH",  label: "KPIT Technologies",  sector: "IT", kind: "EQUITY" },
  { sym: "TATAELXSI", label: "Tata Elxsi",         sector: "IT", kind: "EQUITY" },
  { sym: "OFSS",      label: "Oracle Financial",   sector: "IT", kind: "EQUITY" },
  { sym: "BSOFT",     label: "Birlasoft",          sector: "IT", kind: "EQUITY" },
  { sym: "CYIENT",    label: "Cyient",             sector: "IT", kind: "EQUITY" },

  { sym: "RELIANCE",  label: "Reliance Industries", sector: "Energy", kind: "EQUITY" },
  { sym: "ONGC",      label: "ONGC",                sector: "Energy", kind: "EQUITY" },
  { sym: "BPCL",      label: "BPCL",                sector: "Energy", kind: "EQUITY" },
  { sym: "IOC",       label: "Indian Oil",          sector: "Energy", kind: "EQUITY" },
  { sym: "HINDPETRO", label: "Hindustan Petroleum", sector: "Energy", kind: "EQUITY" },
  { sym: "GAIL",      label: "GAIL India",          sector: "Energy", kind: "EQUITY" },
  { sym: "PETRONET",  label: "Petronet LNG",        sector: "Energy", kind: "EQUITY" },
  { sym: "IGL",       label: "Indraprastha Gas",    sector: "Energy", kind: "EQUITY" },
  { sym: "GUJGASLTD", label: "Gujarat Gas",         sector: "Energy", kind: "EQUITY" },
  { sym: "MGL",       label: "Mahanagar Gas",       sector: "Energy", kind: "EQUITY" },
  { sym: "COALINDIA", label: "Coal India",          sector: "Energy", kind: "EQUITY" },
  { sym: "NTPC",      label: "NTPC",                sector: "Energy", kind: "EQUITY" },
  { sym: "POWERGRID", label: "Power Grid",          sector: "Energy", kind: "EQUITY" },
  { sym: "TATAPOWER", label: "Tata Power",          sector: "Energy", kind: "EQUITY" },
  { sym: "ADANIPOWER",label: "Adani Power",         sector: "Energy", kind: "EQUITY" },
  { sym: "ADANIGREEN",label: "Adani Green",         sector: "Energy", kind: "EQUITY" },
  { sym: "ADANIENSOL",label: "Adani Energy Soln",   sector: "Energy", kind: "EQUITY" },
  { sym: "JSWENERGY", label: "JSW Energy",          sector: "Energy", kind: "EQUITY" },
  { sym: "NHPC",      label: "NHPC",                sector: "Energy", kind: "EQUITY" },

  { sym: "MARUTI",     label: "Maruti Suzuki",        sector: "Auto", kind: "EQUITY" },
  { sym: "M&M",        label: "Mahindra & Mahindra",  sector: "Auto", kind: "EQUITY" },
  { sym: "TATAMOTORS", label: "Tata Motors",          sector: "Auto", kind: "EQUITY" },
  { sym: "BAJAJ-AUTO", label: "Bajaj Auto",           sector: "Auto", kind: "EQUITY" },
  { sym: "HEROMOTOCO", label: "Hero MotoCorp",        sector: "Auto", kind: "EQUITY" },
  { sym: "EICHERMOT",  label: "Eicher Motors",        sector: "Auto", kind: "EQUITY" },
  { sym: "TVSMOTOR",   label: "TVS Motor",            sector: "Auto", kind: "EQUITY" },
  { sym: "ASHOKLEY",   label: "Ashok Leyland",        sector: "Auto", kind: "EQUITY" },
  { sym: "MOTHERSON",  label: "Samvardhana Motherson",sector: "Auto", kind: "EQUITY" },
  { sym: "BOSCHLTD",   label: "Bosch",                sector: "Auto", kind: "EQUITY" },
  { sym: "BHARATFORG", label: "Bharat Forge",         sector: "Auto", kind: "EQUITY" },
  { sym: "BALKRISIND", label: "Balkrishna Industries",sector: "Auto", kind: "EQUITY" },
  { sym: "ESCORTS",    label: "Escorts Kubota",       sector: "Auto", kind: "EQUITY" },
  { sym: "EXIDEIND",   label: "Exide Industries",     sector: "Auto", kind: "EQUITY" },
  { sym: "MRF",        label: "MRF",                  sector: "Auto", kind: "EQUITY" },
  { sym: "APOLLOTYRE", label: "Apollo Tyres",         sector: "Auto", kind: "EQUITY" },
  { sym: "SONACOMS",   label: "Sona Comstar",         sector: "Auto", kind: "EQUITY" },
  { sym: "TIINDIA",    label: "Tube Investments",     sector: "Auto", kind: "EQUITY" },

  { sym: "SUNPHARMA",  label: "Sun Pharma",        sector: "Pharma", kind: "EQUITY" },
  { sym: "DRREDDY",    label: "Dr Reddy's Labs",   sector: "Pharma", kind: "EQUITY" },
  { sym: "CIPLA",      label: "Cipla",             sector: "Pharma", kind: "EQUITY" },
  { sym: "DIVISLAB",   label: "Divi's Labs",       sector: "Pharma", kind: "EQUITY" },
  { sym: "LUPIN",      label: "Lupin",             sector: "Pharma", kind: "EQUITY" },
  { sym: "TORNTPHARM", label: "Torrent Pharma",    sector: "Pharma", kind: "EQUITY" },
  { sym: "ZYDUSLIFE",  label: "Zydus Lifesciences",sector: "Pharma", kind: "EQUITY" },
  { sym: "AUROPHARMA", label: "Aurobindo Pharma",  sector: "Pharma", kind: "EQUITY" },
  { sym: "ALKEM",      label: "Alkem Labs",        sector: "Pharma", kind: "EQUITY" },
  { sym: "GLENMARK",   label: "Glenmark Pharma",   sector: "Pharma", kind: "EQUITY" },
  { sym: "BIOCON",     label: "Biocon",            sector: "Pharma", kind: "EQUITY" },
  { sym: "LAURUSLABS", label: "Laurus Labs",       sector: "Pharma", kind: "EQUITY" },
  { sym: "SYNGENE",    label: "Syngene",           sector: "Pharma", kind: "EQUITY" },
  { sym: "JUBLPHARMA", label: "Jubilant Pharmova", sector: "Pharma", kind: "EQUITY" },
  { sym: "APOLLOHOSP", label: "Apollo Hospitals",  sector: "Pharma", kind: "EQUITY" },
  { sym: "MAXHEALTH",  label: "Max Healthcare",    sector: "Pharma", kind: "EQUITY" },
  { sym: "FORTIS",     label: "Fortis Healthcare", sector: "Pharma", kind: "EQUITY" },

  { sym: "HINDUNILVR", label: "Hindustan Unilever", sector: "FMCG", kind: "EQUITY" },
  { sym: "ITC",        label: "ITC",                sector: "FMCG", kind: "EQUITY" },
  { sym: "NESTLEIND",  label: "Nestle India",       sector: "FMCG", kind: "EQUITY" },
  { sym: "BRITANNIA",  label: "Britannia",          sector: "FMCG", kind: "EQUITY" },
  { sym: "TATACONSUM", label: "Tata Consumer",      sector: "FMCG", kind: "EQUITY" },
  { sym: "GODREJCP",   label: "Godrej Consumer",    sector: "FMCG", kind: "EQUITY" },
  { sym: "DABUR",      label: "Dabur India",        sector: "FMCG", kind: "EQUITY" },
  { sym: "COLPAL",     label: "Colgate Palmolive",  sector: "FMCG", kind: "EQUITY" },
  { sym: "MARICO",     label: "Marico",             sector: "FMCG", kind: "EQUITY" },
  { sym: "VBL",        label: "Varun Beverages",    sector: "FMCG", kind: "EQUITY" },
  { sym: "UNITDSPR",   label: "United Spirits",     sector: "FMCG", kind: "EQUITY" },
  { sym: "JUBLFOOD",   label: "Jubilant FoodWorks", sector: "FMCG", kind: "EQUITY" },
  { sym: "PAGEIND",    label: "Page Industries",    sector: "FMCG", kind: "EQUITY" },

  { sym: "TATASTEEL", label: "Tata Steel",          sector: "Metals", kind: "EQUITY" },
  { sym: "JSWSTEEL",  label: "JSW Steel",           sector: "Metals", kind: "EQUITY" },
  { sym: "HINDALCO",  label: "Hindalco",            sector: "Metals", kind: "EQUITY" },
  { sym: "VEDL",      label: "Vedanta",             sector: "Metals", kind: "EQUITY" },
  { sym: "JINDALSTEL",label: "Jindal Steel",        sector: "Metals", kind: "EQUITY" },
  { sym: "SAIL",      label: "SAIL",                sector: "Metals", kind: "EQUITY" },
  { sym: "NATIONALUM",label: "National Aluminium",  sector: "Metals", kind: "EQUITY" },
  { sym: "HINDCOPPER",label: "Hindustan Copper",    sector: "Metals", kind: "EQUITY" },
  { sym: "NMDC",      label: "NMDC",                sector: "Metals", kind: "EQUITY" },
  { sym: "RAJESHEXPO",label: "Rajesh Exports",      sector: "Metals", kind: "EQUITY" },

  { sym: "ULTRACEMCO",label: "UltraTech Cement",  sector: "Cement", kind: "EQUITY" },
  { sym: "GRASIM",    label: "Grasim",            sector: "Cement", kind: "EQUITY" },
  { sym: "AMBUJACEM", label: "Ambuja Cements",    sector: "Cement", kind: "EQUITY" },
  { sym: "ACC",       label: "ACC",               sector: "Cement", kind: "EQUITY" },
  { sym: "DALBHARAT", label: "Dalmia Bharat",     sector: "Cement", kind: "EQUITY" },
  { sym: "SHREECEM",  label: "Shree Cement",      sector: "Cement", kind: "EQUITY" },
  { sym: "JKCEMENT",  label: "JK Cement",         sector: "Cement", kind: "EQUITY" },
  { sym: "RAMCOCEM",  label: "Ramco Cements",     sector: "Cement", kind: "EQUITY" },

  { sym: "LT",         label: "Larsen & Toubro",     sector: "Capital Goods", kind: "EQUITY" },
  { sym: "SIEMENS",    label: "Siemens India",       sector: "Capital Goods", kind: "EQUITY" },
  { sym: "ABB",        label: "ABB India",           sector: "Capital Goods", kind: "EQUITY" },
  { sym: "BHEL",       label: "BHEL",                sector: "Capital Goods", kind: "EQUITY" },
  { sym: "BEL",        label: "Bharat Electronics",  sector: "Capital Goods", kind: "EQUITY" },
  { sym: "HAL",        label: "Hindustan Aeronautics",sector: "Capital Goods", kind: "EQUITY" },
  { sym: "MAZDOCK",    label: "Mazagon Dock",        sector: "Capital Goods", kind: "EQUITY" },
  { sym: "CUMMINSIND", label: "Cummins India",       sector: "Capital Goods", kind: "EQUITY" },
  { sym: "CGPOWER",    label: "CG Power",            sector: "Capital Goods", kind: "EQUITY" },
  { sym: "POLYCAB",    label: "Polycab India",       sector: "Capital Goods", kind: "EQUITY" },
  { sym: "KEI",        label: "KEI Industries",      sector: "Capital Goods", kind: "EQUITY" },
  { sym: "HAVELLS",    label: "Havells",             sector: "Capital Goods", kind: "EQUITY" },
  { sym: "VOLTAS",     label: "Voltas",              sector: "Capital Goods", kind: "EQUITY" },
  { sym: "BLUESTARCO", label: "Blue Star",           sector: "Capital Goods", kind: "EQUITY" },
  { sym: "DIXON",      label: "Dixon Technologies",  sector: "Capital Goods", kind: "EQUITY" },
  { sym: "HONAUT",     label: "Honeywell Automation",sector: "Capital Goods", kind: "EQUITY" },
  { sym: "SUPREMEIND", label: "Supreme Industries",  sector: "Capital Goods", kind: "EQUITY" },
  { sym: "ASTRAL",     label: "Astral",              sector: "Capital Goods", kind: "EQUITY" },

  { sym: "DLF",         label: "DLF",               sector: "Realty", kind: "EQUITY" },
  { sym: "GODREJPROP",  label: "Godrej Properties", sector: "Realty", kind: "EQUITY" },
  { sym: "OBEROIRLTY",  label: "Oberoi Realty",     sector: "Realty", kind: "EQUITY" },
  { sym: "PRESTIGE",    label: "Prestige Estates",  sector: "Realty", kind: "EQUITY" },
  { sym: "PHOENIXLTD",  label: "Phoenix Mills",     sector: "Realty", kind: "EQUITY" },

  { sym: "BHARTIARTL", label: "Bharti Airtel",      sector: "Telecom", kind: "EQUITY" },
  { sym: "IDEA",       label: "Vodafone Idea",      sector: "Telecom", kind: "EQUITY" },
  { sym: "INDUSTOWER", label: "Indus Towers",       sector: "Telecom", kind: "EQUITY" },
  { sym: "TATACOMM",   label: "Tata Communications",sector: "Telecom", kind: "EQUITY" },

  { sym: "ASIANPAINT", label: "Asian Paints",     sector: "Paints/Chem", kind: "EQUITY" },
  { sym: "BERGEPAINT", label: "Berger Paints",    sector: "Paints/Chem", kind: "EQUITY" },
  { sym: "PIDILITIND", label: "Pidilite",         sector: "Paints/Chem", kind: "EQUITY" },
  { sym: "SRF",        label: "SRF",              sector: "Paints/Chem", kind: "EQUITY" },
  { sym: "UPL",        label: "UPL",              sector: "Paints/Chem", kind: "EQUITY" },
  { sym: "PIIND",      label: "PI Industries",    sector: "Paints/Chem", kind: "EQUITY" },
  { sym: "COROMANDEL", label: "Coromandel Intl",  sector: "Paints/Chem", kind: "EQUITY" },
  { sym: "DEEPAKNTR",  label: "Deepak Nitrite",   sector: "Paints/Chem", kind: "EQUITY" },
  { sym: "FLUOROCHEM", label: "Gujarat Fluorochem",sector:"Paints/Chem", kind: "EQUITY" },
  { sym: "NAVINFLUOR", label: "Navin Fluorine",   sector: "Paints/Chem", kind: "EQUITY" },
  { sym: "CHAMBLFERT", label: "Chambal Fertilisers",sector:"Paints/Chem", kind: "EQUITY" },
  { sym: "GNFC",       label: "GNFC",             sector: "Paints/Chem", kind: "EQUITY" },

  { sym: "TITAN",     label: "Titan Company",       sector: "Consumer/Retail", kind: "EQUITY" },
  { sym: "TRENT",     label: "Trent",               sector: "Consumer/Retail", kind: "EQUITY" },
  { sym: "DMART",     label: "Avenue Supermarts",   sector: "Consumer/Retail", kind: "EQUITY" },
  { sym: "ABFRL",     label: "Aditya Birla Fashion",sector: "Consumer/Retail", kind: "EQUITY" },
  { sym: "BATAINDIA", label: "Bata India",          sector: "Consumer/Retail", kind: "EQUITY" },
  { sym: "TRIDENT",   label: "Trident",             sector: "Consumer/Retail", kind: "EQUITY" },
  { sym: "ZOMATO",    label: "Eternal (Zomato)",    sector: "Consumer/Retail", kind: "EQUITY" },
  { sym: "NYKAA",     label: "Nykaa",               sector: "Consumer/Retail", kind: "EQUITY" },
  { sym: "PAYTM",     label: "Paytm",               sector: "Consumer/Retail", kind: "EQUITY" },
  { sym: "NAUKRI",    label: "Info Edge (Naukri)",  sector: "Consumer/Retail", kind: "EQUITY" },
  { sym: "IRCTC",     label: "IRCTC",               sector: "Consumer/Retail", kind: "EQUITY" },
  { sym: "INDIGO",    label: "InterGlobe Aviation", sector: "Consumer/Retail", kind: "EQUITY" },
  { sym: "INDHOTEL",  label: "Indian Hotels",       sector: "Consumer/Retail", kind: "EQUITY" },

  { sym: "ADANIPORTS", label: "Adani Ports",   sector: "Infra/Logistics", kind: "EQUITY" },
  { sym: "ADANIENT",   label: "Adani Enterprises",sector:"Infra/Logistics", kind: "EQUITY" },
  { sym: "GMRINFRA",   label: "GMR Airports",   sector: "Infra/Logistics", kind: "EQUITY" },
  { sym: "CONCOR",     label: "Container Corp",  sector: "Infra/Logistics", kind: "EQUITY" },
];

export const FNO_ALL: FnoEntry[] = [...FNO_INDICES, ...FNO_EQUITIES];

export const QUICK_PRESETS: FnoEntry[] = [
  FNO_INDICES[0]!, FNO_INDICES[1]!,
  FNO_INDICES.find(e => e.sym === "SENSEX")!,
  FNO_INDICES[2]!, FNO_INDICES[3]!,
  FNO_EQUITIES.find(e => e.sym === "RELIANCE")!,
  FNO_EQUITIES.find(e => e.sym === "HDFCBANK")!,
  FNO_EQUITIES.find(e => e.sym === "TCS")!,
  FNO_EQUITIES.find(e => e.sym === "ICICIBANK")!,
];

export function findFno(sym: string): FnoEntry | undefined {
  const s = sym.toUpperCase();
  return FNO_ALL.find(e => e.sym === s);
}

export function groupBySector(entries: FnoEntry[]): Array<[string, FnoEntry[]]> {
  const m = new Map<string, FnoEntry[]>();
  for (const e of entries) {
    const arr = m.get(e.sector) ?? [];
    arr.push(e);
    m.set(e.sector, arr);
  }
  return Array.from(m.entries()).sort((a, b) => {
    if (a[0] === "Indices") return -1;
    if (b[0] === "Indices") return 1;
    return a[0].localeCompare(b[0]);
  });
}
