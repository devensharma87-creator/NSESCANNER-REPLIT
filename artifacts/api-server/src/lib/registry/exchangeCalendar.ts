/**
 * PHASE 0.6A — AUTHORITATIVE NSE/BSE TRADING-SESSION CALENDAR.
 *
 * Resolves the Phase 0.6 blocker AUTHORITATIVE_TRADING_CALENDAR_REQUIRED. Until
 * now the only session logic in the repo was `fnoTradingDays.ts`, which is
 * Monday–Friday and says so. Weekday logic cannot answer "what was the latest
 * COMPLETED trading session", because it cannot see exchange holidays and it
 * cannot see the special sessions (Muhurat) that trade on a Sunday.
 *
 * This module is PURE: no I/O, no clock, no provider call, no database. Every
 * input — the official source bodies, the evaluation instant — is supplied by
 * the caller. Parsers for the official formats live in
 * `exchangeCalendarSources.ts`; this file only normalizes, resolves conflicts,
 * enumerates and answers questions.
 *
 * FAIL-CLOSED BY CONSTRUCTION. An unknown year, a missing annual calendar, a
 * malformed source, contradictory equal-priority sources or a session whose
 * timings the exchange has not yet notified all produce an explicit "unknown"
 * answer. Nothing is inferred, and no hour-based freshness threshold exists
 * anywhere in this module.
 *
 * SCOPE: calendar authority establishes SESSION IDENTITY ONLY. It never makes a
 * quote LIVE, never implies a subscription, and never grants reference
 * authority on its own — see `bseReferencePolicy.ts` for that gate.
 */

import { createHash } from "node:crypto";
import { IST_OFFSET_MS, isRealIstDate, istDateString } from "./bseReferencePolicy";
import type { TradingCalendarDayKind, TradingCalendarVerdict } from "./bseReferencePolicy";

/**
 * Schema 2 / policy 2 — regular-session timings are no longer a shared
 * hardcoded constant. Each exchange must supply its own official timing source,
 * with its own provenance and its own content hash, or its regular sessions
 * carry no timings at all. See `SessionTimingSource`.
 */
export const CALENDAR_SCHEMA_VERSION = 2;
export const CALENDAR_POLICY_VERSION = 2;

/**
 * Bumped whenever the extraction logic that turns official timing bytes into
 * normalized rows changes, so persisted evidence stays interpretable.
 */
export const TIMING_EXTRACTION_VERSION = 1;

/** Guards against committing an unbounded blob as "evidence". */
export const MAX_TIMING_EVIDENCE_ROWS = 200;
export const MAX_TIMING_EVIDENCE_VALUE_CHARS = 200;
export const MAX_TIMING_SOURCE_BYTES = 32 * 1024 * 1024;

export type CalendarExchange = "NSE" | "BSE";

export type TradingSessionType = "REGULAR" | "SPECIAL" | "MUHURAT" | "HALF_DAY" | "CLOSED";

/** Ordinary annual calendar vs a later, specifically applicable circular. */
export type CalendarSourceKind = "ANNUAL_CALENDAR" | "OFFICIAL_CIRCULAR";

export type CalendarSourceValidation =
  | "ACCEPTED"
  | "REJECTED_EMPTY"
  | "REJECTED_MALFORMED"
  | "REJECTED_BELOW_FLOOR"
  | "UNAVAILABLE";

const KIND_PRECEDENCE: Readonly<Record<CalendarSourceKind, number>> = {
  ANNUAL_CALENDAR: 1,
  OFFICIAL_CIRCULAR: 2,
};

export interface CalendarSourceProvenance {
  readonly exchange: CalendarExchange;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly sourceUrl: string;
  /** ISO-8601 instant the body was received. */
  readonly retrievedAt: string;
  readonly calendarYear: number;
  /** Effective period this source speaks for, `YYYY-MM-DD`. */
  readonly effectiveFrom: string;
  readonly effectiveTo: string;
  /** SHA-256 of the RAW body, before parsing. */
  readonly contentHash: string;
  readonly eventCount: number;
  readonly validationResult: CalendarSourceValidation;
  readonly kind: CalendarSourceKind;
  /**
   * Official issue date of the document, `YYYY-MM-DD`. Used ONLY to order two
   * circulars of equal precedence. Annual calendars carry their effectiveFrom.
   */
  readonly issuedAt: string;
  readonly rejectionDetail: string | null;
}

/** A single dated declaration made by an official source. */
export interface CalendarSourceEvent {
  readonly exchange: CalendarExchange;
  /** IST `YYYY-MM-DD`. */
  readonly tradingDate: string;
  readonly sessionType: TradingSessionType;
  readonly description: string;
  /**
   * IST `HH:MM`, or null when the exchange has explicitly NOT yet notified the
   * timings (Muhurat is routinely published this way). Null is not "unknown to
   * us" — it is "not yet notified by the exchange", and it fails closed.
   */
  readonly scheduledOpenIst: string | null;
  readonly scheduledCloseIst: string | null;
  readonly sourceId: string;
}

export interface ParsedCalendarSource {
  readonly provenance: CalendarSourceProvenance;
  readonly events: readonly CalendarSourceEvent[];
}

// ── official regular-session timings ─────────────────────────────────────────

export type TimingSourceValidation =
  | "ACCEPTED"
  | "REJECTED_EMPTY"
  | "REJECTED_MALFORMED"
  | "REJECTED_AMBIGUOUS"
  | "REJECTED_TOO_LARGE"
  | "UNAVAILABLE";

/**
 * One normalized fact lifted out of an official timing document.
 *
 * Evidence is stored as the exact label the exchange printed next to the exact
 * value it printed. A future reviewer can therefore reproduce the normalized
 * open/close from the commitment alone — a bare content hash proves the bytes
 * were seen, not what they said.
 */
export interface SessionTimingEvidenceRow {
  readonly label: string;
  readonly value: string;
}

export interface SessionTimingProvenance {
  readonly exchange: CalendarExchange;
  readonly sourceId: string;
  readonly sourceName: string;
  readonly sourceUrl: string;
  /** ISO-8601 instant the body was received. */
  readonly retrievedAt: string;
  /**
   * The year this timing publication is taken to speak for. Null only when the
   * document itself carries no period; a dated document that has passed out of
   * its period cannot support current authority.
   */
  readonly effectiveYear: number | null;
  readonly effectiveFrom: string | null;
  /** SHA-256 of the RAW body, before extraction. */
  readonly contentHash: string;
  readonly contentBytes: number;
  readonly extractionVersion: number;
  readonly validationResult: TimingSourceValidation;
  readonly rejectionDetail: string | null;
}

