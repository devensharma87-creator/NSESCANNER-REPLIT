/**
 * Refresh the NIFTY 500 sector-weight reference used by the Portfolio Analyser's
 * over/under-weight comparison.
 *
 * WHY THIS EXISTS
 * ---------------
 * `artifacts/scanner/src/lib/portfolio/benchmark.ts` holds a hand-captured,
 * dated snapshot of NSE's published NIFTY 500 industry weightage
 * (`NIFTY500_SECTOR_REFERENCE` + `NIFTY500_SECTOR_REFERENCE_AS_OF`). NSE
 * reconstitutes the index periodically and weights drift with price moves, so
 * that snapshot slowly goes stale and the stances become misleading. This
 * script makes the refresh a repeatable, deterministic job instead of an
 * error-prone manual edit.
 *
 * HONEST BY CONSTRUCTION
 * ----------------------
 *  - It does NOT invent or fetch weights. The operator supplies a CSV exported
 *    from NSE's published "industry representation / weightage" table; every
 *    emitted number traces back to a row of that file.
 *  - The roll-up (NSE industry -> app bucket) is a true partition: each input
 *    row lands in exactly one bucket, nothing is double-counted, and any
 *    industry that fits no bucket goes to `Other` and is reported loudly so the
 *    operator can extend the map rather than silently mis-bucketing it.
 *  - It refuses to emit when no source is given, when the weights do not sum to
 *    ~100% (configurable tolerance), or when the as-of date is malformed. On any
 *    refusal the existing committed snapshot stays in place untouched.
 *
 * USAGE
 * -----
 *   pnpm --filter @workspace/scripts run refresh-nifty500-sectors -- \
 *     --in path/to/nse-nifty500-industry-weights.csv [--as-of YYYY-MM-DD] [--write]
 *
 *   --in <file>     CSV with two columns: industry,weight  (a header row is
 *                   auto-detected and skipped). Weights may include a trailing
 *                   "%". This is the ONLY source of numbers.
 *   --as-of <date>  Real capture date of the source table (ISO yyyy-mm-dd).
 *                   Defaults to today, but you MUST pass the true date the NSE
 *                   table was published/captured — never "now" for old data.
 *   --write         Apply the result in place into benchmark.ts (constant +
 *                   as-of). Without it, the script prints the new block to
 *                   stdout for review (a safe dry-run).
 *   --tolerance <n> Allowed deviation of the summed weights from 100 (pp).
 *                   Defaults to 5.
 *
 * After --write, always run:
 *   pnpm --filter @workspace/scanner run test   (partition-sum guard)
 *   pnpm run typecheck
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Path to the file that owns the reference constants. */
const BENCHMARK_FILE = resolve(
  __dirname,
  "../../artifacts/scanner/src/lib/portfolio/benchmark.ts",
);

/**
 * The app's sector buckets, in the canonical display order used by the constant
 * in benchmark.ts. Every NSE industry must roll up into exactly one of these.
 */
export const APP_BUCKETS = [
  "Banking",
  "Financials",
  "Insurance",
  "IT",
  "Auto",
  "Healthcare",
  "Metals",
  "Energy",
  "Construction",
  "Capital Goods",
  "FMCG",
  "Telecom",
  "Consumer Discretionary",
  "Defence",
  "Chemicals",
  "Real Estate",
  "Logistics",
  "Aviation",
  "Media",
  "Other",
] as const;

export type AppBucket = (typeof APP_BUCKETS)[number];

/**
 * NSE industry name (lower-cased) -> app bucket. Mirrors the documented roll-up
 * in benchmark.ts. Keys are matched case-insensitively after trimming and
 * collapsing inner whitespace. Anything not listed falls through to `Other` and
 * is reported so the map can be extended deliberately.
 */
