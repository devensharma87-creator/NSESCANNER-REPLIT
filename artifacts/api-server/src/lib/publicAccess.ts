/**
 * Public-access toggle.
 *
 * When ENABLED, the global `requireAuth` middleware lets every request
 * through and `/auth/me` returns a synthetic owner identity, so any
 * unauthenticated visitor can browse the entire site. When DISABLED
 * (default), the existing cookie/password gate is in force.
 *
 * The flag is persisted to `.cache/public-access.json` so it survives
 * server restarts (otherwise a workflow restart would silently re-lock
 * a publicly-shared site, breaking shared links). State is mirrored in
 * a module-level `cached` boolean to avoid disk I/O on every request.
 *
 * SECURITY NOTES:
 *  - Toggling the flag (in either direction) requires the owner
 *    password OR an existing owner session cookie. A random visitor
 *    on a publicly-shared site cannot lock the owner out.
 *  - When enabled, the cookie session machinery still works alongside
 *    — owner/subscriber cookies are not invalidated. Public mode just
 *    means "even visitors WITHOUT a cookie get full owner-equivalent
 *    access".
 *  - The state change is logged at WARN level so the audit trail makes
 *    it obvious when the site went public and when it was relocked.
 */
import { loadBlob, saveBlob } from "./diskCache";
import { logger } from "./logger";

const BLOB_NAME = "public-access";
const BLOB_VERSION = 1;

interface PublicAccessShape {
  enabled: boolean;
  changedAt: string;
}

let cached: boolean | null = null;

function loadFromDisk(): boolean {
  const blob = loadBlob<PublicAccessShape>(BLOB_NAME, BLOB_VERSION);
  return blob?.payload?.enabled === true;
}

export function isPublicAccessEnabled(): boolean {
  if (cached === null) cached = loadFromDisk();
  return cached;
}

export function setPublicAccess(enabled: boolean): void {
  cached = enabled;
  saveBlob<PublicAccessShape>(BLOB_NAME, BLOB_VERSION, {
    enabled,
    changedAt: new Date().toISOString(),
  });
  if (enabled) {
    logger.warn(
      "PUBLIC ACCESS MODE ENABLED — anyone with the URL can browse the site without authentication. " +
        "POST /api/auth/public-mode { enabled: false, password } to relock.",
    );
  } else {
    logger.warn("Public access mode DISABLED — owner/subscriber auth gate restored.");
  }
}

export function logPublicAccessBootState(): void {
  if (isPublicAccessEnabled()) {
    logger.warn(
      "Boot state: PUBLIC ACCESS MODE is ON — auth gate is bypassed for /api/*. " +
        "Disable via the in-app banner (owner password) or POST /api/auth/public-mode { enabled: false, password }.",
    );
  }
}
