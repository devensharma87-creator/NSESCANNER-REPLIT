/**
 * PHASE 0.6 — OFFICIAL SOURCE CONTRACT
 *
 * Every input to the instrument registry enters through this file, and every
 * one of them carries full provenance: what it was, where it came from, when
 * it was retrieved, what it hashed to, how many rows it had, whether it
 * validated, and how fresh it is.
 *
 * Parsing is SEPARATE from fetching on purpose. `parse*` functions are pure and
 * take the raw body, so tests exercise the real parsers against official-format
 * fixtures with no network access. Fixtures never reach a production store.
 *
 * FAIL-CLOSED: a source that is missing, malformed, below its validated floor
 * or internally inconsistent yields a REJECTED provenance. The caller must then
 * preserve the previous accepted manifest — a partial generation never replaces
 * a good one.
 */

import { createHash } from "node:crypto";
// Runtime import is safe: bseReferencePolicy imports from this module with a
// type-only import, which is erased, so there is no runtime cycle.
import { istDateString } from "./bseReferencePolicy";

export { istDateString };

export type OfficialSourceId =
  | "NSE_EQUITY_L"
  | "NSE_SME_EQUITY_L"
  | "NSE_ETF_LIST"
  | "BSE_LIST_OF_SCRIPS_ACTIVE"
  | "BSE_LIST_OF_SCRIPS_SUSPENDED"
  | "KITE_INSTRUMENT_MASTER";

export type SourceValidationResult =
  | "ACCEPTED"
  | "REJECTED_EMPTY"
  | "REJECTED_MALFORMED"
  | "REJECTED_BELOW_FLOOR"
  | "UNAVAILABLE";

/** Reference-data authority states. A registry is reference data, not a quote. */
export type ReferenceFreshnessState =
  | "CURRENT_AUTHORITATIVE"
  | "LAST_KNOWN"
  | "STALE"
  | "INVALID"
  | "UNAVAILABLE";

/**
 * NSE reference governance is 48 hours. This MIRRORS the accepted value in
 * `nseSecurityMaster.ts` and must never diverge from it; a guard test pins the
 * two together by reading that file's source. It is duplicated rather than
 * imported so this module stays free of the database import chain.
 *
 * This value is NOT changed by Phase 0.6.
 */
export const NSE_REFERENCE_MAX_AGE_HOURS_MIRROR = 48;

/**
 * BSE REFERENCE FRESHNESS — OWNER APPROVED.
 *
 * The BSE List of Scrips is a continuously-maintained database endpoint, not a
 * dated daily publication like NSE's EQUITY_L.csv. It carries no publication
 * timestamp and no documented cadence, so no hour-based maximum age can be
 * derived from it honestly.
 *
 * The owner therefore approved an EVENT-BASED policy instead of a threshold:
 * authority requires a List of Scrips retrieved during the current IST calendar
 * day, reconciled against the newest official BSE UDiFF for the latest
 * COMPLETED trading session. See `bseReferencePolicy.ts` for the full rule set
 * and `evaluateBseReferenceAuthority` for the only function permitted to
 * authorize a new BSE-bearing generation.
 *
 * NO NEW HOUR THRESHOLD IS INTRODUCED ANYWHERE BY THIS POLICY.
 */
export const BSE_REFERENCE_FRESHNESS_POLICY =
  "OWNER_APPROVED_CURRENT_DAY_LIST_PLUS_LATEST_COMPLETED_SESSION_UDIFF" as const;

/**
 * Minimum accepted row counts. A source below its floor is REJECTED, because a
 * truncated body, an error page or an empty response is otherwise
 * indistinguishable from a genuine shrinking universe.
 *
 * Floors are set well under observed volumes (OBSERVED 2026-08-12: NSE main
 * 2,401 / SME 560 / ETF 342 / BSE active 4,971 / BSE suspended 1,219 / Kite
 * 114,401) so ordinary listing churn never trips them.
 */
