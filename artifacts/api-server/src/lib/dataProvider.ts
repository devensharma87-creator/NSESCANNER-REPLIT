/**
 * Data provider abstraction. Reports whether the live Zerodha Kite tick feed
 * is active (DB session present + WebSocket connected) or whether we're on the
 * Yahoo Finance delayed-quote fallback.
 *
 * The actual quote-overlay logic lives in `kiteFeed.getLiveQuote()` and is
 * applied wherever we build a `Quote` object from a Yahoo chart.
 */
import { feedStatus } from "./kiteFeed";
import { getKiteCreds } from "./kiteAuth";

export type ProviderName = "kite" | "yahoo";

export function activeProvider(): ProviderName {
  const f = feedStatus();
  if (f.running && f.connected && f.liveQuotes > 0) return "kite";
  return "yahoo";
}

export function providerStatus(): {
  active: ProviderName;
  liveAvailable: boolean;
  reason: string;
  feed: ReturnType<typeof feedStatus>;
} {
  const feed = feedStatus();
  const active = activeProvider();
  const credsOK = !!getKiteCreds();

  if (active === "kite") {
    return {
      active,
      liveAvailable: true,
      reason: `Live ticks via Zerodha Kite (${feed.liveQuotes} symbols streaming).`,
      feed,
    };
  }

  let reason: string;
  if (!credsOK) {
    reason = "Yahoo Finance fallback (~15 min delayed). Set KITE_API_KEY and KITE_API_SECRET to enable Kite.";
  } else if (!feed.running) {
    reason = "Yahoo Finance fallback (~15 min delayed). Complete Kite daily login at /kite to enable live feed.";
  } else if (!feed.connected) {
    reason = `Yahoo Finance fallback. Kite WebSocket disconnected${feed.lastError ? ` (${feed.lastError})` : ""}.`;
  } else {
    reason = "Yahoo Finance fallback. Kite connected but no ticks received yet.";
  }
  return { active, liveAvailable: false, reason, feed };
}