/**
 * An exchange's OWN published regular-session timings.
 *
 * There is deliberately no cross-exchange default and no fallback. NSE and BSE
 * happen to run the same hours; that agreement is an observed fact backed by
 * two independent documents, not a constant either exchange inherits from the
 * other.
 */
export interface SessionTimingSource {
  readonly provenance: SessionTimingProvenance;
  /** IST `HH:MM`, null when the document did not yield an unambiguous value. */
  readonly openIst: string | null;
  readonly closeIst: string | null;
  readonly preOpenOpenIst: string | null;
  readonly preOpenCloseIst: string | null;
  readonly closingSessionOpenIst: string | null;
  readonly closingSessionCloseIst: string | null;
  readonly evidence: readonly SessionTimingEvidenceRow[];
}

export interface TradingSessionRecord {
  readonly exchange: CalendarExchange;
  readonly tradingDate: string;
  readonly sessionType: TradingSessionType;
  readonly dayKind: TradingCalendarDayKind;
  readonly scheduledOpenIst: string | null;
  readonly scheduledCloseIst: string | null;
  /** Epoch ms of the scheduled close; null when timings are not notified. */
  readonly scheduledCloseMs: number | null;
  readonly timesOfficiallyNotified: boolean;
  readonly description: string;
  readonly sourceId: string;
  /** Effective date of the source that decided this day. */
  readonly sourceEffectiveDate: string;
  /**
   * The official timing document that supplied this session's clock times, or
   * null when the times came from a date-specific official event (which carries
   * its own timings) or when no timings are known.
   */
  readonly timingSourceId: string | null;
  /** Populated only when a higher-precedence source displaced another. */
  readonly overrideReason: string | null;
  readonly calendarGenerationId: string;
}

export interface ExchangeCalendarGeneration {
  readonly calendarGenerationId: string;
  readonly schemaVersion: number;
  readonly policyVersion: number;
  readonly generatedAt: string;
  readonly coveredYears: readonly { readonly exchange: CalendarExchange; readonly year: number }[];
  readonly sources: readonly CalendarSourceProvenance[];
  readonly timings: readonly SessionTimingSource[];
  readonly sessions: readonly TradingSessionRecord[];
  readonly calendarChecksum: string;
  readonly valid: boolean;
  readonly blockers: readonly string[];
}

// ── deterministic serialization ──────────────────────────────────────────────

