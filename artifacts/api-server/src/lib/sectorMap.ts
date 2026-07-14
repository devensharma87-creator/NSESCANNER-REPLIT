/**
 * Sector / industry lookup for NSE equities.
 *
 * Source priority (highest to lowest):
 *   1. `universe`   — `UNIVERSE` in `lib/universe.ts` (curated, has both
 *                     sector AND industry, used by the rest of the app).
 *   2. `extension`  — curated map below covering NIFTY 500 mid/small caps
 *                     not present in `UNIVERSE` (sector + industry).
 *   3. `unknown`    — fallback. Returns `{ sector: "Unmapped",
 *                     industry: "Unmapped" }` so downstream code never has
 *                     to deal with null/undefined.
 *
 * Single chokepoint: every place that needs sector/industry for a swing
 * scan row should call `lookupSector(symbol)`. Future scans get this
 * automatically via `swingScannerStore.rowFromResult`. Backfill of
 * existing `swing_scan_result` rows uses the same function (see
 * `scripts/src/backfill-swing-sector.ts`).
 *
 * Updating the extension table:
 *   - Add a row in `EXTENSION_RAW` below.
 *   - Run `pnpm --filter @workspace/api-server run test sectorMap` to
 *     verify no duplicate symbol keys and that all sectors are
 *     non-empty.
 *   - Re-run the backfill script to pick up newly mapped symbols.
 */
import { UNIVERSE } from "./universe";

export type SectorSource = "universe" | "extension" | "unknown";

export interface SectorMapping {
  sector: string;
  industry: string;
  source: SectorSource;
}

export const UNMAPPED_SECTOR = "Unmapped";
export const UNMAPPED_INDUSTRY = "Unmapped";

/**
 * Curated extension covering NIFTY 500 mid/small caps not present in the
 * primary `UNIVERSE`. Sector/industry classifications follow standard NSE
 * sectoral index conventions (NIFTY Bank, NIFTY IT, NIFTY Pharma, etc.).
 *
 * Keep entries alphabetically sorted by symbol.
 */
