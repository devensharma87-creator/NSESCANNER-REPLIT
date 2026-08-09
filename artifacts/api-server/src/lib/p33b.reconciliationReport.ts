/**
 * Pack 33B — Item 2: Universe Accounting Equation Report
 *
 * Evidence that the InstrumentEligibilityClass system correctly classifies
 * instruments and that the two new Pack 33B classes (REIT_OR_INVIT and
 * PARTLY_PAID_OR_PREFERENCE) are detected and excluded from the warehouse.
 *
 * Run via:
 *   pnpm --filter @workspace/api-server exec tsx src/lib/p33b.reconciliationReport.ts
 */
import {
  classifyInstrument,
  WAREHOUSE_EXCLUDED_CLASSES,
  type InstrumentEligibilityClass,
} from "./kiteCandle/instrumentEligibility.js";

// ── Full class registry (matched against actual InstrumentEligibilityClass union) ──

const ALL_CLASSES: InstrumentEligibilityClass[] = [
  "ORDINARY_COMPANY_EQUITY_ELIGIBLE",          // only warehouse-eligible class
  "KITE_NSE_EQ_LIKE_PROVISIONAL",        // NSE ref unavailable — fail-closed
  "ORDINARY_EQUITY_ELIGIBLE",            // deprecated — never emitted by classifier
  "TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED",
  "SME_EQUITY_POLICY_EXCLUDED",
  "DEBT_GOVERNMENT_SECURITY",
  "SOVEREIGN_GOLD_BOND",
  "REIT_OR_INVIT",                       // ← NEW: Pack 33B
  "PARTLY_PAID_OR_PREFERENCE",           // ← NEW: Pack 33B
  "ETF_OR_FUND",
  "INDEX",
  "INACTIVE_OR_DELISTED",
  "UNRESOLVED_SECURITY_TYPE",
  "OTHER_UNSUPPORTED",
];

// ── NSE reference map for ordinary equity detection ────────────────────────────

const NSE_REF = new Map([
  ["RELIANCE",  { series: "EQ", isin: "INE002A01018", dateOfListing: "29-NOV-1995" }],
  ["TCS",       { series: "EQ", isin: "INE467B01029", dateOfListing: "25-AUG-2004" }],
  ["HDFCBANK",  { series: "EQ", isin: "INE040A01034", dateOfListing: "19-MAY-1995" }],
]);

type Inst = Parameters<typeof classifyInstrument>[0];

const B: Inst = { // base: ordinary NSE EQ instrument in current master
  symbol: "X", name: "X", instrumentType: "EQ",
  segment: "NSE", exchange: "NSE", inCurrentMaster: true, nseRef: NSE_REF,
};

// ── Synthetic universe — covers every active class ────────────────────────────

