/**
 * Portfolio Analyser — CSV template generation, parsing & validation.
 *
 * Dependency-free, RFC-4180-aware parser (handles quoted fields, embedded
 * commas, and "" escaped quotes). Validation flags bad rows instead of
 * silently dropping data: a malformed Qty/Rate is a hard row error; a missing
 * or unparseable date is kept but flagged (and excluded from XIRR downstream).
 */
import type { RawHolding, ParseResult, RowError } from "./types";

export const CSV_TEMPLATE_COLUMNS = [
  "Symbol",
  "Stock Name",
  "Exchange",
  "Sector",
  "Date of Purchase",
  "Qty",
  "Rate",
  "ISIN",
  "Broker",
  "Tag",
  "Notes",
] as const;

/** Columns that must be present in the header row. */
export const REQUIRED_COLUMNS = ["Symbol", "Date of Purchase", "Qty", "Rate"] as const;

function csvCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function csvRow(cells: string[]): string {
  return cells.map(csvCell).join(",");
}

/** A downloadable template with the full column set and two worked examples. */
export function buildCsvTemplate(): string {
  const rows = [
    [...CSV_TEMPLATE_COLUMNS] as string[],
    [
      "RELIANCE",
      "Reliance Industries",
      "NSE",
      "Energy",
      "2024-01-15",
      "50",
      "2450.50",
      "INE002A01018",
      "Zerodha",
      "Core",
      "Long-term core holding",
    ],
    [
      "TCS",
      "Tata Consultancy Services",
      "NSE",
      "IT",
      "2023-11-02",
      "20",
      "3380",
      "INE467B01029",
      "Zerodha",
      "IT",
      "Dividend compounder",
    ],
  ];
  return rows.map(csvRow).join("\n") + "\n";
}

/** Tokenize one CSV document into rows of string cells. */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      pushCell();
      i += 1;
      continue;
    }
    if (ch === "\r") {
      // swallow CRLF / lone CR
      if (text[i + 1] === "\n") i += 1;
      pushRow();
      i += 1;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i += 1;
      continue;
    }
    cell += ch;
    i += 1;
  }
  // trailing cell/row (unless completely empty)
  if (cell.length > 0 || row.length > 0) pushRow();
  return rows;
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Strip ₹, commas, spaces; parse to a finite number or null. */
export function parseNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[₹,\s]/g, "").trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Parse yyyy-mm-dd, dd-mm-yyyy, or dd/mm/yyyy → ISO yyyy-mm-dd, or null. */
export function parseDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();
  if (s === "") return undefined;
  let y: number, m: number, d: number;
  let match: RegExpMatchArray | null;
  if ((match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
    y = Number(match[1]);
    m = Number(match[2]);
    d = Number(match[3]);
  } else if ((match = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/))) {
    d = Number(match[1]);
    m = Number(match[2]);
    y = Number(match[3]);
  } else {
    return undefined;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return undefined;
  }
  const mm = String(m).padStart(2, "0");
  const dd = String(d).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

/**
 * Parse a portfolio CSV. Returns valid holdings plus a list of row-level
 * errors (so the UI can show exactly what was rejected and why).
 */
export function parsePortfolioCsv(text: string): ParseResult {
  const errors: RowError[] = [];
  const holdings: RawHolding[] = [];

  const rows = parseCsvRows(text).filter(r => r.some(c => c.trim() !== ""));
  if (rows.length === 0) {
    return { holdings, errors: [{ rowNumber: 0, message: "File is empty." }], duplicateSymbols: [] };
  }

  const header = rows[0].map(normalizeHeader);
  const idx = (name: string) => header.indexOf(normalizeHeader(name));

  const missingCols = REQUIRED_COLUMNS.filter(c => idx(c) === -1);
  if (missingCols.length > 0) {
    return {
      holdings,
      errors: [{ rowNumber: 0, message: `Missing required column(s): ${missingCols.join(", ")}` }],
      duplicateSymbols: [],
    };
  }

  const iSym = idx("Symbol");
  const iName = idx("Stock Name");
  const iExch = idx("Exchange");
  const iSector = idx("Sector");
  const iDate = idx("Date of Purchase");
  const iQty = idx("Qty");
  const iRate = idx("Rate");
  const iIsin = idx("ISIN");
  const iBroker = idx("Broker");
  const iTag = idx("Tag");
  const iNotes = idx("Notes");

  const seen = new Map<string, number>();
  const dups = new Set<string>();

  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r];
    const rowNumber = r; // 1-based data row (header is row 0)
    const get = (i: number) => (i >= 0 ? (cells[i] ?? "").trim() : "");

    const symbol = get(iSym).toUpperCase();
    if (!symbol) {
      errors.push({ rowNumber, field: "Symbol", message: "Missing symbol." });
      continue;
    }

    const qty = parseNumber(get(iQty));
    if (qty == null || qty <= 0) {
      errors.push({ rowNumber, field: "Qty", message: `Invalid quantity "${get(iQty)}".` });
      continue;
    }
    const rate = parseNumber(get(iRate));
    if (rate == null || rate < 0) {
      errors.push({ rowNumber, field: "Rate", message: `Invalid rate "${get(iRate)}".` });
      continue;
    }

    const purchaseDate = parseDate(get(iDate));
    if (!purchaseDate && get(iDate) !== "") {
      errors.push({
        rowNumber,
        field: "Date of Purchase",
        message: `Unrecognized date "${get(iDate)}" — kept, but excluded from XIRR.`,
      });
    } else if (!purchaseDate) {
      errors.push({
        rowNumber,
        field: "Date of Purchase",
        message: "Missing purchase date — kept, but excluded from XIRR.",
      });
    }

    const key = symbol;
    if (seen.has(key)) dups.add(symbol);
    seen.set(key, (seen.get(key) ?? 0) + 1);

    holdings.push({
      symbol,
      name: get(iName) || symbol,
      exchange: get(iExch) || undefined,
      sector: get(iSector) || undefined,
      purchaseDate,
      qty,
      rate,
      isin: get(iIsin) || undefined,
      broker: get(iBroker) || undefined,
      tag: get(iTag) || undefined,
      notes: get(iNotes) || undefined,
    });
  }

  return { holdings, errors, duplicateSymbols: Array.from(dups) };
}