const EXTENSION_RAW: ReadonlyArray<readonly [string, string, string]> = [
  ["ABBOTINDIA",   "Pharma",                 "MNC Pharma"],
  ["ABCAPITAL",    "Financials",             "NBFC"],
  ["ABFRL",        "Consumer Discretionary", "Apparel & Retail"],
  ["ADANIENSOL",   "Energy",                 "Power"],
  ["ABSLAMC",      "Financials",             "AMC"],
  ["AIAENG",       "Capital Goods",          "Industrial Equipment"],
  ["AJANTPHARM",   "Pharma",                 "Generic Pharma"],
  ["ALKYLAMINE",   "Chemicals",              "Specialty Chemicals"],
  ["ALLCARGO",     "Logistics",              "Logistics"],
  ["ANANTRAJ",     "Real Estate",            "Real Estate"],
  ["ANGELONE",     "Financials",             "Capital Markets"],
  ["APARINDS",     "Capital Goods",          "Cables"],
  ["APLLTD",       "Pharma",                 "Generic Pharma"],
  ["APTUS",        "Financials",             "Housing Finance"],
  ["ARVIND",       "Consumer Discretionary", "Textiles"],
  ["ASTERDM",      "Healthcare",             "Hospitals"],
  ["ASTRAL",       "Capital Goods",          "Plastic Pipes"],
  ["ASTRAZEN",     "Pharma",                 "MNC Pharma"],
  ["ATGL",         "Energy",                 "Gas Distribution"],
  ["ATUL",         "Chemicals",              "Specialty Chemicals"],
  ["BAJAJCON",     "FMCG",                   "Personal Care"],
  ["BAJAJELEC",    "Consumer Discretionary", "Consumer Durables"],
  ["BALRAMCHIN",   "FMCG",                   "Sugar"],
  ["BANKINDIA",    "Banking",                "Public Bank"],
  ["BIKAJI",       "FMCG",                   "Packaged Foods"],
  ["BIRLACORPN",   "Cement",                 "Cement"],
  ["BLISSGVS",     "Pharma",                 "Generic Pharma"],
  ["BLS",          "Consumer Discretionary", "Services"],
  ["BORORENEW",    "Consumer Discretionary", "Consumer Durables"],
  ["BSE",          "Financials",             "Capital Markets"],
  ["BSOFT",        "IT",                     "IT Services"],
  ["CAMPUS",       "Consumer Discretionary", "Footwear"],
  ["CAMS",         "Financials",             "Capital Markets"],
  ["CAPLIPOINT",   "Pharma",                 "Generic Pharma"],
  ["CARBORUNIV",   "Capital Goods",          "Industrial Products"],
  ["CASTROLIND",   "Energy",                 "Lubricants"],
  ["CCL",          "FMCG",                   "Beverages"],
  ["CDSL",         "Financials",             "Capital Markets"],
  ["CEATLTD",      "Auto",                   "Tyres"],
  ["CENTRALBK",    "Banking",                "Public Bank"],
  ["CESC",         "Energy",                 "Power"],
  ["CGCL",         "Financials",             "NBFC"],
  ["CGPOWER",      "Capital Goods",          "Power Equipment"],
  ["CHALET",       "Consumer Discretionary", "Hotels"],
  ["CHAMBLFERT",   "Chemicals",              "Fertilizers"],
  ["CHENNPETRO",   "Energy",                 "Refineries"],
  ["CHOLAHLDNG",   "Financials",             "Holding"],
  ["COROMANDEL",   "Chemicals",              "Fertilizers"],
  ["CLEAN",        "Chemicals",              "Specialty Chemicals"],
  ["CONCORDBIO",   "Pharma",                 "Biotech"],
  ["CRAFTSMAN",    "Capital Goods",          "Auto Components"],
  ["CREDITACC",    "Financials",             "MFI"],
  ["CRISIL",       "Financials",             "Ratings"],
  ["CSBBANK",      "Banking",                "Private Bank"],
  ["CYIENT",       "IT",                     "IT Services"],
  ["DATAPATTNS",   "Capital Goods",          "Defence"],
  ["DBCORP",       "Media",                  "Print Media"],
  ["DCMSHRIRAM",   "Chemicals",              "Diversified Chemicals"],
  ["DEN",          "Media",                  "Cable"],
  ["DHANBANK",     "Banking",                "Private Bank"],
  ["DIXON",        "Capital Goods",          "Electronics Manufacturing"],
  ["DOMS",         "Consumer Discretionary", "Stationery"],
  ["EASEMYTRIP",   "Consumer Discretionary", "Travel"],
  ["ECLERX",       "IT",                     "IT Services"],
  ["EDELWEISS",    "Financials",             "Capital Markets"],
  ["EIDPARRY",     "FMCG",                   "Sugar"],
  ["ELECON",       "Capital Goods",          "Industrial Equipment"],
  ["ELECTCAST",    "Capital Goods",          "Castings"],
  ["ELGIEQUIP",    "Capital Goods",          "Industrial Equipment"],
  ["ENDURANCE",    "Auto",                   "Auto Components"],
  ["ENGINERSIN",   "Capital Goods",          "Engineering"],
  ["EPL",          "Consumer Discretionary", "Packaging"],
  ["EQUITASBNK",   "Banking",                "Small Finance Bank"],
  ["ERIS",         "Pharma",                 "Generic Pharma"],
  ["ESABINDIA",    "Capital Goods",          "Industrial Equipment"],
  ["ESCORTS",      "Auto",                   "Tractors"],
  ["EXCELINDUS",   "Chemicals",              "Agrochemicals"],
  ["FACT",         "Chemicals",              "Fertilizers"],
  ["FIEMIND",      "Auto",                   "Auto Components"],
  ["FINCABLES",    "Capital Goods",          "Cables"],
  ["FINPIPE",      "Capital Goods",          "Plastic Pipes"],
  ["FIVESTAR",     "Financials",             "NBFC"],
  ["FLUOROCHEM",   "Chemicals",              "Specialty Chemicals"],
  ["FORCEMOT",     "Auto",                   "Commercial Vehicles"],
  ["FSL",          "IT",                     "IT Services"],
  ["GABRIEL",      "Auto",                   "Auto Components"],
  ["GATEWAY",      "Logistics",              "Logistics"],
  ["GESHIP",       "Logistics",              "Shipping"],
  ["GHCL",         "Chemicals",              "Soda Ash"],
  ["GICRE",        "Insurance",              "Reinsurance"],
  ["GILLETTE",     "FMCG",                   "Personal Care"],
  ["GLENMARK",     "Pharma",                 "Generic Pharma"],
  ["GMDCLTD",      "Metals",                 "Mining"],
  ["GNFC",         "Chemicals",              "Fertilizers"],
  ["GODFRYPHLP",   "FMCG",                   "Tobacco"],
  ["GPIL",         "Metals",                 "Steel"],
  ["GPPL",         "Logistics",              "Ports"],
  ["GRANULES",     "Pharma",                 "Generic Pharma"],
  ["GRAPHITE",     "Capital Goods",          "Graphite Electrodes"],
  ["GREAVESCOT",   "Capital Goods",          "Auto Components"],
  ["GRPLTD",       "Auto",                   "Auto Components"],
  ["GRSE",         "Capital Goods",          "Defence"],
  ["GSPL",         "Energy",                 "Gas Distribution"],
  ["GUJGASLTD",    "Energy",                 "Gas Distribution"],
  ["HAPPSTMNDS",   "IT",                     "IT Services"],
  ["HAPPYFORGE",   "Auto",                   "Auto Components"],
  ["HATHWAY",      "Media",                  "Cable"],
  ["HBLENGINE",    "Capital Goods",          "Industrial Equipment"],
  ["HCG",          "Healthcare",             "Hospitals"],
  ["HEG",          "Capital Goods",          "Graphite Electrodes"],
  ["HEIDELBERG",   "Cement",                 "Cement"],
  ["HERITGFOOD",   "FMCG",                   "Dairy"],
  ["HFCL",         "Telecom",                "Telecom Equipment"],
  ["HGINFRA",      "Construction",           "Construction"],
  ["HIKAL",        "Pharma",                 "Generic Pharma"],
  ["HINDPETRO",    "Energy",                 "Refineries"],
  ["HOMEFIRST",    "Financials",             "Housing Finance"],
  ["HONASA",       "FMCG",                   "Personal Care"],
  ["HONAUT",       "Capital Goods",          "Industrial Equipment"],
  ["HSCL",         "Construction",           "Construction"],
  ["HUDCO",        "Financials",             "Housing Finance"],
  ["IDBI",         "Banking",                "Public Bank"],
  ["IGL",          "Energy",                 "Gas Distribution"],
  ["IIFL",         "Financials",             "Capital Markets"],
  ["INDHOTEL",     "Consumer Discretionary", "Hotels"],
  ["INDIACEM",     "Cement",                 "Cement"],
  ["INDOCO",       "Pharma",                 "Generic Pharma"],
  ["INOXGREEN",    "Energy",                 "Renewable Energy"],
  ["INTELLECT",    "IT",                     "IT Services"],
  ["IOB",          "Banking",                "Public Bank"],
  ["IPCALAB",      "Pharma",                 "Generic Pharma"],
  ["ITDC",         "Consumer Discretionary", "Hotels"],
  ["IXIGO",        "Consumer Discretionary", "Travel"],
  ["JAGRAN",       "Media",                  "Print Media"],
  ["JAYAGROGN",    "Chemicals",              "Agrochemicals"],
  ["JBCHEPHARM",   "Pharma",                 "Generic Pharma"],
  ["JBMA",         "Auto",                   "Auto Components"],
  ["JINDALSAW",    "Metals",                 "Steel"],
  ["JIOFIN",       "Financials",             "NBFC"],
  ["JKIL",         "Construction",           "Construction"],
  ["JKLAKSHMI",    "Cement",                 "Cement"],
  ["JMFINANCIL",   "Financials",             "Capital Markets"],
  ["JSL",          "Metals",                 "Steel"],
  ["JTEKTINDIA",   "Auto",                   "Auto Components"],
  ["JUBLPHARMA",   "Pharma",                 "Generic Pharma"],
  ["JUSTDIAL",     "Consumer Internet",      "Internet Services"],
  ["JYOTHYLAB",    "FMCG",                   "Personal Care"],
  ["KAJARIACER",   "Consumer Discretionary", "Building Materials"],
  ["KALYANKJIL",   "Consumer Discretionary", "Jewellery"],
  ["KAYNES",       "Capital Goods",          "Electronics Manufacturing"],
  ["KEC",          "Capital Goods",          "Power Equipment"],
  ["KEI",          "Capital Goods",          "Cables"],
  ["KFINTECH",     "Financials",             "Capital Markets"],
  ["KIMS",         "Healthcare",             "Hospitals"],
  ["KIOCL",        "Metals",                 "Mining"],
  ["KIRLOSBROS",   "Capital Goods",          "Industrial Equipment"],
  ["KIRLOSENG",    "Capital Goods",          "Industrial Equipment"],
  ["KIRLPNU",      "Capital Goods",          "Industrial Equipment"],
  ["KNRCON",       "Construction",           "Construction"],
  ["KOLTEPATIL",   "Real Estate",            "Real Estate"],
  ["KPIL",         "Capital Goods",          "Power Equipment"],
  ["KPRMILL",      "Consumer Discretionary", "Textiles"],
  ["KRSNAA",       "Healthcare",             "Diagnostics"],
  ["KSB",          "Capital Goods",          "Industrial Equipment"],
  ["LATENTVIEW",   "IT",                     "Analytics"],
  ["LEMONTREE",    "Consumer Discretionary", "Hotels"],
  ["LUMAXIND",     "Auto",                   "Auto Components"],
  ["LXCHEM",       "Chemicals",              "Specialty Chemicals"],
  ["MAHABANK",     "Banking",                "Public Bank"],
  ["MAHLIFE",      "Real Estate",            "Real Estate"],
  ["MAHLOG",       "Logistics",              "Logistics"],
  ["MAPMYINDIA",   "IT",                     "IT Services"],
  ["MARKSANS",     "Pharma",                 "Generic Pharma"],
  ["MASTEK",       "IT",                     "IT Services"],
  ["MCX",          "Financials",             "Capital Markets"],
  ["METROBRAND",   "Consumer Discretionary", "Footwear"],
  ["MGL",          "Energy",                 "Gas Distribution"],
  ["MINDACORP",    "Auto",                   "Auto Components"],
  ["MMTC",         "Consumer Discretionary", "Trading"],
  ["MOIL",         "Metals",                 "Mining"],
  ["MOREPENLAB",   "Pharma",                 "Generic Pharma"],
  ["M&MFIN",       "Financials",             "NBFC"],
  ["NAM-INDIA",    "Financials",             "AMC"],
  ["NATCOPHARM",   "Pharma",                 "Generic Pharma"],
  ["NAUKRI",       "Consumer Internet",      "Internet Services"],
  ["NBCC",         "Construction",           "Construction"],
  ["NCC",          "Construction",           "Construction"],
  ["NETWORK18",    "Media",                  "Broadcasting"],
  ["NEULANDLAB",   "Pharma",                 "API"],
  ["NEWGEN",       "IT",                     "IT Services"],
  ["NIITLTD",      "IT",                     "Education"],
  ["NLCINDIA",     "Energy",                 "Power"],
  ["NUVAMA",       "Financials",             "Capital Markets"],
  ["OIL",          "Energy",                 "Oil & Gas"],
  ["OLECTRA",      "Auto",                   "Electric Vehicles"],
  ["ONMOBILE",     "Telecom",                "Telecom Services"],
  ["ORIENTCEM",    "Cement",                 "Cement"],
  ["PARADEEP",     "Chemicals",              "Fertilizers"],
  ["PARAGMILK",    "FMCG",                   "Dairy"],
  ["PATANJALI",    "FMCG",                   "Personal Care"],
  ["PCBL",         "Chemicals",              "Specialty Chemicals"],
  ["PCJEWELLER",   "Consumer Discretionary", "Jewellery"],
  ["PETRONET",     "Energy",                 "Gas Distribution"],
  ["PGHL",         "Pharma",                 "Personal Care"],
  ["PNBHOUSING",   "Financials",             "Housing Finance"],
  ["PNCINFRA",     "Construction",           "Construction"],
  ["POWERINDIA",   "Capital Goods",          "Power Equipment"],
  ["PRINCEPIPE",   "Capital Goods",          "Plastic Pipes"],
  ["PRSMJOHNSN",   "Cement",                 "Cement"],
  ["RADICO",       "FMCG",                   "Liquor"],
  ["RAJESHEXPO",   "Consumer Discretionary", "Jewellery"],
  ["RAMCOSYS",     "IT",                     "IT Services"],
  ["RAMKY",        "Construction",           "Construction"],
  ["RATEGAIN",     "IT",                     "Travel Tech"],
  ["RAYMOND",      "Consumer Discretionary", "Textiles"],
  ["REDINGTON",    "IT",                     "IT Distribution"],
  ["RELAXO",       "Consumer Discretionary", "Footwear"],
  ["REPCOHOME",    "Financials",             "Housing Finance"],
  ["RHIM",         "Capital Goods",          "Refractories"],
  ["RITES",        "Capital Goods",          "Engineering"],
  ["ROUTE",        "IT",                     "IT Services"],
  ["SAFARI",       "Consumer Discretionary", "Luggage"],
  ["SAGCEM",       "Cement",                 "Cement"],
  ["SAMHI",        "Consumer Discretionary", "Hotels"],
  ["SANOFI",       "Pharma",                 "MNC Pharma"],
  ["SAPPHIRE",     "Consumer Discretionary", "QSR"],
  ["SARDAEN",      "Metals",                 "Mining"],
  ["SAREGAMA",     "Media",                  "Music"],
  ["SBFC",         "Financials",             "NBFC"],
  ["SCHAEFFLER",   "Auto",                   "Auto Components"],
  ["SCI",          "Logistics",              "Shipping"],
  ["SENCO",        "Consumer Discretionary", "Jewellery"],
  ["SHARDAMOTR",   "Auto",                   "Auto Components"],
  ["SHILPAMED",    "Pharma",                 "Generic Pharma"],
  ["SHRIPISTON",   "Auto",                   "Auto Components"],
  ["SHRIRAMFIN",   "Financials",             "NBFC"],
  ["SHYAMMETL",    "Metals",                 "Steel"],
  ["SKFINDIA",     "Capital Goods",          "Bearings"],
  ["SKIPPER",      "Capital Goods",          "Power Equipment"],
  ["SOBHA",        "Real Estate",            "Real Estate"],
  ["SOLARINDS",    "Defence",                "Explosives"],
  ["SOMICONVEY",   "Capital Goods",          "Industrial Equipment"],
  ["SONACOMS",     "Auto",                   "Auto Components"],
  ["SONATSOFTW",   "IT",                     "IT Services"],
  ["SOUTHBANK",    "Banking",                "Private Bank"],
  ["SPANDANA",     "Financials",             "MFI"],
  ["STAR",         "Insurance",              "Health Insurance"],
  ["STARCEMENT",   "Cement",                 "Cement"],
  ["SUBROS",       "Auto",                   "Auto Components"],
  ["SUMICHEM",     "Chemicals",              "Agrochemicals"],
  ["SUNDARMFIN",   "Financials",             "NBFC"],
  ["SUNDRMFAST",   "Auto",                   "Auto Components"],
  ["SUNTECK",      "Real Estate",            "Real Estate"],
  ["SUPRAJIT",     "Auto",                   "Auto Components"],
  ["SUPREMEIND",   "Capital Goods",          "Plastic Pipes"],
  ["SURYODAY",     "Banking",                "Small Finance Bank"],
  ["SUVEN",        "Pharma",                 "CRAMS"],
  ["SYNGENE",      "Pharma",                 "CRAMS"],
  ["SYRMA",        "Capital Goods",          "Electronics Manufacturing"],
  ["TAJGVK",       "Consumer Discretionary", "Hotels"],
  ["TANLA",        "IT",                     "IT Services"],
  ["TATACHEM",     "Chemicals",              "Soda Ash"],
  ["TATACOMM",     "Telecom",                "Telecom Services"],
  ["TATAINVEST",   "Financials",             "Holding"],
  ["TATATECH",     "IT",                     "IT Services"],
  ["TBOTEK",       "IT",                     "Travel Tech"],
  ["TCI",          "Logistics",              "Logistics"],
  ["TEJASNET",     "Telecom",                "Telecom Equipment"],
  ["THERMAX",      "Capital Goods",          "Industrial Equipment"],
  ["THOMASCOOK",   "Consumer Discretionary", "Travel"],
  ["TIMKEN",       "Capital Goods",          "Bearings"],
  ["TITAGARH",     "Capital Goods",          "Wagons"],
  ["TRIDENT",      "Consumer Discretionary", "Textiles"],
  ["TVSSCS",       "Logistics",              "Logistics"],
  ["UCOBANK",      "Banking",                "Public Bank"],
  ["UJJIVANSFB",   "Banking",                "Small Finance Bank"],
  ["UNICHEMLAB",   "Pharma",                 "Generic Pharma"],
  ["UNITDSPR",     "FMCG",                   "Liquor"],
  ["UNOMINDA",     "Auto",                   "Auto Components"],
  ["UTIAMC",       "Financials",             "AMC"],
  ["UTKARSHBNK",   "Banking",                "Small Finance Bank"],
  ["VAIBHAVGBL",   "Consumer Discretionary", "E-commerce"],
  ["VIPIND",       "Consumer Discretionary", "Luggage"],
  ["WAAREEENER",   "Energy",                 "Renewable Energy"],
  ["WAAREERTL",    "Energy",                 "Renewable Energy"],
  ["WEBELSOLAR",   "Energy",                 "Renewable Energy"],
  ["WELCORP",      "Metals",                 "Steel"],
  ["WELSPUNLIV",   "Consumer Discretionary", "Textiles"],
  ["WHEELS",       "Auto",                   "Auto Components"],
  ["WHIRLPOOL",    "Consumer Discretionary", "Consumer Durables"],
  ["YATHARTH",     "Healthcare",             "Hospitals"],
  ["YATRA",        "Consumer Discretionary", "Travel"],
  ["YESBANK",      "Banking",                "Private Bank"],
  ["ZAGGLE",       "IT",                     "Fintech"],
  ["ZENSARTECH",   "IT",                     "IT Services"],
];

