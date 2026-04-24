import { Router, type IRouter } from "express";
import {
  setSessionCookie,
  clearSessionCookie,
  isAuthenticated,
  verifyPassword,
  isPasswordConfigured,
} from "../lib/auth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/auth/status", (req, res) => {
  res.json({
    authenticated: isAuthenticated(req),
    passwordConfigured: isPasswordConfigured(),
  });
});

router.post("/auth/login", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const password = typeof body["password"] === "string" ? (body["password"] as string) : "";
  if (!password) {
    res.status(400).json({ error: "password required" });
    return;
  }
  if (!isPasswordConfigured()) {
    logger.error("Login attempted but APP_ACCESS_PASSWORD is not configured");
    res.status(503).json({ error: "auth not configured on server" });
    return;
  }
  if (!verifyPassword(password)) {
    logger.warn({ ip: req.ip }, "Login attempt rejected (bad password)");
    res.status(401).json({ error: "invalid password" });
    return;
  }
  setSessionCookie(res);
  res.json({ ok: true });
});

router.post("/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

export default router;
