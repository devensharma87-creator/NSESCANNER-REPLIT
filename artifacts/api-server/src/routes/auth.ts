import { Router, type IRouter } from "express";
import {
  setSessionCookie,
  clearSessionCookie,
  isAuthenticated,
  verifyPassword,
  isPasswordConfigured,
} from "../lib/auth";
import { isOwner } from "../lib/userAuth";
import { isPublicAccessEnabled, setPublicAccess } from "../lib/publicAccess";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/auth/status", (req, res) => {
  res.json({
    authenticated: isAuthenticated(req),
    passwordConfigured: isPasswordConfigured(),
    publicMode: isPublicAccessEnabled(),
  });
});

// ── Public-access toggle ──────────────────────────────────────────────
// GET is unauthenticated so the login screen + banner can read state
// without a session. POST requires either an existing owner cookie OR
// the owner password in the body — random visitors on a publicly-shared
// site can NOT lock the owner out, and they can NOT make a locked site
// public without knowing the password.
router.get("/auth/public-mode", (_req, res) => {
  res.json({ enabled: isPublicAccessEnabled() });
});

router.post("/auth/public-mode", (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const enabled = body["enabled"] === true;
  const password = typeof body["password"] === "string" ? (body["password"] as string) : "";
  const owner = isOwner(req);
  // Misconfiguration guard: if APP_ACCESS_PASSWORD is unset AND there's no
  // existing owner cookie, the toggle is unreachable. Fail loudly with 503
  // instead of a misleading 401, so the operator knows to set the secret.
  if (!isPasswordConfigured() && !owner) {
    logger.error("Public-mode toggle attempted but APP_ACCESS_PASSWORD is unset");
    res.status(503).json({ error: "password_not_configured" });
    return;
  }
  const passwordOk = password.length > 0 && verifyPassword(password);
  if (!owner && !passwordOk) {
    logger.warn(
      { ip: req.ip, owner, supplied: password.length > 0 },
      "Public-mode toggle rejected (no owner cookie and no/invalid password)",
    );
    res.status(401).json({ error: "owner_password_required" });
    return;
  }
  setPublicAccess(enabled);
  // Audit trail: who, how, what — emitted at WARN since this is a
  // security-state change that should always show up in the log feed.
  logger.warn(
    {
      ip: req.ip,
      authMethod: owner ? "owner-cookie" : "owner-password",
      previousMode: enabled ? "locked" : "public",
      newMode: enabled ? "public" : "locked",
    },
    `Public-mode toggle SUCCEEDED → ${enabled ? "PUBLIC" : "LOCKED"}`,
  );
  res.json({ ok: true, enabled });
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