export const SOURCE_ROW_FLOORS: Readonly<Record<OfficialSourceId, number>> = {
  NSE_EQUITY_L: 1000,
  NSE_SME_EQUITY_L: 100,
  NSE_ETF_LIST: 50,
  BSE_LIST_OF_SCRIPS_ACTIVE: 2000,
  BSE_LIST_OF_SCRIPS_SUSPENDED: 100,
  KITE_INSTRUMENT_MASTER: 10000,
};

export const SOURCE_URLS: Readonly<Record<OfficialSourceId, string>> = {
  NSE_EQUITY_L: "https://nsearchives.nseindia.com/content/equities/EQUITY_L.csv",
  NSE_SME_EQUITY_L: "https://nsearchives.nseindia.com/emerge/corporates/content/SME_EQUITY_L.csv",
  NSE_ETF_LIST: "https://nsearchives.nseindia.com/content/equities/eq_etfseclist.csv",
  BSE_LIST_OF_SCRIPS_ACTIVE:
    "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?segment=Equity&status=Active",
  BSE_LIST_OF_SCRIPS_SUSPENDED:
    "https://api.bseindia.com/BseIndiaAPI/api/ListofScripData/w?segment=Equity&status=Suspended",
  KITE_INSTRUMENT_MASTER: "https://api.kite.trade/instruments",
};

/**
 * How the effective date was determined. NSE's listing CSVs and BSE's scrip
 * database carry no publication date, so the retrieval date is used and
 * LABELLED as such. It is never presented as an exchange-declared date.
 */
export type EffectiveDateBasis = "SOURCE_DECLARED" | "RETRIEVAL_DATE";

export interface OfficialSourceProvenance {
  readonly sourceId: OfficialSourceId;
  readonly sourceName: string;
  readonly sourceUrl: string;
  /** ISO-8601 instant the body was received. */
  readonly retrievedAt: string;
  /** YYYY-MM-DD. */
  readonly effectiveDate: string;
  readonly effectiveDateBasis: EffectiveDateBasis;
  /** SHA-256 of the RAW body, before parsing. */
  readonly contentHash: string;
  readonly rowCount: number;
  readonly validationResult: SourceValidationResult;
  readonly freshnessState: ReferenceFreshnessState;
  /** Populated only when validationResult is not ACCEPTED. */
  readonly rejectionDetail: string | null;
}

