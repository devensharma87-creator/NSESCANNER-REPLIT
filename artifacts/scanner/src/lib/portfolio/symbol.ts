/**
 * Portfolio Analyser — symbol normalization, classification & alias resolution.
 *
 * Pure, dependency-free, SEBI-neutral. Nothing here fabricates market data: it
 * only cleans up a user-supplied ticker so the enrichment cascade can resolve
 * it against the live instrument master, and classifies the instrument so the
 * UI can tell the user when a datum (e.g. P/E for an ETF) is simply not
 * applicable rather than "missing".
 */

/** Display/handling class for an instrument. */
export type InstrumentClass =
  | "Equity"
  | "ETF"
  | "Index ETF"
  | "Gold ETF"
  | "International ETF"
  | "Sector ETF"
  | "Index"
  | "Unknown";

/**
 * Normalise a user-supplied ticker:
 *   - trim + uppercase
 *   - collapse internal whitespace (e.g. "ARE & M" → "ARE&M")
 *   - strip ONLY Yahoo-style exchange suffixes (.NS/.BO/.NSE/.BSE)
 *
 * Meaningful symbol characters (&, -, digits) are preserved — we never blindly
 * strip them, because real NSE symbols use them (M&M, ARE&M, NIFTYBEES, etc.).
 */
export function normalizeSymbol(input: string): string {
  let s = (input ?? "").trim().toUpperCase();
  s = s.replace(/\s+/g, "");
  s = s.replace(/\.(NS|BO|NSE|BSE)$/i, "");
  return s;
}

/**
 * A verified symbol alias. The cascade resolves most symbols dynamically via
 * the live instrument search, so this table is intentionally EMPTY by default:
 * an alias is only added after it is confirmed against the live instrument
 * master, and every addition is reported. Never hand-map blindly.
 */
export interface SymbolAlias {
  /** Normalised input form (output of normalizeSymbol). */
  input: string;
  /** Canonical tradable symbol. */
  canonical: string;
  exchange?: string;
  instrumentType?: InstrumentClass;
  /** Why this alias exists (for the audit/report). */
  reason: string;
}

export const SYMBOL_ALIASES: readonly SymbolAlias[] = [];

export function lookupAlias(normalised: string): SymbolAlias | null {
  return SYMBOL_ALIASES.find(a => a.input === normalised) ?? null;
}

const ETF_CLASSES: ReadonlySet<InstrumentClass> = new Set<InstrumentClass>([
  "ETF",
  "Index ETF",
  "Gold ETF",
  "International ETF",
  "Sector ETF",
]);

export function isEtfClass(cls: InstrumentClass): boolean {
  return ETF_CLASSES.has(cls);
}

/** Fundamentals (P/E, RoE, D/E …) are meaningful only for individual equities. */
export function fundamentalsApplicable(cls: InstrumentClass): boolean {
  return cls === "Equity" || cls === "Unknown";
}

/**
 * Heuristic instrument classification from symbol + display name. Display-only;
 * a misclassification never affects P&L (which is computed purely from CMP).
 * The "BEES" suffix is Nippon's ETF family (NIFTYBEES, BANKBEES, GOLDBEES …).
 */
export function classifyInstrument(symbol: string, name?: string): InstrumentClass {
  const s = (symbol ?? "").toUpperCase();
  const n = (name ?? "").toUpperCase();
  const hay = `${s} ${n}`;

  const isEtf =
    /\bETF\b/.test(hay) ||
    /BEES\b/.test(s) ||
    /\bFUND\b/.test(n) ||
    /\bINDEX FUND\b/.test(n);

  if (!isEtf) return "Equity";

  if (/GOLD|SILVER|GOLDBEES|SILVERBEES/.test(hay)) return "Gold ETF";
  if (/NASDAQ|HANGSENG|HANG SENG|S&P\s?500|SP500|FANG|NYSE|GLOBAL|WORLD|CHINA|\bUS\b|MAFANG/.test(hay))
    return "International ETF";
  if (/NIFTY|SENSEX|BANKNIFTY|BANK NIFTY|MIDCAP|SMALLCAP|NEXT\s?50|LIQUID/.test(hay))
    return "Index ETF";
  if (/\b(IT|BANK|PHARMA|AUTO|FMCG|PSU|INFRA|ENERGY|METAL|REALTY|CONSUM|HEALTH|PVTBANK)\b/.test(hay))
    return "Sector ETF";

  return "ETF";
}
