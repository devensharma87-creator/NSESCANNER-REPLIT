import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import router from "./routes";
import authRouter from "./routes/auth";
import { logger } from "./lib/logger";
import { requireAuth, logAuthBootState } from "./lib/auth";

const app: Express = express();

// We're behind Replit's reverse proxy in deployment — needed so req.ip,
// rate-limit keys, and `secure` cookie behavior work correctly.
app.set("trust proxy", 1);

const SESSION_SECRET = process.env["SESSION_SECRET"];
if (!SESSION_SECRET) {
  throw new Error("SESSION_SECRET env var is required (used to sign session cookies).");
}

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
if (corsAllowAny && isProd) {
  throw new Error(
    'CORS_ORIGINS="*" is not allowed in production (NODE_ENV=production). ' +
    "Set an explicit comma-separated origin list, or unset for same-origin only.",
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
// Default per-IP cap on /api/* so a runaway client can't DoS the upstream feeds.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "rate_limited" },
});

app.use("/api/auth/login", loginLimiter);
app.use("/api/webhooks/", webhookLimiter);
app.use("/api/", apiLimiter);

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

export default app;
