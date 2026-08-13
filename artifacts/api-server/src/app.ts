import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import router from "./routes";
import authRouter from "./routes/auth";
import globalRouter from "./routes/global";
import { logger } from "./lib/logger";
import { validateProductionConfig, PROD_CONFIG_CODES } from "./lib/productionConfigValidator";
import { requireAuth, logAuthBootState } from "./lib/auth";
import { logGlobalAuthBootState } from "./lib/global/auth";
import { startGlobalDataPump } from "./lib/global/dataLayer";
import { startScreenerPresetScheduler } from "./lib/global/presetScheduler";
import { startSwingTtlSweepScheduler } from "./lib/swingTtlSweep";
import { scheduleBootJob, BOOT_STAGGER_MS, scheduleDbPoolStatsLog, POOL_STATS_LOG_DELAYS_MS } from "./lib/bootScheduler";
import { runSystemAlertDedupSelfTest } from "./lib/systemAlertDedupSelfTest";
import { startSystemModeMonitor } from "./lib/systemMode";
import { startClockDriftMonitor } from "./lib/clockDrift";
import { startStalenessWatchdog } from "./lib/marketData/stalenessWatchdog";
import { startInstrumentsIntegrityScheduler } from "./lib/marketData/instrumentsIntegrity";
import { startEodReconciliationScheduler } from "./lib/eodReconciliation";
import { getDbPoolStats } from "@workspace/db";

const app: Express = express();

// We're behind Replit's reverse proxy in deployment — needed so req.ip,
// rate-limit keys, and `secure` cookie behavior work correctly.
app.set("trust proxy", 1);

// Validate critical production configuration before any route/middleware setup.
// Uses the shared productionConfigValidator so tests and bootstrap follow
// identical rules. Throws with the stable error code if invalid so index.ts
// can emit a clean diagnostic before any route/scheduler/provider initializes.
// (index.ts runs this first via the bootstrap; app.ts re-runs it as a defence
// against direct import in development/test hot-reload scenarios.)
{
  const _cfgResult = validateProductionConfig(process.env);
  if (!_cfgResult.valid) {
    const codes = _cfgResult.errors.map(e => e.code).join(", ");
    throw new Error(`Production config invalid [${codes}]. See productionConfigValidator.ts for details.`);
  }
}
// Safe non-null assertion: validateProductionConfig guarantees SESSION_SECRET
// is present and non-empty when valid===true.
const SESSION_SECRET = process.env["SESSION_SECRET"] as string;

// Content Security Policy — was disabled because Vite's HMR client used inline
// scripts. In production the SPA is built and served by the API; there's no
// HMR. Apply a tight policy in production and only relax it for local dev.
//
// Third-party allowances:
//   - TradingView advanced-chart widget (s3.tradingview.com loads the script,
//     www.tradingview.com renders the iframe + serves data + symbol logos).
//   - Google Fonts CSS (fonts.googleapis.com) and font files (fonts.gstatic.com).
const isProd = process.env["NODE_ENV"] === "production";
app.use(
  helmet({
    contentSecurityPolicy: isProd
      ? {
          useDefaults: true,
          directives: {
            "default-src": ["'self'"],
            "script-src": [
              "'self'",
              "https://s3.tradingview.com",
              "https://www.tradingview.com",
              // Trendlyne web-widget loader (SWOT / Checklist / QVT /
              // Forecaster on stock detail + deep-scan pages). Free,
              // public-embed product — no API key.
              "https://cdn-static.trendlyne.com",
            ],
            // Radix and Tailwind both rely on inline styles at runtime.
            "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
            "img-src": ["'self'", "data:", "blob:", "https://*.tradingview.com", "https://*.trendlyne.com"],
            "connect-src": [
              "'self'",
              "https://*.tradingview.com",
              // Trendlyne loader fetches the widget HTML over XHR before
              // converting the blockquote into an iframe. Wildcard so
              // www.trendlyne.com and any other subdomain they may
              // shard onto in future are covered without a redeploy.
              "https://*.trendlyne.com",
            ],
            "frame-src": [
              "'self'",
              "https://www.tradingview.com",
              "https://s.tradingview.com",
              "https://*.trendlyne.com",
            ],
            "frame-ancestors": ["'self'"],
            "object-src": ["'none'"],
            "base-uri": ["'self'"],
          },
        }
      : false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  }),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// CORS — driven by an env-configured allowlist instead of the legacy
// `origin: true` reflective behaviour. Reflecting any origin while sending
// credentials is the well-known broad-CORS antipattern: a malicious site that
// tricks the browser into sending requests then reads the response. Default
// behaviour (CORS_ORIGINS unset) is same-origin only, which is what the
// Replit deployment needs anyway. Set CORS_ORIGINS="*" to opt back into the
// reflective behaviour for local dev with a separate frontend host.
const corsOriginsRaw = (process.env["CORS_ORIGINS"] ?? "").trim();
const corsAllowAny = corsOriginsRaw === "*";
// Hard-fail at startup if someone leaves `CORS_ORIGINS=*` set in production.
// Reflective CORS + credentials is the broad-CORS antipattern we just fixed;
// allowing it back in via env in prod would silently re-create the hole.
// CORS wildcard in production is already rejected by validateProductionConfig()
// above — this branch is unreachable. The condition is kept as a defence-in-
// depth assertion so the intent is visible to future readers.
if (corsAllowAny && isProd) {
  // validateProductionConfig() should have already thrown PROD_CONFIG_INVALID:CORS_WILDCARD.
  throw new Error(
    `[${PROD_CONFIG_CODES.CORS_WILDCARD}] CORS_ORIGINS="*" is not allowed in production.`,
  );
}
const corsAllowlist = corsOriginsRaw && !corsAllowAny
  ? corsOriginsRaw.split(",").map(s => s.trim()).filter(Boolean)
  : [];
app.use(
  cors({
    origin: (origin, cb) => {
      // No Origin header = same-origin or non-browser caller. Always allow.
      if (!origin) return cb(null, true);
      if (corsAllowAny) return cb(null, true);
      if (corsAllowlist.includes(origin)) return cb(null, true);
      cb(null, false);
    },
    credentials: true,
  }),
);

app.use(cookieParser(SESSION_SECRET));
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true, limit: "256kb" }));