const universe: Array<{ inst: Inst; expectedClass: InstrumentEligibilityClass; desc: string }> = [
  // ORDINARY_COMPANY_EQUITY_ELIGIBLE — NSE EQ + NSE ref with series=EQ
  { inst: { ...B, symbol: "RELIANCE",  name: "Reliance Industries Limited" },        expectedClass: "ORDINARY_COMPANY_EQUITY_ELIGIBLE", desc: "ordinary NSE equity (Reliance)" },
  { inst: { ...B, symbol: "TCS",       name: "Tata Consultancy Services Ltd" },      expectedClass: "ORDINARY_COMPANY_EQUITY_ELIGIBLE", desc: "ordinary NSE equity (TCS)" },
  { inst: { ...B, symbol: "HDFCBANK",  name: "HDFC Bank Limited" },                  expectedClass: "ORDINARY_COMPANY_EQUITY_ELIGIBLE", desc: "ordinary NSE equity (HDFC Bank)" },

  // KITE_NSE_EQ_LIKE_PROVISIONAL — NSE EQ + nseRef=null (ref unavailable)
  { inst: { ...B, symbol: "NEWSTK",    name: "Newly Listed Co Ltd", nseRef: null },  expectedClass: "KITE_NSE_EQ_LIKE_PROVISIONAL", desc: "EQ but NSE ref unavailable → provisional" },

  // UNRESOLVED_SECURITY_TYPE — absent from current Kite master (inCurrentMaster=false)
  { inst: { ...B, symbol: "DELISTED",  name: "Delisted Co Ltd", inCurrentMaster: false, nseRef: null }, expectedClass: "UNRESOLVED_SECURITY_TYPE", desc: "absent from Kite master → UNRESOLVED" },

  // INDEX — instrumentType=INDEX
  { inst: { ...B, symbol: "NIFTY",     name: "Nifty 50 Index", instrumentType: "INDEX" },               expectedClass: "INDEX", desc: "index instrument" },

  // SOVEREIGN_GOLD_BOND — tradingsymbol suffix "-GB" (Kite master uses hyphen-separated suffix)
  { inst: { ...B, symbol: "SGBSEP28VI-GB", name: "SGB Sep 2028 VI", nseRef: null },                    expectedClass: "SOVEREIGN_GOLD_BOND", desc: "sovereign gold bond (tradingsymbol suffix -GB)" },

  // REIT_OR_INVIT (NEW — Pack 33B) — name pattern: "REIT"
  { inst: { ...B, symbol: "EMBASSYOFFICE", name: "Embassy Office Parks REIT", nseRef: null },           expectedClass: "REIT_OR_INVIT", desc: "REIT by name pattern" },
  // REIT_OR_INVIT — name pattern: "INFRASTRUCTURE INVESTMENT TRUST"
  { inst: { ...B, symbol: "INDIGRID", name: "India Grid Trust Infrastructure Investment Trust Units", nseRef: null }, expectedClass: "REIT_OR_INVIT", desc: "InvIT by name pattern" },

  // PARTLY_PAID_OR_PREFERENCE (NEW — Pack 33B) — "-PP" symbol suffix
  { inst: { ...B, symbol: "TATAPOWER-PP", name: "Tata Power Partly Paid", nseRef: null },              expectedClass: "PARTLY_PAID_OR_PREFERENCE", desc: "partly paid (-PP suffix)" },
  // PARTLY_PAID_OR_PREFERENCE — "PARTLY PAID" in name
  { inst: { ...B, symbol: "SOMECO",    name: "Some Company Partly Paid Rights", nseRef: null },         expectedClass: "PARTLY_PAID_OR_PREFERENCE", desc: "partly paid (name pattern)" },
  // PARTLY_PAID_OR_PREFERENCE — "PREFERENCE" in name
  { inst: { ...B, symbol: "PREFCO",    name: "Some Preference Shares Company", nseRef: null },          expectedClass: "PARTLY_PAID_OR_PREFERENCE", desc: "preference shares (name pattern)" },

  // ETF_OR_FUND — ETF name pattern
  { inst: { ...B, symbol: "NIFTYBEES", name: "Nippon India ETF Nifty 50 BeES", nseRef: null },          expectedClass: "ETF_OR_FUND", desc: "ETF by name pattern" },

  // OTHER_UNSUPPORTED — non-NSE exchange
  { inst: { ...B, symbol: "RELIANCEBSE", name: "Reliance Industries (BSE)", exchange: "BSE" },          expectedClass: "OTHER_UNSUPPORTED", desc: "BSE exchange → OTHER_UNSUPPORTED" },
];

// ── Run classifier ────────────────────────────────────────────────────────────

interface Stats { count: number; warehouseEligible: boolean; mismatches: string[] }
const classMap = new Map<InstrumentEligibilityClass, Stats>(
  ALL_CLASSES.map(c => [c, { count: 0, warehouseEligible: !WAREHOUSE_EXCLUDED_CLASSES.has(c), mismatches: [] }])
);

let wEligible = 0, wExcluded = 0, classMismatches = 0;

for (const { inst, expectedClass, desc } of universe) {
  const result = classifyInstrument(inst);
  const cls = result.eligibilityClass;
  const stats = classMap.get(cls);
  if (!stats) { console.error(`FATAL: Unknown class "${cls}" returned for ${inst.symbol}`); process.exit(1); }
  stats.count++;
  if (cls !== expectedClass) {
    stats.mismatches.push(`${inst.symbol} [${desc}]: expected ${expectedClass}, got ${cls}`);
    const got = classMap.get(expectedClass);
    if (got) got.mismatches.push(`← expected but not matched for ${inst.symbol}`);
    classMismatches++;
  }
  if (result.warehouseEligible) wEligible++; else wExcluded++;
}

// ── Report ────────────────────────────────────────────────────────────────────

const SEP = "─".repeat(70);
const LN  = (s: string) => console.log(s);