/**
 * Local rather than shared with `universeManifest.sortKeysDeep`: the manifest
 * imports this module to verify the calendar commitment, so importing back
 * would create a runtime cycle.
 */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortKeysDeep((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * The generation id is DERIVED from the checksum, never chosen. A caller that
 * receives a calendar can therefore re-check the id/checksum relationship
 * without holding the sessions — which is exactly what the manifest commitment
 * and the coverage boundary do.
 */
export function deriveCalendarGenerationId(calendarChecksum: string): string {
  return `CAL-${calendarChecksum.slice(0, 16)}`;
}

/** A session record as it enters the checksum: before the id derived from it. */
type UnstampedSession = Omit<TradingSessionRecord, "calendarGenerationId">;

function unstamp(sessions: readonly TradingSessionRecord[]): UnstampedSession[] {
  return sessions.map(({ calendarGenerationId: _ignored, ...rest }) => rest);
}

/**
 * The ONE definition of what a calendar's checksum covers.
 *
 * Shared by the builder and by `verifyCalendarCommitment`, so a stored
 * commitment can be RECOMPUTED rather than merely asserted. A checksum a reader
 * cannot recompute is not a commitment — it is a claim.
 */
function computeCalendarChecksum(parts: {
  readonly schemaVersion: number;
  readonly policyVersion: number;
  readonly coveredYears: readonly { readonly exchange: CalendarExchange; readonly year: number }[];
  readonly sources: readonly CalendarSourceProvenance[];
  readonly timings: readonly SessionTimingSource[];
  readonly sessions: readonly UnstampedSession[];
  readonly blockers: readonly string[];
}): string {
  return sha256(JSON.stringify(sortKeysDeep(parts)));
}

// ── time helpers ─────────────────────────────────────────────────────────────

/** Epoch ms for an IST wall-clock `YYYY-MM-DD` + `HH:MM`. */
export function istWallClockToEpochMs(date: string, hhmm: string): number | null {
  if (!isRealIstDate(date)) return null;
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(":").map(Number);
  if (h > 23 || m > 59) return null;
  const utcMidnight = Date.parse(`${date}T00:00:00.000Z`);
  return utcMidnight + h * 3600_000 + m * 60_000 - IST_OFFSET_MS;
}

/** 0=Sunday … 6=Saturday, for an IST calendar date. */
export function istDayOfWeek(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

export function isWeekend(date: string): boolean {
  const d = istDayOfWeek(date);
  return d === 0 || d === 6;
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function enumerateYear(year: number): string[] {
  const out: string[] = [];
  let d = `${year}-01-01`;
  const end = `${year}-12-31`;
  while (d <= end) {
    out.push(d);
    d = addDays(d, 1);
  }
  return out;
}

// ── build ────────────────────────────────────────────────────────────────────

export interface BuildCalendarInput {
  readonly sources: readonly ParsedCalendarSource[];
  /**
   * One accepted official regular-session timing document PER EXCHANGE. A
   * missing exchange is a blocker, never a default.
   */
  readonly timings: readonly SessionTimingSource[];
  readonly exchanges: readonly CalendarExchange[];
  readonly years: readonly number[];
  readonly generatedAt: string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * SESSION-TIME PRECEDENCE, highest first:
 *
 *   1. a date-specific official circular declaring an exceptional session
 *   2. a date-specific official circular declaring a special / Muhurat /
 *      half-day session (1 and 2 are both `OFFICIAL_CIRCULAR`; both outrank the
 *      annual calendar by `KIND_PRECEDENCE`, and each carries its OWN timings)
 *   3. the exchange's own official regular-session timing document, applied
 *      only to days no date-specific event covers
 *   4. nothing — the session carries no timings and fails closed
 *
 * A day never borrows timings across this order: an event that declares a
 * session but not its hours does NOT fall through to the regular timing
 * document, because "the exchange has not said when" is not "the usual hours".
 */
function resolveExchangeTimings(
  input: BuildCalendarInput,
  exchanges: readonly CalendarExchange[],
  years: readonly number[],
  blockers: string[],
): Map<CalendarExchange, SessionTimingSource> {
  const chosen = new Map<CalendarExchange, SessionTimingSource>();

  for (const t of input.timings) {
    const p = t.provenance;
    if (p.validationResult !== "ACCEPTED") {
      blockers.push(
        `session timing source ${p.sourceId} is ${p.validationResult}: ${p.rejectionDetail ?? "no detail"}`,
      );
      continue;
    }
    if (p.extractionVersion !== TIMING_EXTRACTION_VERSION) {
      blockers.push(
        `session timing source ${p.sourceId} was extracted by version ${p.extractionVersion}, ` +
          `this build requires ${TIMING_EXTRACTION_VERSION}`,
      );
      continue;
    }
    if (p.contentBytes > MAX_TIMING_SOURCE_BYTES) {
      blockers.push(`session timing source ${p.sourceId} exceeds the evidence size limit`);
      continue;
    }
    if (t.evidence.length === 0 || t.evidence.length > MAX_TIMING_EVIDENCE_ROWS) {
      blockers.push(
        `session timing source ${p.sourceId} carries ${t.evidence.length} evidence rows, which is ` +
          `outside 1..${MAX_TIMING_EVIDENCE_ROWS}`,
      );
      continue;
    }
    if (t.evidence.some((r) => r.value.length > MAX_TIMING_EVIDENCE_VALUE_CHARS)) {
      blockers.push(`session timing source ${p.sourceId} carries an oversized evidence value`);
      continue;
    }
    if (t.openIst === null || t.closeIst === null || !HHMM.test(t.openIst) || !HHMM.test(t.closeIst)) {
      blockers.push(`session timing source ${p.sourceId} does not carry a usable open/close time`);
      continue;
    }
    if (t.closeIst <= t.openIst) {
      blockers.push(`session timing source ${p.sourceId} closes at or before it opens`);
      continue;
    }
    if (p.effectiveYear !== null && !years.includes(p.effectiveYear)) {
      blockers.push(
        `session timing source ${p.sourceId} is effective for ${p.effectiveYear}, which this calendar ` +
          `does not cover`,
      );
      continue;
    }
    const existing = chosen.get(p.exchange);
    if (existing) {
      // Two documents for one exchange are equal-priority by construction. Equal
      // priority with different content fails closed rather than picking one.
      if (existing.openIst !== t.openIst || existing.closeIst !== t.closeIst) {
        blockers.push(
          `contradictory equal-priority ${p.exchange} session timing sources: ` +
            [
              `${existing.provenance.sourceId}=${existing.openIst}-${existing.closeIst}`,
              `${p.sourceId}=${t.openIst}-${t.closeIst}`,
            ]
              .sort()
              .join(" vs "),
        );
        chosen.delete(p.exchange);
      }
      continue;
    }
    chosen.set(p.exchange, t);
  }

  for (const exchange of exchanges) {
    if (!chosen.has(exchange)) {
      blockers.push(
        `no official ${exchange} regular-session timing source: regular-session hours for ${exchange} ` +
          `are not established`,
      );
    }
  }
  return chosen;
}

interface Declaration {
  readonly event: CalendarSourceEvent;
  readonly provenance: CalendarSourceProvenance;
  readonly overrideReason: string | null;
}

function eventShape(e: CalendarSourceEvent): string {
  return `${e.sessionType}|${e.scheduledOpenIst ?? "-"}|${e.scheduledCloseIst ?? "-"}`;
}

/**
 * Normalize official sources into one deterministic, enumerated calendar.
 *
 * Conflict handling implements the owner's source-update policy: a later,
 * specifically applicable official circular may override the annual calendar,
 * both sources are preserved, and two contradictory sources of EQUAL priority
 * are rejected rather than silently resolved.
 */
export function buildExchangeCalendar(input: BuildCalendarInput): ExchangeCalendarGeneration {
  const blockers: string[] = [];
  const years = [...new Set(input.years)].sort((a, b) => a - b);
  const exchanges = [...new Set(input.exchanges)].sort();

  for (const s of input.sources) {
    if (s.provenance.validationResult !== "ACCEPTED") {
      blockers.push(
        `calendar source ${s.provenance.sourceId} is ${s.provenance.validationResult}: ` +
          (s.provenance.rejectionDetail ?? "no detail"),
      );
    }
    if (!isRealIstDate(s.provenance.effectiveFrom) || !isRealIstDate(s.provenance.effectiveTo)) {
      blockers.push(`calendar source ${s.provenance.sourceId} has an unreal effective period`);
    }
  }

  // Every exchange/year pair MUST be backed by an accepted annual calendar.
  // A year with only circulars is not a calendar; it is a set of amendments to
  // a document we do not hold.
  for (const exchange of exchanges) {
    for (const year of years) {
      const hasAnnual = input.sources.some(
        (s) =>
          s.provenance.exchange === exchange &&
          s.provenance.calendarYear === year &&
          s.provenance.kind === "ANNUAL_CALENDAR" &&
          s.provenance.validationResult === "ACCEPTED",
      );
      if (!hasAnnual) {
        blockers.push(`no accepted official annual trading calendar for ${exchange} ${year}`);
      }
    }
  }

  const timings = resolveExchangeTimings(input, exchanges, years, blockers);

  // Resolve one declaration per exchange+date.
  const declarations = new Map<string, Declaration>();
  const byDate = new Map<string, { event: CalendarSourceEvent; provenance: CalendarSourceProvenance }[]>();

  for (const source of input.sources) {
    if (source.provenance.validationResult !== "ACCEPTED") continue;
    for (const event of source.events) {
      if (!isRealIstDate(event.tradingDate)) {
        blockers.push(
          `calendar source ${source.provenance.sourceId} declared unreal date "${event.tradingDate}"`,
        );
        continue;
      }
      if (
        event.tradingDate < source.provenance.effectiveFrom ||
        event.tradingDate > source.provenance.effectiveTo
      ) {
        blockers.push(
          `calendar source ${source.provenance.sourceId} declared ${event.tradingDate} outside its ` +
            `effective period ${source.provenance.effectiveFrom}..${source.provenance.effectiveTo}`,
        );
        continue;
      }
      const key = `${event.exchange}|${event.tradingDate}`;
      const list = byDate.get(key);
      if (list) list.push({ event, provenance: source.provenance });
      else byDate.set(key, [{ event, provenance: source.provenance }]);
    }
  }

  for (const [key, candidates] of byDate) {
    // Highest precedence first; among equals, the later official issue date.
    const ranked = [...candidates].sort((a, b) => {
      const p = KIND_PRECEDENCE[b.provenance.kind] - KIND_PRECEDENCE[a.provenance.kind];
      if (p !== 0) return p;
      if (a.provenance.issuedAt !== b.provenance.issuedAt) {
        return a.provenance.issuedAt < b.provenance.issuedAt ? 1 : -1;
      }
      return a.provenance.sourceId < b.provenance.sourceId ? -1 : 1;
    });
    const winner = ranked[0];
    const peers = ranked.filter(
      (c) =>
        c.provenance.kind === winner.provenance.kind &&
        c.provenance.issuedAt === winner.provenance.issuedAt,
    );
    const contradictory = peers.filter((c) => eventShape(c.event) !== eventShape(winner.event));
    if (contradictory.length > 0) {
      blockers.push(
        `contradictory equal-priority official sources for ${key}: ` +
          peers
            .map((c) => `${c.provenance.sourceId}=${eventShape(c.event)}`)
            .sort()
            .join(" vs "),
      );
      continue;
    }
    const displaced = ranked.filter((c) => eventShape(c.event) !== eventShape(winner.event));
    const overrideReason =
      displaced.length > 0
        ? `official ${winner.provenance.kind} ${winner.provenance.sourceId} issued ${winner.provenance.issuedAt} ` +
          `overrides ${displaced
            .map((d) => `${d.provenance.sourceId}=${eventShape(d.event)}`)
            .sort()
            .join(", ")}`
        : null;
    declarations.set(key, { event: winner.event, provenance: winner.provenance, overrideReason });
  }

  // Enumerate. Every day of every covered year gets an explicit record, so no
  // consumer ever has to reconstruct "what would the default have been".
  const draft: Omit<TradingSessionRecord, "calendarGenerationId">[] = [];
  for (const exchange of exchanges) {
    for (const year of years) {
      for (const date of enumerateYear(year)) {
        const decl = declarations.get(`${exchange}|${date}`);
        if (decl) {
          const e = decl.event;
          const open = e.sessionType === "CLOSED" ? null : e.scheduledOpenIst;
          const close = e.sessionType === "CLOSED" ? null : e.scheduledCloseIst;
          const closeMs = close === null ? null : istWallClockToEpochMs(date, close);
          if (close !== null && closeMs === null) {
            blockers.push(`calendar declaration for ${exchange} ${date} has an unparseable close time`);
          }
          draft.push({
            exchange,
            tradingDate: date,
            sessionType: e.sessionType,
            dayKind:
              e.sessionType === "CLOSED"
                ? isWeekend(date)
                  ? "WEEKEND"
                  : "EXCHANGE_HOLIDAY"
                : "TRADING_DAY",
            scheduledOpenIst: open,
            scheduledCloseIst: close,
            scheduledCloseMs: closeMs,
            timesOfficiallyNotified: e.sessionType === "CLOSED" ? false : close !== null,
            description: e.description,
            sourceId: decl.provenance.sourceId,
            sourceEffectiveDate: decl.provenance.effectiveFrom,
            // A date-specific official event carries its own timings, or none.
            timingSourceId: null,
            overrideReason: decl.overrideReason,
          });
          continue;
        }
        const annual = input.sources.find(
          (s) =>
            s.provenance.exchange === exchange &&
            s.provenance.calendarYear === year &&
            s.provenance.kind === "ANNUAL_CALENDAR",
        );
        const weekend = isWeekend(date);
        // Precedence step 3: this exchange's OWN official timing document. When
        // it is absent the day is still a trading day — we simply do not claim
        // to know when it opens or closes.
        const timing = weekend ? undefined : timings.get(exchange);
        const open = timing?.openIst ?? null;
        const close = timing?.closeIst ?? null;
        draft.push({
          exchange,
          tradingDate: date,
          sessionType: weekend ? "CLOSED" : "REGULAR",
          dayKind: weekend ? "WEEKEND" : "TRADING_DAY",
          scheduledOpenIst: open,
          scheduledCloseIst: close,
          scheduledCloseMs: close === null ? null : istWallClockToEpochMs(date, close),
          timesOfficiallyNotified: close !== null,
          description: weekend ? "weekend" : "ordinary regular session",
          sourceId: annual?.provenance.sourceId ?? "UNKNOWN",
          sourceEffectiveDate: annual?.provenance.effectiveFrom ?? date,
          timingSourceId: timing?.provenance.sourceId ?? null,
          overrideReason: null,
        });
      }
    }
  }

  draft.sort((a, b) =>
    a.exchange === b.exchange
      ? a.tradingDate < b.tradingDate
        ? -1
        : 1
      : a.exchange < b.exchange
        ? -1
        : 1,
  );

  const sources = [...input.sources.map((s) => s.provenance)].sort((a, b) =>
    a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0,
  );
  const timingSources = [...input.timings].sort((a, b) =>
    a.provenance.sourceId < b.provenance.sourceId
      ? -1
      : a.provenance.sourceId > b.provenance.sourceId
        ? 1
        : 0,
  );
  const coveredYears = exchanges.flatMap((exchange) => years.map((year) => ({ exchange, year })));
  const uniqueBlockers = [...new Set(blockers)].sort();

  const calendarChecksum = computeCalendarChecksum({
    schemaVersion: CALENDAR_SCHEMA_VERSION,
    policyVersion: CALENDAR_POLICY_VERSION,
    coveredYears,
    sources,
    timings: timingSources,
    sessions: draft,
    blockers: uniqueBlockers,
  });
  const calendarGenerationId = deriveCalendarGenerationId(calendarChecksum);

  return Object.freeze({
    calendarGenerationId,
    schemaVersion: CALENDAR_SCHEMA_VERSION,
    policyVersion: CALENDAR_POLICY_VERSION,
    generatedAt: input.generatedAt,
    coveredYears: Object.freeze(coveredYears),
    sources: Object.freeze(sources),
    timings: Object.freeze(timingSources),
    sessions: Object.freeze(draft.map((d) => Object.freeze({ ...d, calendarGenerationId }))),
    calendarChecksum,
    valid: uniqueBlockers.length === 0,
    blockers: Object.freeze(uniqueBlockers),
  });
}

// ── queries ──────────────────────────────────────────────────────────────────

export type SessionLookup =
  | { readonly known: true; readonly session: TradingSessionRecord }
  | { readonly known: false; readonly reason: string };

function coversYear(cal: ExchangeCalendarGeneration, exchange: CalendarExchange, year: number): boolean {
  return cal.coveredYears.some((c) => c.exchange === exchange && c.year === year);
}

export function getTradingSession(
  cal: ExchangeCalendarGeneration,
  exchange: CalendarExchange,
  date: string,
): SessionLookup {
  if (!cal.valid) return { known: false, reason: `calendar is invalid: ${cal.blockers.join("; ")}` };
  if (!isRealIstDate(date)) return { known: false, reason: `"${date}" is not a real calendar date` };
  const year = Number(date.slice(0, 4));
  if (!coversYear(cal, exchange, year)) {
    return { known: false, reason: `no official ${exchange} calendar for year ${year}` };
  }
  const session = cal.sessions.find((s) => s.exchange === exchange && s.tradingDate === date);
  if (!session) return { known: false, reason: `${exchange} ${date} is not present in the calendar` };
  return { known: true, session };
}

/** `null` means UNKNOWN and must fail closed at the caller. */
export function isTradingDate(
  cal: ExchangeCalendarGeneration,
  exchange: CalendarExchange,
  date: string,
): boolean | null {
  const lookup = getTradingSession(cal, exchange, date);
  if (!lookup.known) return null;
  return lookup.session.sessionType !== "CLOSED";
}

export type CompletedSessionResult =
  | { readonly ok: true; readonly session: TradingSessionRecord }
  | { readonly ok: false; readonly reason: string };

/**
 * The most recent session that has FINISHED, per rules 2–4.
 *
 * A session in progress, or in pre-open, is not completed — the scan simply
 * continues to the one before it. But a session whose timings the exchange has
 * not yet notified is NOT skipped: skipping it would silently nominate an older
 * session as "latest", which is a false claim. That case fails closed.
 */
export function getLatestCompletedTradingSession(
  cal: ExchangeCalendarGeneration,
  exchange: CalendarExchange,
  nowMs: number,
): CompletedSessionResult {
  if (!cal.valid) return { ok: false, reason: `calendar is invalid: ${cal.blockers.join("; ")}` };
  if (!Number.isFinite(nowMs)) return { ok: false, reason: "evaluation clock is not a finite instant" };
  const today = istDateString(nowMs);
  if (!isRealIstDate(today)) return { ok: false, reason: "evaluation clock is not a finite instant" };
  if (!coversYear(cal, exchange, Number(today.slice(0, 4)))) {
    return { ok: false, reason: `no official ${exchange} calendar for year ${today.slice(0, 4)}` };
  }

  const candidates = cal.sessions
    .filter((s) => s.exchange === exchange && s.tradingDate <= today && s.sessionType !== "CLOSED")
    .sort((a, b) => (a.tradingDate < b.tradingDate ? 1 : -1));

  for (const session of candidates) {
    if (!session.timesOfficiallyNotified || session.scheduledCloseMs === null) {
      if (session.tradingDate < today) {
        // The IST day has fully ended, so the session has certainly finished —
        // but its close instant is unknown, and callers reconcile against the
        // close. Refuse rather than invent one.
        return {
          ok: false,
          reason:
            `${exchange} session ${session.tradingDate} (${session.sessionType}) has no officially ` +
            `notified timings, so the latest completed session cannot be established`,
        };
      }
      return {
        ok: false,
        reason:
          `${exchange} session ${session.tradingDate} (${session.sessionType}) timings are not yet ` +
          `officially notified, so its completion cannot be determined`,
      };
    }
    if (nowMs >= session.scheduledCloseMs) return { ok: true, session };
  }

  const earliest = candidates.length > 0 ? candidates[candidates.length - 1].tradingDate : today;
  return {
    ok: false,
    reason: `no completed ${exchange} session on or before ${today} within calendar coverage (earliest examined ${earliest})`,
  };
}

/** The latest open session STRICTLY before `date`. */
export function getPreviousTradingSession(
  cal: ExchangeCalendarGeneration,
  exchange: CalendarExchange,
  date: string,
): CompletedSessionResult {
  if (!cal.valid) return { ok: false, reason: `calendar is invalid: ${cal.blockers.join("; ")}` };
  if (!isRealIstDate(date)) return { ok: false, reason: `"${date}" is not a real calendar date` };
  const year = Number(date.slice(0, 4));
  if (!coversYear(cal, exchange, year)) {
    return { ok: false, reason: `no official ${exchange} calendar for year ${year}` };
  }
  const prior = cal.sessions
    .filter((s) => s.exchange === exchange && s.tradingDate < date && s.sessionType !== "CLOSED")
    .sort((a, b) => (a.tradingDate < b.tradingDate ? 1 : -1))[0];
  if (!prior) {
    return { ok: false, reason: `no ${exchange} session before ${date} within calendar coverage` };
  }
  return { ok: true, session: prior };
}

export type BhavcopyValidationCode =
  | "VALID_LATEST_COMPLETED"
  | "INVALID_DATE"
  | "FUTURE_DATED"
  | "NOT_A_TRADING_SESSION"
  | "LATEST_COMPLETED_UNKNOWN"
  | "NOT_LATEST_COMPLETED";

export interface BhavcopyValidation {
  readonly ok: boolean;
  readonly code: BhavcopyValidationCode;
  readonly expectedTradingDate: string | null;
  readonly reason: string;
}

/**
 * Rule 10 — a bhavcopy/UDiFF is acceptable as reconciliation evidence only when
 * it is EXACTLY the latest completed session. Older is stale, newer is
 * impossible, future-dated is invalid.
 */
export function validateBhavcopySession(
  cal: ExchangeCalendarGeneration,
  exchange: CalendarExchange,
  bhavcopyDate: string,
  nowMs: number,
): BhavcopyValidation {
  if (!isRealIstDate(bhavcopyDate)) {
    return {
      ok: false,
      code: "INVALID_DATE",
      expectedTradingDate: null,
      reason: `bhavcopy date "${bhavcopyDate}" is not a real calendar date`,
    };
  }
  const today = istDateString(nowMs);
  if (bhavcopyDate > today) {
    return {
      ok: false,
      code: "FUTURE_DATED",
      expectedTradingDate: null,
      reason: `bhavcopy date ${bhavcopyDate} is in the future (IST today ${today})`,
    };
  }
  const latest = getLatestCompletedTradingSession(cal, exchange, nowMs);
  if (!latest.ok) {
    return {
      ok: false,
      code: "LATEST_COMPLETED_UNKNOWN",
      expectedTradingDate: null,
      reason: latest.reason,
    };
  }
  const session = getTradingSession(cal, exchange, bhavcopyDate);
  if (!session.known || session.session.sessionType === "CLOSED") {
    return {
      ok: false,
      code: "NOT_A_TRADING_SESSION",
      expectedTradingDate: latest.session.tradingDate,
      reason: `${exchange} ${bhavcopyDate} is not an official trading session`,
    };
  }
  if (bhavcopyDate !== latest.session.tradingDate) {
    return {
      ok: false,
      code: "NOT_LATEST_COMPLETED",
      expectedTradingDate: latest.session.tradingDate,
      reason:
        `bhavcopy is dated ${bhavcopyDate} but the latest completed ${exchange} session is ` +
        `${latest.session.tradingDate}`,
    };
  }
  return {
    ok: true,
    code: "VALID_LATEST_COMPLETED",
    expectedTradingDate: latest.session.tradingDate,
    reason: `bhavcopy matches the latest completed ${exchange} session ${bhavcopyDate}`,
  };
}

/**
 * Adapt the calendar to the input shape the BSE reference policy consumes.
 *
 * Anything the calendar cannot establish becomes `UNKNOWN_TRADING_CALENDAR`
 * rather than a partially-filled verdict, because the policy treats a known
 * calendar as licence to proceed to the UDiFF checks.
 */
export function toTradingCalendarVerdict(
  cal: ExchangeCalendarGeneration,
  exchange: CalendarExchange,
  nowMs: number,
): TradingCalendarVerdict {
  const latest = getLatestCompletedTradingSession(cal, exchange, nowMs);
  const todayLookup = getTradingSession(cal, exchange, istDateString(nowMs));
  if (!latest.ok || !todayLookup.known) {
    return { known: false, dayKind: null, latestCompletedSessionDate: null };
  }
  return {
    known: true,
    dayKind: todayLookup.session.dayKind,
    latestCompletedSessionDate: latest.session.tradingDate,
  };
}

// ── manifest commitment ──────────────────────────────────────────────────────

/**
 * What the registry manifest carries about the calendar.
 *
 * NO SEPARATE CALENDAR TABLE EXISTS BY DESIGN. The calendar's only consumer is
 * registry authority, and the registry manifest is already a checksummed,
 * cold-loaded, last-good-preserving durable record. Committing the calendar
 * inside it means the manifest checksum covers the calendar, one storage path
 * is validated instead of two, and an invalid calendar cannot replace an
 * accepted one because it can never reach an accepted manifest.
 *
 * The ENUMERATED SESSIONS ARE EMBEDDED, deliberately. Carrying only the
 * checksum would make the commitment unverifiable: a reader could re-derive the
 * id from the checksum, but nothing would tie that checksum to any real
 * calendar, so a fabricated-but-self-consistent commitment naming any
 * convenient "latest completed session" would pass every check. With the
 * sessions present, `verifyCalendarCommitment` RECOMPUTES the checksum from the
 * committed contents and RE-DERIVES the latest completed session from them, so
 * the only way to pass is to hold a calendar that actually says so.
 */
export interface TradingCalendarCommitment {
  readonly calendarGenerationId: string;
  readonly calendarChecksum: string;
  readonly calendarSchemaVersion: number;
  readonly calendarPolicyVersion: number;
  readonly valid: boolean;
  readonly coveredYears: readonly { readonly exchange: CalendarExchange; readonly year: number }[];
  readonly sources: readonly CalendarSourceProvenance[];
  /**
   * The official timing documents, WITH their normalized evidence rows. This is
   * what makes the committed session hours reproducible by a later reviewer
   * instead of merely asserted.
   */
  readonly timings: readonly SessionTimingSource[];
  readonly sessions: readonly TradingSessionRecord[];
  readonly blockers: readonly string[];
  readonly latestCompletedSession: Readonly<Record<CalendarExchange, string | null>>;
  readonly evaluatedAt: string;
}

/** Rebuild the queryable calendar from a stored commitment, for re-derivation. */
export function calendarFromCommitment(
  commitment: TradingCalendarCommitment,
): ExchangeCalendarGeneration {
  return {
    calendarGenerationId: commitment.calendarGenerationId,
    schemaVersion: commitment.calendarSchemaVersion,
    policyVersion: commitment.calendarPolicyVersion,
    generatedAt: commitment.evaluatedAt,
    coveredYears: commitment.coveredYears,
    sources: commitment.sources,
    timings: commitment.timings ?? [],
    sessions: commitment.sessions,
    calendarChecksum: commitment.calendarChecksum,
    valid: commitment.valid,
    blockers: commitment.blockers,
  };
}

export function toCalendarCommitment(
  cal: ExchangeCalendarGeneration,
  nowMs: number,
): TradingCalendarCommitment {
  const nse = getLatestCompletedTradingSession(cal, "NSE", nowMs);
  const bse = getLatestCompletedTradingSession(cal, "BSE", nowMs);
  return Object.freeze({
    calendarGenerationId: cal.calendarGenerationId,
    calendarChecksum: cal.calendarChecksum,
    calendarSchemaVersion: cal.schemaVersion,
    calendarPolicyVersion: cal.policyVersion,
    valid: cal.valid,
    coveredYears: cal.coveredYears,
    sources: cal.sources,
    timings: cal.timings,
    sessions: cal.sessions,
    blockers: cal.blockers,
    latestCompletedSession: Object.freeze({
      NSE: nse.ok ? nse.session.tradingDate : null,
      BSE: bse.ok ? bse.session.tradingDate : null,
    }),
    evaluatedAt: new Date(nowMs).toISOString(),
  });
}

/**
 * Full re-verification of a commitment read back from storage.
 *
 * NOT a structural check. The checksum is RECOMPUTED from the committed
 * contents and the latest completed session is RE-DERIVED from the committed
 * sessions at the committed evaluation instant. A commitment that merely looks
 * well-formed — correct versions, plausible dates, an id that derives from an
 * asserted checksum — does not pass; only one that actually holds a calendar
 * saying what it claims does.
 */
export function verifyCalendarCommitmentIntegrity(
  commitment: TradingCalendarCommitment | null | undefined,
): readonly string[] {
  if (!commitment) return ["manifest carries no trading-calendar commitment"];
  const problems: string[] = [];
  if (commitment.valid !== true) problems.push("committed trading calendar is not valid");
  if (!Array.isArray(commitment.sessions) || commitment.sessions.length === 0) {
    problems.push("committed trading calendar carries no enumerated sessions");
  }
  if (!Array.isArray(commitment.coveredYears) || commitment.coveredYears.length === 0) {
    problems.push("committed trading calendar covers no exchange/year");
  }
  if (!Array.isArray(commitment.blockers) || commitment.blockers.length > 0) {
    problems.push("committed trading calendar carries blockers");
  }
  if (commitment.calendarSchemaVersion !== CALENDAR_SCHEMA_VERSION) {
    problems.push(
      `committed calendar schema ${commitment.calendarSchemaVersion} != ${CALENDAR_SCHEMA_VERSION}`,
    );
  }
  if (commitment.calendarPolicyVersion !== CALENDAR_POLICY_VERSION) {
    problems.push(
      `committed calendar policy ${commitment.calendarPolicyVersion} != ${CALENDAR_POLICY_VERSION}`,
    );
  }
  if (commitment.calendarGenerationId !== deriveCalendarGenerationId(commitment.calendarChecksum)) {
    problems.push("committed calendar generation id is not derived from its checksum");
  }
  if (commitment.sources.length === 0) {
    problems.push("committed trading calendar carries no official source provenance");
  }
  for (const s of commitment.sources) {
    if (s.validationResult !== "ACCEPTED") {
      problems.push(`committed calendar source ${s.sourceId} is ${s.validationResult}`);
    }
  }
  const timings = commitment.timings ?? [];
  for (const exchange of ["NSE", "BSE"] as const) {
    if (!commitment.sources.some((s) => s.exchange === exchange)) {
      problems.push(`committed trading calendar has no ${exchange} source`);
    }
    if (!commitment.coveredYears.some((c) => c.exchange === exchange)) {
      problems.push(`committed trading calendar covers no ${exchange} year`);
    }
    // Each exchange must carry its OWN accepted timing document with its own
    // reproducible evidence. Identical hours across exchanges are fine; a
    // shared or missing provenance is not.
    const own = timings.filter((t) => t.provenance.exchange === exchange);
    if (own.length === 0) {
      problems.push(`committed trading calendar has no ${exchange} regular-session timing source`);
      continue;
    }
    for (const t of own) {
      if (t.provenance.validationResult !== "ACCEPTED") {
        problems.push(
          `committed ${exchange} timing source ${t.provenance.sourceId} is ${t.provenance.validationResult}`,
        );
      }
      if (t.provenance.extractionVersion !== TIMING_EXTRACTION_VERSION) {
        problems.push(
          `committed ${exchange} timing source ${t.provenance.sourceId} has extraction version ` +
            `${t.provenance.extractionVersion}, expected ${TIMING_EXTRACTION_VERSION}`,
        );
      }
      if (t.evidence.length === 0) {
        problems.push(
          `committed ${exchange} timing source ${t.provenance.sourceId} carries no reproducible evidence`,
        );
      }
      if (t.openIst === null || t.closeIst === null) {
        problems.push(
          `committed ${exchange} timing source ${t.provenance.sourceId} carries no open/close time`,
        );
      }
    }
  }
  const timingIds = new Set(timings.map((t) => t.provenance.sourceId));
  for (const s of commitment.sessions) {
    if (s.timingSourceId !== null && !timingIds.has(s.timingSourceId)) {
      problems.push(
        `committed session ${s.exchange} ${s.tradingDate} cites timing source ${s.timingSourceId}, ` +
          `which the commitment does not carry`,
      );
      break;
    }
  }

  // RECOMPUTE the checksum from the committed contents. Without this the
  // checksum is an unverifiable assertion and the derived id proves nothing.
  const recomputed = computeCalendarChecksum({
    schemaVersion: commitment.calendarSchemaVersion,
    policyVersion: commitment.calendarPolicyVersion,
    coveredYears: commitment.coveredYears,
    sources: commitment.sources,
    timings,
    sessions: unstamp(commitment.sessions),
    blockers: commitment.blockers,
  });
  if (recomputed !== commitment.calendarChecksum) {
    problems.push("committed calendar checksum does not match its own contents");
  }
  if (commitment.sessions.some((s) => s.calendarGenerationId !== commitment.calendarGenerationId)) {
    problems.push("committed calendar contains sessions stamped by a different generation");
  }

  // RE-DERIVE the latest completed session from the committed sessions at the
  // committed instant. A commitment may only claim what its own calendar says.
  const evaluatedAtMs = Date.parse(commitment.evaluatedAt);
  if (!Number.isFinite(evaluatedAtMs)) {
    problems.push(`committed calendar evaluation instant "${commitment.evaluatedAt}" is not a real instant`);
  } else if (problems.length === 0) {
    const rebuilt = calendarFromCommitment(commitment);
    for (const exchange of ["NSE", "BSE"] as const) {
      const derived = getLatestCompletedTradingSession(rebuilt, exchange, evaluatedAtMs);
      const actual = derived.ok ? derived.session.tradingDate : null;
      const claimed = commitment.latestCompletedSession?.[exchange] ?? null;
      if (claimed !== actual) {
        problems.push(
          `committed latest completed ${exchange} session ${claimed ?? "null"} does not follow from the ` +
            `committed calendar (it says ${actual ?? "null"})`,
        );
      }
    }
  }

  return problems.sort();
}

// ── current-time authority ───────────────────────────────────────────────────

/**
 * `CURRENT_AUTHORITATIVE` — the commitment is intact AND still speaks for now.
 * `LAST_KNOWN`           — intact, but out of date: usable for display
 *                          continuity, never for authority.
 * `STALE`                — not intact, or not evaluable. Nothing may rely on it.
 */
export type CalendarAuthorityState = "CURRENT_AUTHORITATIVE" | "LAST_KNOWN" | "STALE";

export interface CalendarAuthorityEvaluation {
  readonly state: CalendarAuthorityState;
  readonly reasons: readonly string[];
  readonly currentIstDate: string | null;
  readonly committedLatestCompletedSession: Readonly<Record<CalendarExchange, string | null>>;
  readonly requiredLatestCompletedSession: Readonly<Record<CalendarExchange, string | null>>;
  readonly evaluatedAtMs: number;
  /**
   * The next instant at which this verdict could change — the earlier of the
   * next IST midnight and the next scheduled session close. A caller may cache
   * the evaluation until then, which is what keeps the authority check off the
   * per-tick path without ever letting it go stale.
   */
  readonly validUntilMs: number;
}

const NO_SESSIONS: Readonly<Record<CalendarExchange, string | null>> = Object.freeze({
  NSE: null,
  BSE: null,
});

function nextIstMidnightMs(today: string): number | null {
  return istWallClockToEpochMs(addDays(today, 1), "00:00");
}

/**
 * Does this commitment still carry authority AT `nowMs`?
 *
 * Separate from `verifyCalendarCommitmentIntegrity` on purpose. Integrity is a
 * property of the committed bytes and is evaluated at the instant the
 * commitment was made — it is immutable and must never change with the clock.
 * Authority is a property of the CURRENT moment: a perfectly intact 2026
 * calendar stops being authoritative the instant 2027 begins, and a perfectly
 * intact snapshot reconciled to Tuesday's BSE session stops being current the
 * moment Wednesday's session completes.
 *
 * NON-MUTATING. Nothing here rewrites a stored checksum, an evaluation instant
 * or a latest-completed claim: an expired commitment keeps its original figures
 * and merely loses the right to be believed.
 *
 * BOUNDED: one pass over the committed sessions, no rebuild, no per-record
 * work beyond it, and a `validUntilMs` so callers can cache between boundaries.
 */
export function evaluateCalendarAuthorityNow(
  commitment: TradingCalendarCommitment | null | undefined,
  nowMs: number,
): CalendarAuthorityEvaluation {
  const stale = (reasons: readonly string[], today: string | null): CalendarAuthorityEvaluation =>
    Object.freeze({
      state: "STALE" as const,
      reasons: Object.freeze([...reasons].sort()),
      currentIstDate: today,
      committedLatestCompletedSession: commitment?.latestCompletedSession ?? NO_SESSIONS,
      requiredLatestCompletedSession: NO_SESSIONS,
      evaluatedAtMs: nowMs,
      validUntilMs: nowMs,
    });

  if (!Number.isFinite(nowMs)) return stale(["evaluation clock is not a finite instant"], null);
  const today = istDateString(nowMs);
  if (!isRealIstDate(today)) return stale(["evaluation clock does not resolve to a real IST date"], null);

  const integrity = verifyCalendarCommitmentIntegrity(commitment);
  if (integrity.length > 0 || !commitment) return stale(integrity, today);

  const currentYear = Number(today.slice(0, 4));
  const exchanges = [...new Set(commitment.coveredYears.map((c) => c.exchange))].sort();
  const rebuilt = calendarFromCommitment(commitment);
  const reasons: string[] = [];
  const required: Record<CalendarExchange, string | null> = { NSE: null, BSE: null };

  for (const exchange of exchanges) {
    if (!coversYear(rebuilt, exchange, currentYear)) {
      reasons.push(
        `committed calendar does not cover ${exchange} ${currentYear}: its coverage ended before today (${today})`,
      );
      continue;
    }
    const timing = commitment.timings.find((t) => t.provenance.exchange === exchange);
    if (timing && timing.provenance.effectiveYear !== null && timing.provenance.effectiveYear !== currentYear) {
      reasons.push(
        `${exchange} regular-session timing source ${timing.provenance.sourceId} is effective for ` +
          `${timing.provenance.effectiveYear}, not ${currentYear}`,
      );
    }
    const latest = getLatestCompletedTradingSession(rebuilt, exchange, nowMs);
    required[exchange] = latest.ok ? latest.session.tradingDate : null;
    if (!latest.ok) {
      reasons.push(`latest completed ${exchange} session cannot be established now: ${latest.reason}`);
    }
  }

  // The BSE reference universe is bound to a COMPLETED SESSION, not to an age.
  // Once a newer BSE session has completed, the committed List-of-Scrips
  // reconciliation is no longer the one current policy requires.
  const committedBse = commitment.latestCompletedSession?.BSE ?? null;
  if (required.BSE !== null && committedBse !== null && required.BSE !== committedBse) {
    reasons.push(
      `committed BSE reconciliation is bound to session ${committedBse}, but the latest completed BSE ` +
        `session is now ${required.BSE}`,
    );
  }

  const midnight = nextIstMidnightMs(today);
  let boundary = midnight ?? nowMs + 60_000;
  for (const s of commitment.sessions) {
    if (s.scheduledCloseMs !== null && s.scheduledCloseMs > nowMs && s.scheduledCloseMs < boundary) {
      boundary = s.scheduledCloseMs;
    }
  }

  return Object.freeze({
    state: reasons.length === 0 ? ("CURRENT_AUTHORITATIVE" as const) : ("LAST_KNOWN" as const),
    reasons: Object.freeze(reasons.sort()),
    currentIstDate: today,
    committedLatestCompletedSession: commitment.latestCompletedSession,
    requiredLatestCompletedSession: Object.freeze(required),
    evaluatedAtMs: nowMs,
    validUntilMs: boundary,
  });
}