// ---- Rate limiting ----
// Strict bucket for the login endpoint so password guessing is impractical.
// Successful logins do NOT count against the budget so legitimate
// re-authentication (new device, cleared cookies) isn't penalised.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "too_many_login_attempts" },
});
// Webhook bucket — TradingView can fire frequently but each IP shouldn't burst.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "rate_limited" },
});
// Boot-storm exemption. On cold start the frontend can fire 20+ requests in
// the first few seconds (initial data hydration across tabs). The 300/min
// steady-state cap is right for a runaway client, but has room to breathe
// during the boot window. During the first BOOT_STORM_GRACE_MS after this
// process started we skip the per-IP rate limit so the initial page load
// doesn't get 429'd. Steady-state behaviour is unchanged.
const BOOT_STORM_GRACE_MS = 60_000;
const bootStartedAt = Date.now();
// Default per-IP cap on /api/* so a runaway client can't DoS the upstream feeds.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: () => Date.now() - bootStartedAt < BOOT_STORM_GRACE_MS,
  message: { error: "rate_limited" },
});

app.use("/api/auth/login", loginLimiter);
// Strict bucket for the *global* scanner login. Same posture as the legacy
// /api/auth/login limiter: a single shared password gate is the entire
// access control for the global scanner, so brute-force resilience here
// matters even though /api/* already has the broader 300/min apiLimiter.
const globalLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "too_many_login_attempts" },
});
app.use("/api/global/auth/login", globalLoginLimiter);
app.use("/api/webhooks/", webhookLimiter);
app.use("/api/", apiLimiter);

// Global Multi-Asset Scanner routes — mounted BEFORE the legacy NSE gate
// so that /api/global/* uses its own independent password gate (defined
// inside `globalRouter`) and never sees the NSE `requireAuth`. This is a
// hard separation per the Phase-1 spec: global users must not gain NSE
// access (or vice-versa) by holding either cookie.
app.use("/api", globalRouter);

// Auth routes are mounted BEFORE the gate so login/logout/status are reachable
// while logged out. The gate then guards everything else under /api.
app.use("/api", authRouter);
app.use(requireAuth);
app.use("/api", router);

// Global error handler — keep stack traces out of responses.
app.use((err: unknown, req: Request, res: Response, _next: NextFunction): void => {
  logger.error({ err, path: req.path, method: req.method }, "Unhandled request error");
  if (res.headersSent) return;
  res.status(500).json({ error: "internal_server_error" });
});

logAuthBootState();
logGlobalAuthBootState();
// W6-P4A boot staggering: spread heavy background subsystems out of the
// cold-start window so they don't all contend for the shared 10-connection DB
// pool at once. Only the *initial* start is delayed; each subsystem keeps its
// own periodic cadence once started.
//
// Start the background data refresher for the global scanner. Best-effort —
// pump errors are logged into `global_sync_logs` and surfaced via
// /api/global/status, never thrown out of boot.
scheduleBootJob(
  "global-data-pump",
  BOOT_STAGGER_MS.globalDataPump,
  () =>
    startGlobalDataPump().catch((err: unknown) => {
      logger.error({ err: (err as Error).message }, "startGlobalDataPump failed at boot");
      // Re-throw so scheduleBootJob's fail-open handler logs an accurate
      // outcome instead of a misleading "boot job started". Still fail-open —
      // the helper swallows it; boot is never blocked or crashed.
      throw err;
    }),
  "providerNetwork",
);
// Background scheduler for "auto-run every N minutes" presets. Independent
// from the data pump — it reads cached live prices / candles so it never
// directly hits upstream sources itself. (Internal 30s tick cadence unchanged.)
scheduleBootJob("preset-scheduler", BOOT_STAGGER_MS.presetScheduler, startScreenerPresetScheduler);
// Background TTL sweep for staged swing-cash orders — expires stale STAGED/
// APPROVAL_REQUIRED/WATCH_ONLY rows across ALL owners every 10 minutes.
// Runs one immediate tick on start (to flush rows stale before this boot),
// then every 10 min. Fail-open: tick errors are logged, never propagated.
// Boot delay is after the instFlows refresher (60s) so pool pressure subsides.
scheduleBootJob("swing-ttl-sweep", 90_000, startSwingTtlSweepScheduler);