export const NSE_INDUSTRY_TO_BUCKET: Readonly<Record<string, AppBucket>> = {
  // Banking
  banks: "Banking",
  bank: "Banking",
  // Financials
  "financial services": "Financials",
  "financial services - others": "Financials",
  "capital markets": "Financials",
  "diversified financials": "Financials",
  // Insurance
  insurance: "Insurance",
  // IT
  "information technology": "IT",
  "it - software": "IT",
  // Auto
  "automobile and auto components": "Auto",
  automobiles: "Auto",
  "auto components": "Auto",
  // Healthcare (NSE lumps pharma under healthcare)
  healthcare: "Healthcare",
  "healthcare services": "Healthcare",
  pharmaceuticals: "Healthcare",
  pharma: "Healthcare",
  "pharmaceuticals & biotechnology": "Healthcare",
  // Metals
  "metals & mining": "Metals",
  "metals and mining": "Metals",
  // Energy
  "petroleum products": "Energy",
  power: "Energy",
  "oil gas & consumable fuels": "Energy",
  "oil & gas": "Energy",
  energy: "Energy",
  // Construction
  construction: "Construction",
  // Capital Goods
  "capital goods": "Capital Goods",
  "industrial products": "Capital Goods",
  "industrial manufacturing": "Capital Goods",
  // FMCG
  "consumer goods": "FMCG",
  "fast moving consumer goods": "FMCG",
  fmcg: "FMCG",
  "food products": "FMCG",
  beverages: "FMCG",
  // Telecom
  telecom: "Telecom",
  telecommunication: "Telecom",
  "telecommunication services": "Telecom",
  // Consumer Discretionary
  "consumer durables": "Consumer Discretionary",
  retail: "Consumer Discretionary",
  "consumer services": "Consumer Discretionary",
  "leisure services": "Consumer Discretionary",
  // Defence
  "aerospace & defense": "Defence",
  "aerospace & defence": "Defence",
  // Chemicals
  chemicals: "Chemicals",
  "chemicals & petrochemicals": "Chemicals",
  // Real Estate
  realty: "Real Estate",
  "real estate": "Real Estate",
  // Logistics
  transport: "Logistics",
  "transport services": "Logistics",
  "logistics & cargo": "Logistics",
  // Aviation
  aviation: "Aviation",
  // Media
  media: "Media",
  "media entertainment & publication": "Media",
  // Other (explicit catch-all rows seen in NSE tables)
  textiles: "Other",
  diversified: "Other",
  "commercial services & supplies": "Other",
  "forest materials": "Other",
  services: "Other",
};

/** A single parsed input row. */
export interface IndustryWeight {
  industry: string;
  weight: number;
}

/** Outcome of rolling the input rows up into app buckets. */
export interface RollupResult {
  /** Bucket -> summed weight (rounded to 2dp), only buckets with weight > 0. */
  weights: Record<string, number>;
  /** Total of all input weights (rounded to 2dp). */
  total: number;
  /** Industries that fell through to `Other` because they were not mapped. */
  unmapped: { industry: string; weight: number }[];
}

