/**
 * Static market-session table for the equity / index rows in the dashboard.
 *
 * The badge is computed entirely in the user's browser (no server call) from
 * the exchange code that the API attaches to each row (`exchange` field on
 * `GlobalDashboardRow`). This means the "Market open / closed (next open in
 * 3h)" pill always reflects the user's wall clock, with the exchange's local
 * trading hours rendered into UTC via `Intl.DateTimeFormat`.
 *
 * Holiday calendars are intentionally NOT modelled here — a row that is
 * "stale" on a half-day holiday would still get an "Open" badge. The cost
 * of getting the wrong badge on ~10 days/year is much smaller than the cost
 * of bundling and maintaining a per-exchange holiday table client-side.
 *
 * Pre / post sessions are only modelled for NYSE because that's the only
 * venue in our universe where extended-hours trading meaningfully differs
 * from the cash session. All other venues report only "open" or "closed".
 */
export type MarketState = "open" | "closed" | "pre" | "post";

interface SessionDef {
  /** IANA timezone — passed to `Intl.DateTimeFormat`. */
  tz: string;
  /** Cash-session open in the exchange's local time. */
  open: { h: number; m: number };
  /** Cash-session close in the exchange's local time. */
  close: { h: number; m: number };
  /** Optional pre-market start (only set for NYSE today). */
  preOpen?: { h: number; m: number };
  /** Optional post-market end (only set for NYSE today). */
  postClose?: { h: number; m: number };
  /** Human-readable name shown in the tooltip. */
  label: string;
}

const SESSIONS: Record<string, SessionDef> = {
  // ── Task-specified primaries ─────────────────────────────────────
  NYSE: {
    tz: "America/New_York",
    open: { h: 9, m: 30 }, close: { h: 16, m: 0 },
    preOpen: { h: 4, m: 0 }, postClose: { h: 20, m: 0 },
    label: "NYSE / NASDAQ",
  },
  LSE:  { tz: "Europe/London",   open: { h: 8, m: 0 },  close: { h: 16, m: 30 }, label: "London Stock Exchange" },
  XETR: { tz: "Europe/Berlin",   open: { h: 9, m: 0 },  close: { h: 17, m: 30 }, label: "Frankfurt (Xetra)" },
  EPA:  { tz: "Europe/Paris",    open: { h: 9, m: 0 },  close: { h: 17, m: 30 }, label: "Euronext Paris" },
  SWX:  { tz: "Europe/Zurich",   open: { h: 9, m: 0 },  close: { h: 17, m: 30 }, label: "SIX Swiss Exchange" },
  TSE:  { tz: "Asia/Tokyo",      open: { h: 9, m: 0 },  close: { h: 15, m: 0 },  label: "Tokyo Stock Exchange" },
  HKEX: { tz: "Asia/Hong_Kong",  open: { h: 9, m: 30 }, close: { h: 16, m: 0 },  label: "Hong Kong Exchange" },
  SSE:  { tz: "Asia/Shanghai",   open: { h: 9, m: 30 }, close: { h: 15, m: 0 },  label: "Shanghai Stock Exchange" },
  ASX:  { tz: "Australia/Sydney",open: { h: 10, m: 0 }, close: { h: 16, m: 0 },  label: "Australian Securities Exchange" },
  KRX:  { tz: "Asia/Seoul",      open: { h: 9, m: 0 },  close: { h: 15, m: 30 }, label: "Korea Exchange" },
  // ── Additional venues to cover the rest of the equity/index universe ─
  AMS:  { tz: "Europe/Amsterdam",   open: { h: 9, m: 0 },  close: { h: 17, m: 30 }, label: "Euronext Amsterdam" },
  BME:  { tz: "Europe/Madrid",      open: { h: 9, m: 0 },  close: { h: 17, m: 30 }, label: "BME Madrid" },
  BIT:  { tz: "Europe/Rome",        open: { h: 9, m: 0 },  close: { h: 17, m: 30 }, label: "Borsa Italiana" },
  STO:  { tz: "Europe/Stockholm",   open: { h: 9, m: 0 },  close: { h: 17, m: 30 }, label: "Nasdaq Stockholm" },
  TWSE: { tz: "Asia/Taipei",        open: { h: 9, m: 0 },  close: { h: 13, m: 30 }, label: "Taiwan Stock Exchange" },
  SGX:  { tz: "Asia/Singapore",     open: { h: 9, m: 0 },  close: { h: 17, m: 0 },  label: "Singapore Exchange" },
  MYX:  { tz: "Asia/Kuala_Lumpur",  open: { h: 9, m: 0 },  close: { h: 17, m: 0 },  label: "Bursa Malaysia" },
  IDX:  { tz: "Asia/Jakarta",       open: { h: 9, m: 0 },  close: { h: 15, m: 50 }, label: "Indonesia Stock Exchange" },
  NZX:  { tz: "Pacific/Auckland",   open: { h: 10, m: 0 }, close: { h: 16, m: 45 }, label: "NZX New Zealand" },
  NSE:  { tz: "Asia/Kolkata",       open: { h: 9, m: 15 }, close: { h: 15, m: 30 }, label: "NSE / BSE India" },
  B3:   { tz: "America/Sao_Paulo",  open: { h: 10, m: 0 }, close: { h: 17, m: 0 },  label: "B3 Brasil" },
  BMV:  { tz: "America/Mexico_City",open: { h: 8, m: 30 }, close: { h: 15, m: 0 },  label: "Bolsa Mexicana" },
  MOEX: { tz: "Europe/Moscow",      open: { h: 10, m: 0 }, close: { h: 18, m: 50 }, label: "Moscow Exchange" },
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

interface ZonedParts {
  y: number; mo: number; d: number;
  h: number; mi: number; s: number;
  weekday: number; // 0=Sun .. 6=Sat
}

function zonedParts(date: Date, tz: string): ZonedParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", weekday: "short",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return {
    y: Number(parts.year),
    mo: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour) % 24,
    mi: Number(parts.minute),
    s: Number(parts.second),
    weekday: WEEKDAY_INDEX[parts.weekday] ?? 0,
  };
}

