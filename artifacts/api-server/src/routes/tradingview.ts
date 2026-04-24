import { Router, type IRouter, type Request } from "express";
import { recordTradingViewAlert, getRecentAlerts, clearAlerts } from "../lib/tradingViewAlerts";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/** Shared secret required for the public webhook endpoints.
 *  - In PRODUCTION the secret is mandatory; if unset, every POST/DELETE is
 *    rejected with 503 (no silent open mode).
 *  - In DEVELOPMENT the secret is optional so local Curl testing works without
 *    extra setup.
 *  Accepted in `?secret=...`, `X-Webhook-Secret` header, or `secret` field in
 *  the JSON body. */
const SECRET = process.env["TRADINGVIEW_WEBHOOK_SECRET"];
const IS_PROD = process.env["NODE_ENV"] === "production";

type SecretCheck = { ok: true } | { ok: false; status: number; error: string };

function checkSecret(req: Request): SecretCheck {
  if (!SECRET) {
    if (IS_PROD) {
      return { ok: false, status: 503, error: "TRADINGVIEW_WEBHOOK_SECRET not configured on server" };
    }
    return { ok: true };
  }
  const fromHeader = req.header("x-webhook-secret");
  const fromQuery = typeof req.query["secret"] === "string" ? (req.query["secret"] as string) : undefined;
  const body = req.body as Record<string, unknown> | undefined;
  const fromBody = body && typeof body["secret"] === "string" ? (body["secret"] as string) : undefined;
  const supplied = fromHeader || fromQuery || fromBody;
  if (supplied && supplied === SECRET) return { ok: true };
  return { ok: false, status: 401, error: "invalid secret" };
}

router.post("/webhooks/tradingview", async (req, res, next) => {
  try {
    const check = checkSecret(req);
    if (!check.ok) {
      logger.warn({ ip: req.ip, status: check.status }, "TradingView webhook rejected");
      return res.status(check.status).json({ error: check.error });
    }
    // Accept JSON body, or fall back to raw text in `message`.
    const body =
      req.body && typeof req.body === "object" && Object.keys(req.body as object).length > 0
        ? req.body
        : typeof req.body === "string" && req.body.length > 0
          ? { message: req.body }
          : { message: "" };
    const alert = await recordTradingViewAlert(body);
    return res.status(200).json({ ok: true, id: alert.id });
  } catch (err) { next(err); return; }
});

router.get("/webhooks/tradingview", async (req, res, next) => {
  try {
    const limitRaw = req.query["limit"];
    const limit = typeof limitRaw === "string" ? Number(limitRaw) : 25;
    const alerts = await getRecentAlerts(Number.isFinite(limit) ? limit : 25);
    res.json({
      alerts,
      count: alerts.length,
      secretConfigured: !!SECRET,
      serverTime: new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

router.delete("/webhooks/tradingview", async (req, res, next) => {
  try {
    const check = checkSecret(req);
    if (!check.ok) {
      res.status(check.status).json({ error: check.error });
      return;
    }
    const cleared = await clearAlerts();
    res.json({ ok: true, cleared });
  } catch (err) { next(err); }
});

export default router;
