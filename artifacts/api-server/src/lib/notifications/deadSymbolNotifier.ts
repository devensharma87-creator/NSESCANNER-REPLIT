/**
 * Notification fan-out for dead-symbol transitions.
 *
 * Triggered exactly once per symbol-transition (when `failureStreak`
 * crosses `DEAD_SYMBOL_STREAK_THRESHOLD`) from `recordLivePriceError`
 * in `dataLayer.ts`.
 *
 * Channels (each independently optional — disable by leaving env unset):
 *   - Webhook: POST JSON to `DEAD_SYMBOL_WEBHOOK_URL`. The body is
 *     Slack/Discord-friendly (top-level `text` field) but also includes
 *     a structured `event` payload so generic webhook receivers can
 *     route on it.
 *   - Email: send via Resend (`RESEND_API_KEY` + `DEAD_SYMBOL_EMAIL_TO`
 *     + `DEAD_SYMBOL_EMAIL_FROM`) or SendGrid (`SENDGRID_API_KEY` +
 *     `DEAD_SYMBOL_EMAIL_TO` + `DEAD_SYMBOL_EMAIL_FROM`).
 *
 * Re-trigger suppression: an in-memory map records the last notification
 * time per symbol. A symbol that re-crosses the threshold inside the
 * cooldown window (default 24h, override via
 * `DEAD_SYMBOL_NOTIFY_COOLDOWN_HOURS`) is silently dropped so a
 * flapping ticker can't spam the channel. The map resets on process
 * restart, which is the desired behaviour: a fresh boot is a good
 * excuse to re-surface ongoing problems.
 *
 * Failure mode: notifications are best-effort. We log a warning on
 * delivery failure but never throw — a flaky webhook or email provider
 * must not break the price refresher.
 */

import { logger } from "../logger";
import type { GlobalDataSource } from "../global/universe";

export interface DeadSymbolEvent {
  symbol: string;
  displayName: string;
  source: GlobalDataSource;
  failureStreak: number;
  threshold: number;
  lastError: string;
}

const COOLDOWN_DEFAULT_HOURS = 24;
const lastNotifiedAt = new Map<string, number>();

function cooldownMs(): number {
  const raw = process.env.DEAD_SYMBOL_NOTIFY_COOLDOWN_HOURS;
  const hours = raw ? Number(raw) : COOLDOWN_DEFAULT_HOURS;
  if (!Number.isFinite(hours) || hours < 0) return COOLDOWN_DEFAULT_HOURS * 3_600_000;
  return hours * 3_600_000;
}

function dashboardLink(symbol: string): string {
  const base = process.env.DEAD_SYMBOL_DASHBOARD_URL
    ?? (process.env.REPLIT_DOMAINS
      ? `https://${process.env.REPLIT_DOMAINS.split(",")[0]}/global/`
      : null);
  if (!base) return symbol;
  const sep = base.endsWith("/") ? "" : "/";
  return `${base}${sep}?symbol=${encodeURIComponent(symbol)}`;
}

function summaryText(ev: DeadSymbolEvent, link: string): string {
  return [
    `:warning: Dead-symbol candidate: *${ev.displayName}* (\`${ev.symbol}\`)`,
    `Source: \`${ev.source}\` — failed ${ev.failureStreak} consecutive refresh cycles`,
    `Last error: ${ev.lastError}`,
    `Dashboard: ${link}`,
  ].join("\n");
}

async function postWebhook(url: string, ev: DeadSymbolEvent, link: string): Promise<void> {
  const text = summaryText(ev, link);
  const body = JSON.stringify({
    text,
    content: text, // Discord uses `content`; Slack uses `text`.
    event: {
      type: "dead_symbol_detected",
      symbol: ev.symbol,
      displayName: ev.displayName,
      source: ev.source,
      failureStreak: ev.failureStreak,
      threshold: ev.threshold,
      lastError: ev.lastError,
      dashboardUrl: link,
      detectedAt: new Date().toISOString(),
    },
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`webhook responded ${res.status}: ${txt.slice(0, 200)}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function sendEmail(ev: DeadSymbolEvent, link: string): Promise<void> {
  const to = process.env.DEAD_SYMBOL_EMAIL_TO;
  const from = process.env.DEAD_SYMBOL_EMAIL_FROM;
  if (!to || !from) return;
  const subject = `[scanner] dead-symbol candidate: ${ev.symbol} (${ev.source})`;
  const text = summaryText(ev, link);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    if (process.env.RESEND_API_KEY) {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        },
        body: JSON.stringify({ from, to: [to], subject, text }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Resend responded ${res.status}: ${t.slice(0, 200)}`);
      }
    } else if (process.env.SENDGRID_API_KEY) {
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: from },
          subject,
          content: [{ type: "text/plain", value: text }],
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`SendGrid responded ${res.status}: ${t.slice(0, 200)}`);
      }
    }
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fire a dead-symbol notification across whichever channels are
 * configured. Caller is responsible for only invoking this on the
 * threshold-crossing edge — we additionally enforce a per-symbol
 * cooldown so a symbol that flaps in and out of the dead-streak doesn't
 * spam the channel.
 *
 * Never throws — delivery failures are logged and swallowed.
 */
export async function notifyDeadSymbol(ev: DeadSymbolEvent): Promise<void> {
  const webhookUrl = process.env.DEAD_SYMBOL_WEBHOOK_URL;
  const hasEmail = Boolean(
    process.env.DEAD_SYMBOL_EMAIL_TO
    && process.env.DEAD_SYMBOL_EMAIL_FROM
    && (process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY),
  );
  if (!webhookUrl && !hasEmail) return; // nothing configured — log-only mode.

  const now = Date.now();
  const last = lastNotifiedAt.get(ev.symbol);
  if (last != null && now - last < cooldownMs()) {
    logger.info(
      { symbol: ev.symbol, sinceLastMs: now - last },
      "dead-symbol notification suppressed by cooldown",
    );
    return;
  }
  lastNotifiedAt.set(ev.symbol, now);

  const link = dashboardLink(ev.symbol);
  const tasks: Promise<void>[] = [];
  if (webhookUrl) {
    tasks.push(
      postWebhook(webhookUrl, ev, link).catch(err => {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), symbol: ev.symbol },
          "dead-symbol webhook delivery failed",
        );
      }),
    );
  }
  if (hasEmail) {
    tasks.push(
      sendEmail(ev, link).catch(err => {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err), symbol: ev.symbol },
          "dead-symbol email delivery failed",
        );
      }),
    );
  }
  await Promise.all(tasks);
}

/** Test-only: clear the cooldown map. */
export function __resetDeadSymbolNotifierForTests(): void {
  lastNotifiedAt.clear();
}
