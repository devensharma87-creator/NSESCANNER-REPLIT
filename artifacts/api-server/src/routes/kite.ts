import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { buildLoginUrl, clearSession, completeLogin, forceRefreshInstruments, getActiveSession, getKiteCreds, storeImportedSession, exportInstrumentsCache, type ExportedSession } from "../lib/kiteAuth";
import { addTickListener, feedStatusForOwnerWire, getAllLiveQuotes, resolveLiveQuoteBySymbol, startTicker, stopTicker, subscribe } from "../lib/kiteFeed";
import { getKiteReadiness } from "../lib/kiteReadiness";
import { requireOwner, requireOwnerStrict } from "../lib/userAuth";
import { triggerKiteWarmup } from "../lib/kiteWarmup";
import { logger } from "../lib/logger";

function getAppPassword(): string | undefined {
  const v = process.env["APP_ACCESS_PASSWORD"];
  return v && v.length > 0 ? v : undefined;
}

function safeStrEq(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

const router: IRouter = Router();

// Live Feed tab is owner-only. Path-scoped to /kite/* so this middleware
// doesn't intercept (and 401) every other request flowing through the parent
// router. Skip the gate on:
//   - /kite/callback         (OAuth redirect from Zerodha — no session yet)
//   - /kite/export-session   (gated separately by X-App-Password header)
//   - /kite/import-session   (also gated by X-App-Password header)
router.use("/kite", (req, res, next) => {
  // req.path here is RELATIVE to the "/kite" mount, so /kite/callback => "/callback".
  const p = req.path;
  if (p === "/callback" || p === "/export-session" || p === "/import-session" || p === "/export-instruments") {
    return next();
  }
  // Owner-only session metadata READS must never leak on a public shared link.
  // `requireOwner` bypasses GET/HEAD in public-access mode, so /status (api-key
  // preview, user id/name, login/expiry times, feed + readiness) and /login-url
  // (login URL embedding the api_key) use the strict gate that requires a real
  // owner cookie for every method.
  if (p === "/status" || p === "/login-url") {
    return requireOwnerStrict(req, res, next);
  }
  return requireOwner(req, res, next);
});

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
    feed: feedStatusForOwnerWire(),
    readiness: await getKiteReadiness(),
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
    // Fire-and-forget data warmup so F&O index quotes/candles/option-chain are
    // primed right after login. Single-flight + debounced internally; never
    // blocks the redirect and never throws out (safe-fail).
    void triggerKiteWarmup("login");
    res.redirect(`${baseRedirect}?login=success`);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "Kite callback failed");
    res.redirect(`${baseRedirect}?login=failed&reason=${encodeURIComponent((err as Error).message)}`);
  }
});

/**
 * POST /kite/warmup — OWNER-ONLY manual data warmup for the F&O universe
 * (index quotes + candles + option-chain probe). Owner auth is enforced by the
 * `/kite` mount guard above (POST is never bypassed in public mode). Returns the
 * structured run result. Single-flight + debounced inside triggerKiteWarmup.
 * NEVER places orders, mutates trading state, or returns secrets.
 */
router.post("/kite/warmup", async (_req, res) => {
  try {
    const result = await triggerKiteWarmup("manual");
    res.json(result);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "manual kite warmup failed");
    res.status(500).json({ error: "warmup failed" });
  }
});

router.post("/kite/logout", async (_req, res) => {
  stopTicker();
  await clearSession();
  res.json({ ok: true });
});

/**
 * Force-clear the instruments cooldown/cache and immediately re-pull NSE,
 * NFO, and BFO from Kite. Use after a Kite-side outage (ECONNRESET on the
 * bulk instruments endpoint) when you don't want to wait for the
 * exponential-backoff window to expire.
 *
 * Owner-only. Returns counts per exchange or per-exchange error message.
 */
router.post("/kite/refresh-instruments", async (_req, res) => {
  const out = await forceRefreshInstruments();
  if (!out) {
    res.status(409).json({
      ok: false,
      error: "No active Kite session — log in first.",
    });
    return;
  }
  logger.info({ cleared: out.cleared, results: out.results }, "Kite instruments cooldown cleared and re-fetched");
  res.json({ ok: true, ...out });
});

/** Export the active session so a peer environment (typically dev) can mirror
 *  the production login. Gated by the X-App-Password header so this stays
 *  closed even though the route is whitelisted from the cookie gate.
 *
 *  Threat model: the access_token grants full Kite REST + WebSocket access for
 *  the rest of the trading day. APP_ACCESS_PASSWORD is the same secret that
 *  protects the entire app login, so anyone who can read this can already log
 *  in and use the live data anyway. */
router.get("/kite/export-session", async (req, res) => {
  const expected = getAppPassword();
  if (!expected) {
    res.status(503).json({ error: "APP_ACCESS_PASSWORD not configured on this server" });
    return;
  }
  const supplied = String(req.header("x-app-password") ?? "");
  if (!supplied || !safeStrEq(supplied, expected)) {
    logger.warn({ ip: req.ip }, "Kite export-session rejected: bad password");
    res.status(401).json({ error: "Invalid or missing X-App-Password header" });
    return;
  }
  const session = await getActiveSession();
  if (!session) {
    res.status(404).json({ error: "No active Kite session on this server" });
    return;
  }
  const payload: ExportedSession = {
    apiKey: session.apiKey,
    accessToken: session.accessToken,
    publicToken: null,
    userId: session.userId,
    userName: session.userName,
    loginTime: session.loginTime.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
  };
  logger.info({ userId: session.userId, requestIp: req.ip }, "Kite session exported to peer");
  res.json(payload);
});

