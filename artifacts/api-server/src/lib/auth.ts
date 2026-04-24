import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { logger } from "./logger";

const COOKIE_NAME = "scanner_session";
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const isProd = (): boolean => process.env["NODE_ENV"] === "production";

function getPassword(): string | undefined {
  const v = process.env["APP_ACCESS_PASSWORD"];
  return v && v.length > 0 ? v : undefined;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function setSessionCookie(res: Response): void {
  res.cookie(COOKIE_NAME, "ok", {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_MS,
    signed: true,
    path: "/",
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(COOKIE_NAME, { path: "/", signed: true });
}

export function isAuthenticated(req: Request): boolean {
  const v = (req.signedCookies as Record<string, unknown> | undefined)?.[COOKIE_NAME];
  return v === "ok";
}

export function verifyPassword(supplied: string): boolean {
  const expected = getPassword();
  if (!expected) return false;
  return safeEqual(supplied, expected);
}

export function isPasswordConfigured(): boolean {
  return getPassword() !== undefined;
}

/** Public paths that bypass the cookie gate. Each entry is matched against
 *  `req.originalUrl` (without querystring). The remaining `/api/*` surface
 *  requires a valid signed session cookie. */
const PUBLIC_PREFIXES = [
  "/api/healthz",
  "/api/auth/",
  "/api/kite/callback",        // Zerodha redirect (auth = request_token + KITE_API_SECRET)
  "/api/webhooks/tradingview", // TradingView server-to-server (auth = TRADINGVIEW_WEBHOOK_SECRET)
];

function isPublicPath(url: string): boolean {
  const path = url.split("?")[0] ?? "";
  for (const p of PUBLIC_PREFIXES) {
    if (path === p || path.startsWith(p)) return true;
  }
  return false;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (isPublicPath(req.originalUrl)) return next();
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: "unauthorized", code: "AUTH_REQUIRED" });
}

export function logAuthBootState(): void {
  if (!isPasswordConfigured()) {
    logger.warn(
      "APP_ACCESS_PASSWORD is not set — login endpoint will reject all attempts. " +
        "Set this secret to enable access.",
    );
  } else {
    logger.info("Auth gate enabled (APP_ACCESS_PASSWORD configured)");
  }
}
