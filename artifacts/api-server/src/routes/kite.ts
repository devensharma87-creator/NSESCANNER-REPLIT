import { Router, type IRouter } from "express";
import { buildLoginUrl, clearSession, completeLogin, getActiveSession, getKiteCreds } from "../lib/kiteAuth";
import { addTickListener, feedStatus, getAllLiveQuotes, getLiveQuote, startTicker, stopTicker, subscribe } from "../lib/kiteFeed";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/** Combined status for the Kite settings page. */
router.get("/kite/status", async (_req, res) => {
  const creds = getKiteCreds();
  const session = await getActiveSession();
  res.json({
    credentialsConfigured: !!creds,
    apiKeyPreview: creds ? creds.apiKey.slice(0, 4) + "…" : null,
    loggedIn: !!session,
    userId: session?.userId ?? null,
    userName: session?.userName ?? null,
    loginTime: session?.loginTime?.toISOString() ?? null,
    expiresAt: session?.expiresAt?.toISOString() ?? null,
    feed: feedStatus(),
  });
});

router.get("/kite/login-url", (_req, res) => {
  const creds = getKiteCreds();
  if (!creds) {
    res.status(400).json({ error: "KITE_API_KEY and KITE_API_SECRET are not set on the server" });
    return;
  }
  res.json({ url: buildLoginUrl(creds.apiKey) });
});

/** Zerodha redirects here after the user authorises. We exchange request_token
 *  for an access_token and store it. Then we redirect back to the frontend. */
router.get("/kite/callback", async (req, res) => {
  const requestToken = String(req.query["request_token"] ?? "").trim();
  const status = String(req.query["status"] ?? "");
  // Scanner is mounted at the domain root (artifact.toml: previewPath=/),
  // so its `/kite` route lives at the top level — not under `/scanner/`.
  const baseRedirect = "/kite";
  if (status && status !== "success") {
    res.redirect(`${baseRedirect}?login=failed&reason=${encodeURIComponent(status)}`);
    return;
  }
  if (!requestToken) {
    res.redirect(`${baseRedirect}?login=failed&reason=missing_request_token`);
    return;
  }
  try {
    await completeLogin(requestToken);
    await startTicker();
    res.redirect(`${baseRedirect}?login=success`);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Kite callback failed");
    res.redirect(`${baseRedirect}?login=failed&reason=${encodeURIComponent((err as Error).message)}`);
  }
});

router.post("/kite/logout", async (_req, res) => {
  stopTicker();
  await clearSession();
  res.json({ ok: true });
});

router.post("/kite/subscribe", async (req, res) => {
  const symbols = Array.isArray(req.body?.symbols) ? (req.body.symbols as string[]) : [];
  const added = await subscribe(symbols);
  res.json({ added, status: feedStatus() });
});

router.get("/kite/quotes", (_req, res) => {
  res.json({ quotes: getAllLiveQuotes(), status: feedStatus() });
});

router.get("/kite/quote/:symbol", (req, res) => {
  const sym = String(req.params["symbol"] ?? "").toUpperCase();
  const q = getLiveQuote(sym);
  if (!q) { res.status(404).json({ error: "no live quote for symbol" }); return; }
  res.json(q);
});

/** Server-Sent Events stream of every tick that arrives. */
router.get("/kite/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  // Initial snapshot
  res.write(`event: snapshot\ndata: ${JSON.stringify(getAllLiveQuotes())}\n\n`);

  const off = addTickListener(tick => {
    res.write(`event: tick\ndata: ${JSON.stringify(tick)}\n\n`);
  });
  const ka = setInterval(() => res.write(": ka\n\n"), 25_000);
  req.on("close", () => { off(); clearInterval(ka); });
});

export default router;