router.get("/kite/export-instruments", async (req, res) => {
  const expected = getAppPassword();
  if (!expected) {
    res.status(503).json({ error: "APP_ACCESS_PASSWORD not configured" });
    return;
  }
  const supplied = String(req.header("x-app-password") ?? "");
  if (!supplied || !safeStrEq(supplied, expected)) {
    res.status(401).json({ error: "Invalid or missing X-App-Password header" });
    return;
  }
  const data = exportInstrumentsCache();
  if (!data) {
    res.status(404).json({ error: "No instruments cached on this server" });
    return;
  }
  logger.info({ requestIp: req.ip }, "Kite instruments exported to peer");
  res.json(data);
});

router.post("/kite/import-session", async (req, res) => {
  const sourceUrlRaw = String(req.body?.sourceUrl ?? "").trim();
  const password = String(req.body?.password ?? "");
  if (!sourceUrlRaw || !password) {
    res.status(400).json({ error: "sourceUrl and password are required" });
    return;
  }
  let base: URL;
  try {
    base = new URL(sourceUrlRaw);
  } catch {
    res.status(400).json({ error: "sourceUrl is not a valid URL" });
    return;
  }
  // Security: only allow https to avoid leaking APP_ACCESS_PASSWORD over the
  // wire. Local loopback is the only http exception so we can self-test the
  // import flow without TLS.
  const host = base.hostname.toLowerCase();
  const isLoopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  if (base.protocol === "http:" && !isLoopback) {
    res.status(400).json({ error: "sourceUrl must use https (http allowed only for localhost)" });
    return;
  }
  if (base.protocol !== "https:" && base.protocol !== "http:") {
    res.status(400).json({ error: "sourceUrl must be http(s)" });
    return;
  }
  // SSRF guard: in production, only allow known peer hosts. The dev environment
  // is intentionally permissive so any forked Replit can mirror from its own
  // production deployment, but the host MUST be explicitly approved.
  const ALLOWED_PEER_HOSTS = (process.env["KITE_MIRROR_ALLOWED_HOSTS"] ?? "marketscannerbydev.in,localhost,127.0.0.1")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (!ALLOWED_PEER_HOSTS.includes(host)) {
    res.status(400).json({
      error: `sourceUrl host "${host}" is not in the allowed peer list. Set KITE_MIRROR_ALLOWED_HOSTS to override.`,
    });
    return;
  }
  const exportUrl = new URL("/api/kite/export-session", base).toString();

  let upstream: Response;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      upstream = await fetch(exportUrl, {
        method: "GET",
        headers: { "x-app-password": password, accept: "application/json" },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    const msg = (err as Error).message ?? "fetch failed";
    logger.warn({ err: msg, exportUrl }, "Kite import-session: upstream fetch failed");
    res.status(502).json({ error: `Could not reach ${exportUrl}: ${msg}` });
    return;
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => "");
    logger.warn({ status: upstream.status, body: text.slice(0, 200) }, "Kite import-session: upstream non-200");
    res.status(upstream.status).json({
      error: `Production server returned ${upstream.status}`,
      detail: text.slice(0, 300),
    });
    return;
  }

  let payload: ExportedSession;
  try {
    payload = (await upstream.json()) as ExportedSession;
  } catch (err) {
    res.status(502).json({ error: `Production response was not valid JSON: ${(err as Error).message}` });
    return;
  }

  try {
    const stored = await storeImportedSession(payload);
    // Kick the live WebSocket feed using the freshly imported session.
    await startTicker(stored).catch((e) => logger.warn({ err: (e as Error).message }, "startTicker after import failed"));
    res.json({
      ok: true,
      userId: stored.userId,
      userName: stored.userName,
      loginTime: stored.loginTime.toISOString(),
      expiresAt: stored.expiresAt.toISOString(),
    });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

router.post("/kite/subscribe", async (req, res) => {
  const symbols = Array.isArray(req.body?.symbols) ? (req.body.symbols as string[]) : [];
  const added = await subscribe(symbols);
  res.json({ added, status: feedStatusForOwnerWire() });
});

router.get("/kite/quotes", (_req, res) => {
  res.json({ quotes: getAllLiveQuotes(), status: feedStatusForOwnerWire() });
});

router.get("/kite/quote/:symbol", (req, res) => {
  const sym = String(req.params["symbol"] ?? "").toUpperCase();
  const resolution = resolveLiveQuoteBySymbol(sym);
  if (resolution.status === "AMBIGUOUS") {
    // The symbol is listed on more than one exchange. Report the choice
    // rather than defaulting to an exchange the caller did not ask for.
    res.status(409).json({
      error: "ambiguous symbol",
      reason: "SYMBOL_RESOLVES_TO_MULTIPLE_EXCHANGES",
      candidates: resolution.candidates.map(c => ({
        canonicalInstrumentId: c.canonicalInstrumentId,
        exchange: c.exchange,
        segment: c.segment,
        tradingSymbol: c.tradingSymbol,
        instrumentToken: c.instrumentToken,
      })),
    });
    return;
  }
  if (resolution.status === "NOT_FOUND") {
    res.status(404).json({ error: "no live quote for symbol" });
    return;
  }
  res.json(resolution.quote);
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