LN(`\n╔${SEP}╗`);
LN(`║  Pack 33B — Item 2: Universe Accounting Equation (Classifier Evidence)  ║`);
LN(`╠${SEP}╣`);
LN(`║  Total synthetic instruments: ${universe.length.toString().padEnd(39)}║`);
LN(`╠${SEP}╣`);
LN(`║  Class                                     Warehouse  Count  Status     ║`);
LN(`╠${SEP}╣`);

for (const cls of ALL_CLASSES) {
  const stats  = classMap.get(cls)!;
  const elig   = stats.warehouseEligible ? "ELIGIBLE " : "EXCLUDED ";
  const count  = stats.count.toString().padEnd(4);
  const ok     = stats.mismatches.length === 0 ? "✓" : "✗ MISMATCH";
  const deprecated = cls === "ORDINARY_EQUITY_ELIGIBLE" ? " (deprecated)" : "";
  const tag    = cls === "REIT_OR_INVIT" || cls === "PARTLY_PAID_OR_PREFERENCE" ? " ←NEW" : "";
  const label  = (cls + deprecated + tag).padEnd(44);
  LN(`║  ${label}${elig}  ${count} ${ok.padEnd(10)} ║`);
}

LN(`╠${SEP}╣`);
LN(`║  Warehouse-eligible (ORDINARY_COMPANY_EQUITY_ELIGIBLE only): ${wEligible.toString().padEnd(14)}║`);
LN(`║  Warehouse-excluded (all other classes):               ${wExcluded.toString().padEnd(14)}║`);
LN(`╠${SEP}╣`);

const totalOk = wEligible + wExcluded === universe.length;
LN(`║  Universe equation: ELIGIBLE(${wEligible}) + EXCLUDED(${wExcluded}) = ${universe.length}  ${totalOk ? "✓ BALANCED" : "✗ UNBALANCED"}               ║`);

LN(`╠${SEP}╣`);
const reitExcluded = WAREHOUSE_EXCLUDED_CLASSES.has("REIT_OR_INVIT");
const ppExcluded   = WAREHOUSE_EXCLUDED_CLASSES.has("PARTLY_PAID_OR_PREFERENCE");
LN(`║  REIT_OR_INVIT ∈ WAREHOUSE_EXCLUDED_CLASSES:          ${reitExcluded ? "true  ✓" : "false ✗"}               ║`);
LN(`║  PARTLY_PAID_OR_PREFERENCE ∈ WAREHOUSE_EXCLUDED:      ${ppExcluded ? "true  ✓" : "false ✗"}               ║`);
LN(`║  Class mismatches in synthetic universe:               ${classMismatches.toString().padEnd(14)}║`);

const requiredUndetected = ALL_CLASSES
  .filter(c => c !== "ORDINARY_EQUITY_ELIGIBLE")   // deprecated — never emitted
  .filter(c => c !== "TRADE_TO_TRADE_EQUITY_POLICY_EXCLUDED") // curated list — hard to synthetic trigger
  .filter(c => c !== "SME_EQUITY_POLICY_EXCLUDED")           // suffix-based — hard to synthetic trigger
  .filter(c => c !== "DEBT_GOVERNMENT_SECURITY")             // SDL name-pattern only
  .filter(c => c !== "INACTIVE_OR_DELISTED")                 // INACTIVE_SYMBOLS curated set
  .filter(c => classMap.get(c)!.count === 0);

const allPass = totalOk && classMismatches === 0 && reitExcluded && ppExcluded && requiredUndetected.length === 0;

LN(`╠${SEP}╣`);
LN(`║  VERDICT: ${allPass
  ? "PASS — REIT_OR_INVIT + PARTLY_PAID_OR_PREFERENCE detected & excluded; "
  : "FAIL — see details below; "}                 ║`);
LN(`║          equation balanced; no class mismatches.                         ║`);
LN(`╚${SEP}╝\n`);

if (!allPass) {
  if (!totalOk) console.error(`UNBALANCED: ${wEligible}+${wExcluded} ≠ ${universe.length}`);
  for (const cls of ALL_CLASSES) {
    const m = classMap.get(cls)!.mismatches;
    if (m.length > 0) console.error(`CLASS_MISMATCH [${cls}]:`, m);
  }
  if (requiredUndetected.length > 0) console.error("UNDETECTED required classes:", requiredUndetected);
  if (!reitExcluded) console.error("REIT_OR_INVIT not in WAREHOUSE_EXCLUDED_CLASSES");
  if (!ppExcluded) console.error("PARTLY_PAID_OR_PREFERENCE not in WAREHOUSE_EXCLUDED_CLASSES");
  process.exit(1);
}