const EXTENSION_MAP: ReadonlyMap<string, { sector: string; industry: string }> = (() => {
  const m = new Map<string, { sector: string; industry: string }>();
  for (const [sym, sector, industry] of EXTENSION_RAW) {
    if (m.has(sym)) {
      throw new Error(`sectorMap EXTENSION duplicate symbol: ${sym}`);
    }
    if (!sector || !industry) {
      throw new Error(`sectorMap EXTENSION empty sector/industry for ${sym}`);
    }
    m.set(sym, { sector, industry });
  }
  return m;
})();

const UNIVERSE_MAP: ReadonlyMap<string, { sector: string; industry: string }> = (() => {
  const m = new Map<string, { sector: string; industry: string }>();
  for (const u of UNIVERSE) {
    if (u.sector && u.industry) {
      m.set(u.symbol, { sector: u.sector, industry: u.industry });
    }
  }
  return m;
})();

/**
 * Look up sector/industry for a single NSE symbol. Always returns a value
 * — never throws, never returns null. The `source` field tells the caller
 * which mapping table answered.
 */
export function lookupSector(symbol: string): SectorMapping {
  const key = (symbol ?? "").trim().toUpperCase();
  if (!key) {
    return { sector: UNMAPPED_SECTOR, industry: UNMAPPED_INDUSTRY, source: "unknown" };
  }
  const fromUniverse = UNIVERSE_MAP.get(key);
  if (fromUniverse) {
    return { sector: fromUniverse.sector, industry: fromUniverse.industry, source: "universe" };
  }
  const fromExt = EXTENSION_MAP.get(key);
  if (fromExt) {
    return { sector: fromExt.sector, industry: fromExt.industry, source: "extension" };
  }
  return { sector: UNMAPPED_SECTOR, industry: UNMAPPED_INDUSTRY, source: "unknown" };
}