function canon(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Parse a two-column CSV (industry,weight). Tolerates quoted fields, a trailing
 * "%" on the weight, and an optional header row (auto-detected when the second
 * column of the first row is not numeric). Pure: takes raw text, returns rows.
 */
export function parseIndustryWeightsCsv(text: string): IndustryWeight[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  const rows: IndustryWeight[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (cells.length < 2) continue;
    const industry = cells[0].trim();
    const weightRaw = cells[1].replace(/%/g, "").trim();
    const weight = Number(weightRaw);
    if (i === 0 && !Number.isFinite(weight)) continue; // header row
    if (!industry || !Number.isFinite(weight)) continue;
    rows.push({ industry, weight });
  }
  return rows;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Roll NSE industry rows up into the app's sector buckets as a true partition.
 * Unmapped industries are summed into `Other` AND reported in `unmapped`.
 */
export function rollUpToBuckets(rows: IndustryWeight[]): RollupResult {
  const weights: Record<string, number> = {};
  const unmapped: { industry: string; weight: number }[] = [];
  let total = 0;
  for (const { industry, weight } of rows) {
    if (!Number.isFinite(weight)) continue;
    total += weight;
    const bucket = NSE_INDUSTRY_TO_BUCKET[canon(industry)] ?? "Other";
    if (bucket === "Other" && !(canon(industry) in NSE_INDUSTRY_TO_BUCKET)) {
      unmapped.push({ industry, weight });
    }
    weights[bucket] = (weights[bucket] ?? 0) + weight;
  }
  // Round everything to 2dp for a clean, stable constant.
  for (const k of Object.keys(weights)) weights[k] = round2(weights[k]);
  return { weights, total: round2(total), unmapped };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Render the `NIFTY500_SECTOR_REFERENCE` object literal body (the lines between
 * the braces), in canonical bucket order, omitting zero-weight buckets except
 * keeping `Other` only when it carries weight.
 */
export function renderReferenceLiteral(weights: Record<string, number>): string {
  const lines: string[] = [];
  for (const bucket of APP_BUCKETS) {
    const w = weights[bucket];
    if (w == null || w === 0) continue;
    const key = /[^A-Za-z]/.test(bucket) ? JSON.stringify(bucket) : bucket;
    lines.push(`  ${key}: ${w},`);
  }
  return lines.join("\n");
}

interface CliArgs {
  in?: string;
  asOf: string;
  write: boolean;
  tolerance: number;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { asOf: todayIso(), write: false, tolerance: 5 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--in") args.in = argv[++i];
    else if (a === "--as-of") args.asOf = argv[++i];
    else if (a === "--write") args.write = true;
    else if (a === "--tolerance") args.tolerance = Number(argv[++i]);
    else if (a === "--help" || a === "-h") args.in = undefined;
  }
  return args;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`));
}

const HELP = `Refresh the NIFTY 500 sector-weight reference (honest, no fabrication).

Usage:
  pnpm --filter @workspace/scripts run refresh-nifty500-sectors -- \\
    --in <nse-industry-weights.csv> [--as-of YYYY-MM-DD] [--write] [--tolerance 5]

The CSV must have two columns: industry,weight (header auto-detected).
Without --write the new constant block is printed for review (dry run).
If the source is missing or invalid, the existing snapshot stays in place.`;

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (!args.in) {
    console.log(HELP);
    process.exitCode = 1;
    return;
  }
  if (!isIsoDate(args.asOf)) {
    console.error(`Refusing to emit: --as-of "${args.asOf}" is not a valid ISO yyyy-mm-dd date.`);
    process.exitCode = 1;
    return;
  }

  let text: string;
  try {
    text = readFileSync(resolve(process.cwd(), args.in), "utf8");
  } catch (err) {
    console.error(`Refusing to emit: could not read source CSV "${args.in}": ${(err as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const rows = parseIndustryWeightsCsv(text);
  if (rows.length === 0) {
    console.error("Refusing to emit: no usable (industry,weight) rows found in the source CSV.");
    process.exitCode = 1;
    return;
  }

  const { weights, total, unmapped } = rollUpToBuckets(rows);

  if (Math.abs(total - 100) > args.tolerance) {
    console.error(
      `Refusing to emit: input weights sum to ${total} (expected ~100, tolerance ${args.tolerance}). ` +
        `The published NSE industry weightage should total ~100%. Check the source CSV.`,
    );
    process.exitCode = 1;
    return;
  }

  if (unmapped.length > 0) {
    console.warn(
      `\nWARNING: ${unmapped.length} industry row(s) were not recognised and fell into "Other":`,
    );
    for (const u of unmapped) console.warn(`  - "${u.industry}" (${u.weight})`);
    console.warn(
      "If any belong in a real bucket, add them to NSE_INDUSTRY_TO_BUCKET and re-run.\n",
    );
  }

  const literal = renderReferenceLiteral(weights);
  const block = `export const NIFTY500_SECTOR_REFERENCE: Readonly<Record<string, number>> = {\n${literal}\n};`;

  console.log(`# Rolled up ${rows.length} industry rows; total weight = ${total}%`);
  console.log(`# as-of = ${args.asOf}\n`);

  if (!args.write) {
    console.log("// --- NIFTY500_SECTOR_REFERENCE_AS_OF ---");
    console.log(`export const NIFTY500_SECTOR_REFERENCE_AS_OF = "${args.asOf}";\n`);
    console.log("// --- NIFTY500_SECTOR_REFERENCE ---");
    console.log(block);
    console.log("\n(dry run — re-run with --write to apply, then run scanner tests + typecheck)");
    return;
  }

  applyToBenchmarkFile(args.asOf, literal);
  console.log(`Applied to ${BENCHMARK_FILE}.`);
  console.log("Now run: pnpm --filter @workspace/scanner run test && pnpm run typecheck");
}

/**
 * Replace the as-of constant and the reference object literal in benchmark.ts in
 * place, preserving the surrounding doc comments. Refuses (throws) if either
 * anchor cannot be located, so the file is never partially rewritten.
 */
export function applyToBenchmarkFile(asOf: string, literal: string): void {
  const src = readFileSync(BENCHMARK_FILE, "utf8");

  const asOfRe = /export const NIFTY500_SECTOR_REFERENCE_AS_OF = "[^"]*";/;
  if (!asOfRe.test(src)) {
    throw new Error("Could not find NIFTY500_SECTOR_REFERENCE_AS_OF to replace.");
  }

  const refRe =
    /export const NIFTY500_SECTOR_REFERENCE: Readonly<Record<string, number>> = \{[\s\S]*?\n\};/;
  if (!refRe.test(src)) {
    throw new Error("Could not find NIFTY500_SECTOR_REFERENCE object literal to replace.");
  }

  const next = src
    .replace(asOfRe, `export const NIFTY500_SECTOR_REFERENCE_AS_OF = "${asOf}";`)
    .replace(
      refRe,
      `export const NIFTY500_SECTOR_REFERENCE: Readonly<Record<string, number>> = {\n${literal}\n};`,
    );

  writeFileSync(BENCHMARK_FILE, next, "utf8");
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
