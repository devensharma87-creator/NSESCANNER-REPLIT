import { Router, type IRouter, type Request } from "express";
import { recordTradingViewAlert, getRecentAlerts, clearAlerts } from "../lib/tradingViewAlerts";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/** Optional shared secret. If set in env, every webhook POST must include it
 * either as `?secret=...`, `X-Webhook-Secret` header, or a `secret` field in
 * the JSON body. If unset, the endpoint is open (so testing works without
 * extra setup). */
const SECRET = process.env["TRADINGVIEW_WEBHOOK_SECRET"];

function checkSecret(req: Request): boolean {
  if (!SECRET) return true;
  const fromHeader = req.header("x-webhook-secret");
  const fromQuery = typeof req.query["secret"] === "string" ? (req.query["secret"] as string) : undefined;
  const body = req.body as Record<string, unknown> | undefined;
  const fromBody = body && typeof body["secret"] === "string" ? (body["secret"] as string) : undefined;
  return fromHeader === SECRET || fromQuery === SECRET || fromBody === SECRET;
}

router.post("/webhooks/tradingview", async (req, res, next) => {
  try {
    if (!checkSecret(req)) {
      logger.warn({ ip: req.ip }, "TradingView webhook rejected: bad secret");
      return res.status(401).json({ error: "invalid secret" });
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
    if (!checkSecret(req)) {
      res.status(401).json({ error: "invalid secret" });
      return;
    }
    const cleared = await clearAlerts();
    res.json({ ok: true, cleared });
  } catch (err) { next(err); }
});

export default router;