/**
 * Aggregate coverage stats over a list of symbols. Used by the diagnostic
 * endpoint and the backfill script to report mapped/unmapped counts.
 */
export interface SectorCoverageStats {
  total: number;
  bySource: Record<SectorSource, number>;
  sectorCoveragePct: number;
  industryCoveragePct: number;
  unmapped: string[];
}

export function computeSectorCoverage(symbols: Iterable<string>): SectorCoverageStats {
  const seen = new Set<string>();
  const bySource: Record<SectorSource, number> = { universe: 0, extension: 0, unknown: 0 };
  const unmapped: string[] = [];
  for (const s of symbols) {
    const key = (s ?? "").trim().toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const m = lookupSector(key);
    bySource[m.source] += 1;
    if (m.source === "unknown") unmapped.push(key);
  }
  const total = seen.size;
  const mapped = total - bySource.unknown;
  const pct = total === 0 ? 0 : Math.round((mapped / total) * 1000) / 10;
  return {
    total,
    bySource,
    sectorCoveragePct: pct,
    industryCoveragePct: pct, // every mapped symbol gets both sector + industry
    unmapped: unmapped.sort(),
  };
}

/**
 * Internal helper for tests — exposes the size of each source table.
 */
export function _internalSectorMapSizes(): { universe: number; extension: number } {
  return { universe: UNIVERSE_MAP.size, extension: EXTENSION_MAP.size };
}
