/**
 * Independent password gate for the global scanner.
 *
 * - Cookie name `global_session` is intentionally distinct from
 *   `scanner_session` (NSE scanner) so the two sessions cannot leak into
 *   each other.
 * - Signed with the same `SESSION_SECRET` (cookie-parser is initialised
 *   once at app boot), so we don't introduce a second secret.
 * - Password is supplied via `GLOBAL_APP_ACCESS_PASSWORD`. If that env var
 *   is not set, every login fails closed and `/api/global/auth/status`
 *   reports `configured=false` so the UI can show a setup hint.
 */

import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";
import { logger } from "../logger";

export const GLOBAL_COOKIE_NAME = "global_session";
/**
 * Scope the cookie to `/api/global` so it is *only* sent on global-scanner
 * API calls. This is hard separation from the NSE scanner — even if a
 * browser is logged into both, the global cookie never leaves the global
 * namespace and vice-versa.
 */
export const GLOBAL_COOKIE_PATH = "/api/global";
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const isProd = (): boolean => process.env["NODE_ENV"] === "production";

function getPassword(): string | undefined {
  const v = process.env["GLOBAL_APP_ACCESS_PASSWORD"];
  return v && v.length > 0 ? v : undefined;
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export function isGlobalPasswordConfigured(): boolean {
  return getPassword() !== undefined;
}

export function verifyGlobalPassword(supplied: string): boolean {
  const expected = getPassword();
  if (!expected) return false;
  return safeEqual(supplied, expected);
}

/**
 * Create a deterministic session-key from the cookie value so per-session
 * watchlists can persist without exposing the raw cookie value as a DB key.
 */
export function sessionKeyFromCookie(cookieValue: string): string {
  return crypto.createHash("sha256").update(cookieValue).digest("hex").slice(0, 32);
}

export function setGlobalSessionCookie(res: Response): string {
  // Random token rather than a fixed "ok" string so we can derive a stable
  // per-browser sessionKey for watchlist scoping.
  const value = crypto.randomBytes(24).toString("hex");
  res.cookie(GLOBAL_COOKIE_NAME, value, {
    httpOnly: true,
    secure: isProd(),
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_MS,
    signed: true,
    path: GLOBAL_COOKIE_PATH,
  });
  return value;
}

export function clearGlobalSessionCookie(res: Response): void {
  res.clearCookie(GLOBAL_COOKIE_NAME, { path: GLOBAL_COOKIE_PATH, signed: true });
}

export function getGlobalCookieValue(req: Request): string | undefined {
  const v = (req.signedCookies as Record<string, unknown> | undefined)?.[GLOBAL_COOKIE_NAME];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

export function isGloballyAuthenticated(req: Request): boolean {
  return getGlobalCookieValue(req) !== undefined;
}

/**
 * Express middleware — protects every /api/global/* route except auth ones.
 * Returns 503 (not 401) when the password isn't configured, so the UI can
 * show a clear "set GLOBAL_APP_ACCESS_PASSWORD in Secrets" message.
 */
export function requireGlobalAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isGlobalPasswordConfigured()) {
    res.status(503).json({
      error: "global_password_not_configured",
      code: "GLOBAL_PASSWORD_NOT_SET",
      hint: "Set GLOBAL_APP_ACCESS_PASSWORD in environment / Secrets.",
    });
    return;
  }
  if (!isGloballyAuthenticated(req)) {
    res.status(401).json({ error: "unauthorized", code: "GLOBAL_AUTH_REQUIRED" });
    return;
  }
  next();
}

export function logGlobalAuthBootState(): void {
  logger.info(
    { configured: isGlobalPasswordConfigured() },
    "Global scanner auth gate initialised",
  );
}
