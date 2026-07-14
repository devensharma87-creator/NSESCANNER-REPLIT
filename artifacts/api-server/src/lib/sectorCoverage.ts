/**
 * Pure sector-coverage accounting.
 *
 * Sector aggregations (Sector Rotation, Market-Pulse sector leadership,
 * sector-strength) group rows into a KNOWN sector partition. Rows whose
 * sector is empty/null or not part of that partition would otherwise be
 * silently dropped, overstating how complete the aggregation is.
 *
 * This helper makes the exclusion HONEST: it reports how many rows were
 * mapped, how many were excluded, the coverage %, and the offending labels
 * with a plain-language reason. It never mutates input and never fabricates.
 */

export interface SectorCoverage {
  /** Total rows considered. */
  totalRows: number;
  /** Rows whose sector is non-empty AND a member of the known partition. */
  mappedRows: number;
  /** Rows dropped because their sector is empty/null or unknown. */
  excludedUnmapped: number;
  /** mappedRows / totalRows as 0–100; 100 when there are no rows. */
  coveragePct: number;
  /**
   * Excluded labels with counts, sorted by count desc then label asc.
   * Empty/null sectors are bucketed under the label "(none)".
   */
  unmappedSectors: Array<{ label: string; count: number }>;
  /** Plain-language reason, or null when nothing was excluded. */
  reason: string | null;
}

const NONE_LABEL = "(none)";

export function computeSectorCoverage(
  rows: ReadonlyArray<{ sector: string | null | undefined }>,
  knownSectors: ReadonlyArray<string> | ReadonlySet<string>,
): SectorCoverage {
  const known = knownSectors instanceof Set ? knownSectors : new Set(knownSectors);
  const totalRows = rows.length;

  let mappedRows = 0;
  const excludedCounts = new Map<string, number>();
  for (const r of rows) {
    const sec = (r.sector ?? "").trim();
    if (sec && known.has(sec)) {
      mappedRows++;
    } else {
      const label = sec || NONE_LABEL;
      excludedCounts.set(label, (excludedCounts.get(label) ?? 0) + 1);
    }
  }

  const excludedUnmapped = totalRows - mappedRows;
  const coveragePct = totalRows === 0 ? 100 : Math.round((mappedRows / totalRows) * 10000) / 100;

  const unmappedSectors = [...excludedCounts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  let reason: string | null = null;
  if (excludedUnmapped > 0) {
    const noneCount = excludedCounts.get(NONE_LABEL) ?? 0;
    const unknownCount = excludedUnmapped - noneCount;
    const parts: string[] = [];
    if (noneCount > 0) parts.push(`${noneCount} with no sector`);
    if (unknownCount > 0) parts.push(`${unknownCount} with an unmapped sector`);
    reason = `${excludedUnmapped} of ${totalRows} row(s) excluded from sector aggregation (${parts.join(", ")}).`;
  }

  return { totalRows, mappedRows, excludedUnmapped, coveragePct, unmappedSectors, reason };
}
