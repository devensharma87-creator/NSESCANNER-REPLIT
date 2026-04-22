/**
 * Data provider abstraction. Selects between Zerodha Kite (live) and Yahoo (delayed)
 * at request time based on which credentials are present in env. The intent is that
 * once KITE_API_KEY + KITE_API_SECRET + KITE_ACCESS_TOKEN are set, all quote / OHLC
 * reads transparently switch from delayed Yahoo to live Kite ticks — without any
 * caller-side changes.
 *
 * This is a thin scaffold. Full Kite adapter is wired in once credentials are
 * provided and the kiteconnect package is installed.
 */

export type ProviderName = "kite" | "yahoo";

export function activeProvider(): ProviderName {
  const k = process.env["KITE_API_KEY"];
  const s = process.env["KITE_API_SECRET"];
  const t = process.env["KITE_ACCESS_TOKEN"];
  if (k && s && t) return "kite";
  return "yahoo";
}

export function providerStatus(): {
  active: ProviderName;
  liveAvailable: boolean;
  reason: string;
} {
  const active = activeProvider();
  if (active === "kite") {
    return {
      active,
      liveAvailable: true,
      reason: "Live ticks via Zerodha Kite Connect.",
    };
  }
  return {
    active,
    liveAvailable: false,
    reason:
      "Yahoo Finance fallback (~15 min delayed). Set KITE_API_KEY, KITE_API_SECRET and KITE_ACCESS_TOKEN to upgrade to live ticks.",
  };
}