function utcOffsetMs(date: Date, tz: string): number {
  const z = zonedParts(date, tz);
  const naive = Date.UTC(z.y, z.mo - 1, z.d, z.h, z.mi, z.s);
  return naive - date.getTime();
}

/**
 * Convert a (y, mo, d, h, m) tuple expressed in `tz` into the corresponding
 * UTC `Date`. Two-pass to handle DST transitions correctly.
 */
function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): Date {
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = utcOffsetMs(new Date(naive), tz);
  const guess = naive - off1;
  const off2 = utcOffsetMs(new Date(guess), tz);
  return new Date(off1 === off2 ? guess : naive - off2);
}

export interface MarketStatus {
  exchange: string;
  label: string;
  state: MarketState;
  /** UTC instant of the next regular cash-session open. */
  nextOpenUtc: Date;
  /** True for Saturday / Sunday in the exchange's local TZ. */
  weekend: boolean;
}

/**
 * Compute the current market session state for an exchange code. Returns
 * `null` for unknown exchanges (the caller should then render no badge).
 */
export function getMarketStatus(exchange: string | null | undefined, now: Date = new Date()): MarketStatus | null {
  if (!exchange) return null;
  const def = SESSIONS[exchange];
  if (!def) return null;

  const z = zonedParts(now, def.tz);
  const minutes = z.h * 60 + z.mi;
  const openMin = def.open.h * 60 + def.open.m;
  const closeMin = def.close.h * 60 + def.close.m;
  const preMin = def.preOpen ? def.preOpen.h * 60 + def.preOpen.m : null;
  const postMin = def.postClose ? def.postClose.h * 60 + def.postClose.m : null;
  const weekend = z.weekday === 0 || z.weekday === 6;

  let state: MarketState = "closed";
  if (!weekend) {
    if (minutes >= openMin && minutes < closeMin) state = "open";
    else if (preMin != null && minutes >= preMin && minutes < openMin) state = "pre";
    else if (postMin != null && minutes >= closeMin && minutes < postMin) state = "post";
  }

  // Find the next cash-session open instant. Scan today + up to 7 days
  // forward; that always covers a 3-day weekend with extra slack.
  let nextOpenUtc = zonedToUtc(z.y, z.mo, z.d, def.open.h, def.open.m, def.tz);
  for (let i = 0; i <= 8; i++) {
    const candidate = zonedToUtc(z.y, z.mo, z.d + i, def.open.h, def.open.m, def.tz);
    if (candidate.getTime() <= now.getTime()) continue;
    const cz = zonedParts(candidate, def.tz);
    if (cz.weekday === 0 || cz.weekday === 6) continue;
    nextOpenUtc = candidate;
    break;
  }

  return { exchange, label: def.label, state, nextOpenUtc, weekend };
}

/**
 * Format a millisecond duration as a short human string ("3h 12m", "45m",
 * "in <1m"). Used in the badge text and tooltip.
 */
export function fmtDurationShort(ms: number): string {
  if (ms < 60_000) return "<1m";
  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin - days * 60 * 24) / 60);
  const mins = totalMin - days * 60 * 24 - hours * 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  return `${mins}m`;
}

/**
 * Format a UTC `Date` in the user's local timezone, using a short readable
 * form ("Wed 09:30 EDT"). Used inside the tooltip.
 */
export function fmtLocal(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short", hour: "2-digit", minute: "2-digit", timeZoneName: "short",
  }).format(date);
}
