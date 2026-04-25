/**
 * Tiny CSV/JSON exporter helper used by `/export` endpoints. We deliberately
 * avoid a heavy dep (papaparse, csv-stringify) — a bare-metal serializer is
 * trivial and avoids one more transitive surface.
 */

import type { Response } from "express";

function csvEscape(v: unknown): string {
  if (v == null) return "";
  let s: string;
  if (typeof v === "object") s = JSON.stringify(v);
  else s = String(v);
  if (s.includes(",") || s.includes("\"") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, "\"\"")}"`;
  }
  return s;
}

/** Convert array of flat row objects to a CSV string. Header is the union of keys
 *  of the first row (predictable column order). Nested values are JSON-stringified. */
export function toCsv(rows: Array<Record<string, unknown>>, headerOverride?: string[]): string {
  if (rows.length === 0) return "";
  const headers = headerOverride ?? Object.keys(rows[0]!);
  const lines: string[] = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map(h => csvEscape(r[h])).join(","));
  }
  return lines.join("\n") + "\n";
}

/** Send `data` as either CSV or JSON, with download-friendly headers. */
export function sendExport(
  res: Response,
  filenameBase: string,
  format: string,
  rows: Array<Record<string, unknown>>,
  headerOverride?: string[],
): void {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  if (format === "csv") {
    const csv = toCsv(rows, headerOverride);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}-${stamp}.csv"`);
    res.send(csv);
  } else {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filenameBase}-${stamp}.json"`);
    res.send(JSON.stringify({ exportedAt: new Date().toISOString(), count: rows.length, rows }, null, 2));
  }
}