// Production-safe self-test for the DB-backed system-alert dedup/CAS layer
// (systemAlertDedup.ts) — self-heals both tables via the same idempotent
// CREATE TABLE IF NOT EXISTS path a real alert would use, then proves
// claim/duplicate/CAS-transition logic against synthetic SYSTEM_SELFTEST::*
// keys that can never collide with a real alert's dedup key. Runs on every
// boot (including autoscale cold starts) so schema self-heal is proven
// deterministically instead of waiting for a random natural alert. Sends no
// Telegram, touches no trade/strategy state — see systemAlertDedupSelfTest.ts
// for the full safety contract. Fail-open inside scheduleBootJob.
scheduleBootJob("system-alert-dedup-selftest", 5_000, async () => {
  await runSystemAlertDedupSelfTest();
});

// BUG-28 + BUG-29 (fix-file Phase 1): SystemMode monitor (10s ticks — derives
// NORMAL/DEGRADED/READ_ONLY/HALT from Kite session, WS uptime, and DB latency,
// gates paper auto-opens, alerts on transitions) and hourly clock-drift
// DETECTION vs an external UTC source (host NTP remains the actual sync).
scheduleBootJob("system-mode-monitor", 20_000, () => {
  startSystemModeMonitor();
});
scheduleBootJob("clock-drift-monitor", 50_000, () => {
  startClockDriftMonitor();
});

// BUG-30/31/35 (fix-file Phase 1): token staleness watchdog (15s, market hours),
// daily instruments-dump refresh + contract diff (08:00–09:20 IST window), and
// EOD paper-ledger reconciliation (≥15:35 IST, persisted + Telegram).
scheduleBootJob("staleness-watchdog", 30_000, () => {
  startStalenessWatchdog();
});
scheduleBootJob("instruments-integrity", 70_000, () => {
  startInstrumentsIntegrityScheduler();
});
scheduleBootJob("eod-reconciliation", 100_000, () => {
  startEodReconciliationScheduler();
});

// BUG-85/86 (fix-file Phase 4): Telegram bot command listener. Long-poll
// getUpdates against the Telegram Bot API; single-owner allowlist enforced
// via TELEGRAM_CHAT_ID. Commands: /help /status /clock /positions /pnl
// /pause /resume. Fail-closed — no-op if bot token / chat id not set.
scheduleBootJob("telegram-bot-commands", 110_000, async () => {
  const { startTelegramBotCommands } = await import("./lib/telegramBotCommands");
  await startTelegramBotCommands();
}, "outboundNotifications");

// B.8: additive nullable `writer_version` column on paper_trade_fo/eq.
// Applied via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` — safe on every
// call, memoised inside the module so this costs one DB round-trip per
// process lifetime. Runs early so the writer path never inserts into
// a missing column on a fresh deploy.
scheduleBootJob("paper-trade-writer-version-column", 15_000, async () => {
  const { ensurePaperTradeWriterVersionColumn } = await import(
    "./lib/paperTradeWriterVersion"
  );
  await ensurePaperTradeWriterVersionColumn();
});

// P0 Phase A — durable charges columns (gross_pnl, charges_total,
// charges_breakdown_json, charges_model_version, charges_calculated_at,
// net_pnl, charges_status) on paper_trade_fo/eq/combo. Idempotent
// ALTER TABLE ... ADD COLUMN IF NOT EXISTS. Runs immediately after the
// writer_version migration so the writer never inserts into a missing
// column on a fresh deploy.
scheduleBootJob("paper-trade-charges-columns", 16_000, async () => {
  const { ensurePaperTradeChargesColumns } = await import(
    "./lib/paperTradeWriterVersion"
  );
  await ensurePaperTradeChargesColumns();
});

// Canonical Kite Candle Store — warm-loads DB cache into memory then schedules
// a background refresh independent of all UI requests.  The boot delay gives
// the Kite session time to establish before the first Kite candle fetch fires.
// UI path (scanner) reads from in-memory L1 only — zero Kite calls per request.
// Advisory lock prevents thundering-herd across replicas.
scheduleBootJob("kite-candle-store", 10_000, async () => {
  const { initKiteCandleStore } = await import("./lib/kiteCandle/kiteCandleStore");
  await initKiteCandleStore();
}, "providerNetwork");

// W6-P4B5 observability only: read-only post-boot DB pool utilization snapshots
// that bracket the W6-P4A stagger window. These ONLY read the pg pool's
// in-memory counters — they never run a query, never acquire a connection, and
// never change pool config or cadence. Fail-open inside the helper.
for (const delayMs of POOL_STATS_LOG_DELAYS_MS) {
  scheduleDbPoolStatsLog(`post-boot+${delayMs / 1000}s`, delayMs, getDbPoolStats);
}

export default app;