export function sha256Hex(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

/** YYYY-MM-DD in UTC from an ISO instant. */
export function isoDate(iso: string): string {
  return iso.slice(0, 10);
}

// ── Row shapes ───────────────────────────────────────────────────────────────

export interface NseOfficialEquityRow {
  readonly symbol: string;
  readonly nameOfCompany: string;
  readonly series: string;
  readonly isin: string | null;
  readonly dateOfListing: string | null;
}

export interface NseOfficialEtfRow {
  readonly symbol: string;
  readonly securityName: string;
  readonly underlying: string | null;
  readonly isin: string | null;
}

export interface KiteMasterRow {
  readonly instrumentToken: number;
  readonly exchangeToken: number;
  readonly tradingSymbol: string;
  readonly name: string;
  readonly exchange: string;
  readonly segment: string;
  readonly instrumentType: string;
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/**
 * Minimal RFC4180-ish splitter. Needed because the Kite dump quotes names that
 * contain commas; a naive split corrupts every column after such a row.
 */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Header keys are trimmed and upper-cased so " SERIES" and "SERIES" agree. */
function headerIndex(headerLine: string): Map<string, number> {
  const idx = new Map<string, number>();
  splitCsvLine(headerLine).forEach((h, i) => {
    const key = h.trim().toUpperCase().replace(/[\s_]+/g, "");
    if (!idx.has(key)) idx.set(key, i);
  });
  return idx;
}

function cell(cols: string[], idx: Map<string, number>, ...names: string[]): string {
  for (const n of names) {
    const i = idx.get(n.toUpperCase().replace(/[\s_]+/g, ""));
    if (i !== undefined && i < cols.length) {
      const v = cols[i]!.trim();
      if (v !== "") return v;
    }
  }
  return "";
}

function nonEmptyLines(body: string): string[] {
  return body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

// ── Provenance assembly ──────────────────────────────────────────────────────

function buildProvenance(args: {
  sourceId: OfficialSourceId;
  sourceName: string;
  body: string;
  retrievedAt: string;
  rowCount: number;
  malformedDetail: string | null;
  nowMs: number;
}): OfficialSourceProvenance {
  const { sourceId, sourceName, body, retrievedAt, rowCount, malformedDetail, nowMs } = args;

  let validationResult: SourceValidationResult = "ACCEPTED";
  let rejectionDetail: string | null = null;

  if (body.trim().length === 0) {
    validationResult = "REJECTED_EMPTY";
    rejectionDetail = "source body was empty";
  } else if (malformedDetail !== null) {
    validationResult = "REJECTED_MALFORMED";
    rejectionDetail = malformedDetail;
  } else if (rowCount < SOURCE_ROW_FLOORS[sourceId]) {
    validationResult = "REJECTED_BELOW_FLOOR";
    rejectionDetail = `row count ${rowCount} is below the validated floor ${SOURCE_ROW_FLOORS[sourceId]}`;
  }

  return {
    sourceId,
    sourceName,
    sourceUrl: SOURCE_URLS[sourceId],
    retrievedAt,
    effectiveDate: isoDate(retrievedAt),
    effectiveDateBasis: "RETRIEVAL_DATE",
    contentHash: sha256Hex(body),
    rowCount,
    validationResult,
    freshnessState:
      validationResult === "ACCEPTED"
        ? computeFreshnessState(sourceId, retrievedAt, nowMs)
        : "INVALID",
    rejectionDetail,
  };
}

/**
 * Freshness per source family.
 *
 *  - NSE uses the existing, unaltered 48-hour reference governance.
 *  - BSE uses the OWNER-APPROVED calendar-day rule: a List of Scrips retrieved
 *    during the current IST calendar day is CURRENT_AUTHORITATIVE, and anything
 *    retrieved on an earlier IST day is LAST_KNOWN. No hour threshold is used,
 *    because BSE publishes no timestamp that an hour count could measure.
 *    This is a per-source staleness label only; whether a generation may be
 *    AUTHORIZED additionally requires completed-session UDiFF reconciliation
 *    and is decided solely by `evaluateBseReferenceAuthority`.
 *  - The Kite dump is a provider master, not a security-classification
 *    authority; it is treated on the NSE cadence purely for staleness
 *    reporting and never grants classification authority.
 */
export function computeFreshnessState(
  sourceId: OfficialSourceId,
  retrievedAt: string,
  nowMs: number,
): ReferenceFreshnessState {
  const t = Date.parse(retrievedAt);
  if (!Number.isFinite(t)) return "INVALID";
  const ageMs = nowMs - t;
  if (ageMs < 0) return "INVALID";

  const isBse =
    sourceId === "BSE_LIST_OF_SCRIPS_ACTIVE" || sourceId === "BSE_LIST_OF_SCRIPS_SUSPENDED";

  if (isBse) {
    return istDateString(t) === istDateString(nowMs) ? "CURRENT_AUTHORITATIVE" : "LAST_KNOWN";
  }
  return ageMs < NSE_REFERENCE_MAX_AGE_HOURS_MIRROR * 3600_000 ? "CURRENT_AUTHORITATIVE" : "STALE";
}

export interface ParsedSource<T> {
  readonly provenance: OfficialSourceProvenance;
  readonly rows: readonly T[];
}

// ── Parsers (pure) ───────────────────────────────────────────────────────────

export function parseNseEquityCsv(
  body: string,
  sourceId: "NSE_EQUITY_L" | "NSE_SME_EQUITY_L",
  retrievedAt: string,
  nowMs: number,
): ParsedSource<NseOfficialEquityRow> {
  const lines = nonEmptyLines(body);
  const rows: NseOfficialEquityRow[] = [];
  let malformed: string | null = null;

  if (lines.length < 2) {
    malformed = "fewer than two lines (no header + data)";
  } else {
    const idx = headerIndex(lines[0]!);
    if (!idx.has("SYMBOL") || !idx.has("SERIES")) {
      malformed = `header missing SYMBOL/SERIES columns: ${lines[0]!.slice(0, 120)}`;
    } else {
      for (let i = 1; i < lines.length; i++) {
        const cols = splitCsvLine(lines[i]!);
        const symbol = cell(cols, idx, "SYMBOL").toUpperCase();
        const series = cell(cols, idx, "SERIES").toUpperCase();
        if (symbol === "" || series === "") continue;
        rows.push({
          symbol,
          nameOfCompany: cell(cols, idx, "NAMEOFCOMPANY"),
          series,
          isin: normalizeIsinLocal(cell(cols, idx, "ISINNUMBER")),
          dateOfListing: cell(cols, idx, "DATEOFLISTING") || null,
        });
      }
    }
  }

  return {
    provenance: buildProvenance({
      sourceId,
      sourceName:
        sourceId === "NSE_EQUITY_L" ? "NSE EQUITY_L.csv (main board)" : "NSE SME_EQUITY_L.csv",
      body,
      retrievedAt,
      rowCount: rows.length,
      malformedDetail: malformed,
      nowMs,
    }),
    rows,
  };
}

export function parseNseEtfCsv(
  body: string,
  retrievedAt: string,
  nowMs: number,
): ParsedSource<NseOfficialEtfRow> {
  const lines = nonEmptyLines(body);
  const rows: NseOfficialEtfRow[] = [];
  let malformed: string | null = null;

  if (lines.length < 2) {
    malformed = "fewer than two lines (no header + data)";
  } else {
    const idx = headerIndex(lines[0]!);
    if (!idx.has("SYMBOL")) {
      malformed = `header missing Symbol column: ${lines[0]!.slice(0, 120)}`;
    } else {
      for (let i = 1; i < lines.length; i++) {
        const cols = splitCsvLine(lines[i]!);
        const symbol = cell(cols, idx, "SYMBOL").toUpperCase();
        if (symbol === "") continue;
        rows.push({
          symbol,
          securityName: cell(cols, idx, "SECURITYNAME"),
          underlying: cell(cols, idx, "UNDERLYING") || null,
          isin: normalizeIsinLocal(cell(cols, idx, "ISINNUMBER")),
        });
      }
    }
  }

  return {
    provenance: buildProvenance({
      sourceId: "NSE_ETF_LIST",
      sourceName: "NSE eq_etfseclist.csv (official ETF list)",
      body,
      retrievedAt,
      rowCount: rows.length,
      malformedDetail: malformed,
      nowMs,
    }),
    rows,
  };
}

export interface BseRawRow {
  readonly scripCode: string;
  readonly scripId: string;
  readonly scripName: string;
  readonly group: string;
  readonly segment: string;
  readonly isin: string | null;
  readonly status: "Active" | "Suspended";
}

export function parseBseListOfScrips(
  body: string,
  sourceId: "BSE_LIST_OF_SCRIPS_ACTIVE" | "BSE_LIST_OF_SCRIPS_SUSPENDED",
  retrievedAt: string,
  nowMs: number,
): ParsedSource<BseRawRow> {
  const rows: BseRawRow[] = [];
  let malformed: string | null = null;
  const expectedStatus = sourceId === "BSE_LIST_OF_SCRIPS_ACTIVE" ? "Active" : "Suspended";

  try {
    const parsed: unknown = JSON.parse(body);
    if (!Array.isArray(parsed)) {
      malformed = "BSE payload is not a JSON array";
    } else {
      for (const raw of parsed) {
        if (raw === null || typeof raw !== "object") continue;
        const r = raw as Record<string, unknown>;
        const scripCode = String(r.SCRIP_CD ?? "").trim();
        if (scripCode === "") continue;
        const status = String(r.Status ?? "").trim();
        rows.push({
          scripCode,
          scripId: String(r.scrip_id ?? "").trim().toUpperCase(),
          scripName: String(r.Scrip_Name ?? "").trim(),
          group: String(r.GROUP ?? "").trim().toUpperCase(),
          segment: String(r.Segment ?? "").trim(),
          isin: normalizeIsinLocal(String(r.ISIN_NUMBER ?? "")),
          status: status === "Suspended" ? "Suspended" : "Active",
        });
      }
      // Internal consistency: the endpoint was asked for one status only.
      const wrong = rows.filter((r) => r.status !== expectedStatus).length;
      if (malformed === null && wrong > 0) {
        malformed = `${wrong} rows do not carry the requested status ${expectedStatus}`;
      }
    }
  } catch (err) {
    malformed = `BSE payload is not valid JSON: ${(err as Error).message}`;
  }

  return {
    provenance: buildProvenance({
      sourceId,
      sourceName: `BSE List of Scrips (${expectedStatus})`,
      body,
      retrievedAt,
      rowCount: rows.length,
      malformedDetail: malformed,
      nowMs,
    }),
    rows,
  };
}

export function parseKiteInstrumentCsv(
  body: string,
  retrievedAt: string,
  nowMs: number,
): ParsedSource<KiteMasterRow> {
  const lines = nonEmptyLines(body);
  const rows: KiteMasterRow[] = [];
  let malformed: string | null = null;

  if (lines.length < 2) {
    malformed = "fewer than two lines (no header + data)";
  } else {
    const idx = headerIndex(lines[0]!);
    if (!idx.has("INSTRUMENTTOKEN") || !idx.has("EXCHANGETOKEN") || !idx.has("TRADINGSYMBOL")) {
      malformed = `header missing token/tradingsymbol columns: ${lines[0]!.slice(0, 120)}`;
    } else {
      for (let i = 1; i < lines.length; i++) {
        const cols = splitCsvLine(lines[i]!);
        // Kite's CSV yields string tokens; coerce and validate as integers or drop.
        const it = Number(cell(cols, idx, "INSTRUMENTTOKEN"));
        const et = Number(cell(cols, idx, "EXCHANGETOKEN"));
        const ts = cell(cols, idx, "TRADINGSYMBOL").toUpperCase();
        if (!Number.isInteger(it) || it <= 0 || ts === "") continue;
        rows.push({
          instrumentToken: it,
          exchangeToken: Number.isInteger(et) ? et : 0,
          tradingSymbol: ts,
          name: cell(cols, idx, "NAME"),
          exchange: cell(cols, idx, "EXCHANGE").toUpperCase(),
          segment: cell(cols, idx, "SEGMENT").toUpperCase(),
          instrumentType: cell(cols, idx, "INSTRUMENTTYPE").toUpperCase(),
        });
      }
    }
  }

  return {
    provenance: buildProvenance({
      sourceId: "KITE_INSTRUMENT_MASTER",
      sourceName: "Kite instrument master (provider tokens only)",
      body,
      retrievedAt,
      rowCount: rows.length,
      malformedDetail: malformed,
      nowMs,
    }),
    rows,
  };
}

/** Local ISIN normalizer, duplicated to keep this module dependency-free. */
function normalizeIsinLocal(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  if (s === "" || s === "NA" || s === "N.A." || s === "-") return null;
  if (s.length !== 12) return null;
  return s;
}

/** An unavailable source: recorded honestly rather than omitted. */
export function unavailableSource(
  sourceId: OfficialSourceId,
  sourceName: string,
  retrievedAt: string,
  detail: string,
): OfficialSourceProvenance {
  return {
    sourceId,
    sourceName,
    sourceUrl: SOURCE_URLS[sourceId],
    retrievedAt,
    effectiveDate: isoDate(retrievedAt),
    effectiveDateBasis: "RETRIEVAL_DATE",
    contentHash: sha256Hex(""),
    rowCount: 0,
    validationResult: "UNAVAILABLE",
    freshnessState: "UNAVAILABLE",
    rejectionDetail: detail,
  };
}

export function isSourceAccepted(p: OfficialSourceProvenance): boolean {
  return p.validationResult === "ACCEPTED";
}
