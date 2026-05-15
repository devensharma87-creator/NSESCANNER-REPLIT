/**
 * Encryption-at-rest for Kite session tokens.
 *
 * Format (v1): "v1:<iv_b64>:<tag_b64>:<ct_b64>"
 *   - AES-256-GCM
 *   - 12-byte random IV per encryption
 *   - 16-byte auth tag (GCM default)
 *   - All three components base64url-encoded (no padding)
 *
 * Key handling:
 *   - Read from env KITE_TOKEN_ENC_KEY.
 *   - Accepts a 32-byte key encoded as base64 (44 chars w/ padding or 43 w/o)
 *     OR as 64 hex chars. Anything else throws on first use.
 *   - If unset: encryptToken() returns the value UNCHANGED (passthrough)
 *     and logs a one-time warning. This keeps prod boot working before the
 *     operator has set the key. decryptToken() of a v1: payload without a
 *     key throws — fail-closed, so getActiveSession() returns null and the
 *     daily Kite re-login flow takes over.
 *
 * Backwards compatibility:
 *   - decryptToken() of a string WITHOUT the "v1:" prefix is returned as-is
 *     (legacy plaintext row). The caller (kiteAuth) will lazily re-encrypt on
 *     next write.
 *
 * No token value is ever logged by this module.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { logger } from "./logger";

const VERSION = "v1";
const ALGO = "aes-256-gcm";
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

let cachedKey: Buffer | null = null;
let cachedKeyResolved = false;
let warnedMissing = false;

function b64urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

/** Parse the env-supplied key. Returns null if env is unset/empty.
 *  Throws (with a non-token error message) if the env value is malformed. */
function loadKeyFromEnv(): Buffer | null {
  if (cachedKeyResolved) return cachedKey;
  cachedKeyResolved = true;
  const raw = (process.env["KITE_TOKEN_ENC_KEY"] ?? "").trim();
  if (!raw) {
    cachedKey = null;
    return null;
  }
  let buf: Buffer | null = null;
  // Try hex (64 chars, only [0-9a-f])
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    buf = Buffer.from(raw, "hex");
  } else {
    // Try base64 / base64url
    try {
      const candidate = b64urlDecode(raw);
      if (candidate.length === KEY_LEN) buf = candidate;
    } catch {
      // fall through
    }
    if (!buf) {
      try {
        const candidate = Buffer.from(raw, "base64");
        if (candidate.length === KEY_LEN) buf = candidate;
      } catch {
        // fall through
      }
    }
  }
  if (!buf || buf.length !== KEY_LEN) {
    throw new Error(
      `KITE_TOKEN_ENC_KEY must decode to exactly ${KEY_LEN} bytes (use 32 random bytes encoded as base64 or 64 hex chars). Length seen after decode: ${buf?.length ?? "invalid"}.`,
    );
  }
  cachedKey = buf;
  return cachedKey;
}

/** Returns true iff KITE_TOKEN_ENC_KEY is configured and well-formed. */
export function isEncryptionKeyConfigured(): boolean {
  try {
    return loadKeyFromEnv() !== null;
  } catch {
    return false;
  }
}

/** True iff the value carries our v1 ciphertext envelope. */
export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === "string" && value.startsWith(`${VERSION}:`);
}

/** Encrypt a token. Returns the v1 envelope string.
 *  If KITE_TOKEN_ENC_KEY is unset, returns the input unchanged (with a
 *  one-time warning) so deploys without the key still function while the
 *  operator wires the secret in. */
export function encryptToken(plain: string): string {
  if (typeof plain !== "string" || plain.length === 0) {
    throw new Error("encryptToken: input must be a non-empty string");
  }
  // If the caller hands us an already-encrypted value (defensive — should
  // not normally happen), pass it through rather than double-wrapping.
  if (isEncrypted(plain)) return plain;
  const key = loadKeyFromEnv();
  if (!key) {
    if (!warnedMissing) {
      warnedMissing = true;
      logger.warn(
        "KITE_TOKEN_ENC_KEY not set — Kite session tokens will be stored in plaintext (legacy mode). Set the secret to enable encryption-at-rest.",
      );
    }
    return plain;
  }
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  if (tag.length !== TAG_LEN) {
    // Should be impossible with GCM defaults but be explicit.
    throw new Error("encryptToken: unexpected auth tag length");
  }
  return `${VERSION}:${b64urlEncode(iv)}:${b64urlEncode(tag)}:${b64urlEncode(ct)}`;
}

/** Decrypt a token. Accepts:
 *   - v1: envelope → returns the plaintext (throws on tamper / missing key)
 *   - legacy plaintext (no v1: prefix) → returned unchanged
 *   - null / "" → returned as-is
 */
export function decryptToken(value: string | null): string | null {
  if (value == null || value === "") return value;
  if (!isEncrypted(value)) return value; // legacy plaintext row
  const parts = value.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("decryptToken: malformed v1 envelope");
  }
  const key = loadKeyFromEnv();
  if (!key) {
    throw new Error(
      "decryptToken: KITE_TOKEN_ENC_KEY is not set but DB contains an encrypted Kite session. Set the key to read existing rows, or DELETE FROM kite_session and re-login.",
    );
  }
  const iv = b64urlDecode(parts[1]!);
  const tag = b64urlDecode(parts[2]!);
  const ct = b64urlDecode(parts[3]!);
  if (iv.length !== IV_LEN) throw new Error("decryptToken: bad iv length");
  if (tag.length !== TAG_LEN) throw new Error("decryptToken: bad tag length");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  // .final() throws if the auth tag doesn't verify — that's our tamper detection.
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

/** Test-only: reset the cached key so a test can mutate process.env between cases. */
export function _resetKeyCacheForTests(): void {
  cachedKey = null;
  cachedKeyResolved = false;
  warnedMissing = false;
}
