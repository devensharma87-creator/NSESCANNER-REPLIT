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

app.use(
  helmet({
    // CSP turned off — Vite HMR + react inline-style are noisy under default CSP.
    // The app is single-tenant private, so the major helmet headers we want are
    // HSTS / X-Content-Type-Options / X-Frame-Options, which stay on.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
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

// Same-origin in production (path-routed by Replit's proxy). Keep credentials
// enabled so the auth cookie is sent on XHR. `origin: true` reflects the request
// origin instead of using a wildcard, which is required when credentials=true.
app.use(
  cors({
    origin: true,
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
