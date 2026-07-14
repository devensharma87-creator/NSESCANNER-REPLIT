import { describe, it, expect, beforeEach } from "vitest";
import { randomBytes } from "node:crypto";
import {
  encryptToken,
  decryptToken,
  isEncrypted,
  isEncryptionKeyConfigured,
  _resetKeyCacheForTests,
} from "./kiteCrypto";

const SAMPLE_TOKEN = "sample-not-a-real-kite-token-1234567890abcdef";

function setKey(): void {
  process.env["KITE_TOKEN_ENC_KEY"] = randomBytes(32).toString("base64");
  _resetKeyCacheForTests();
}
function unsetKey(): void {
  delete process.env["KITE_TOKEN_ENC_KEY"];
  _resetKeyCacheForTests();
}

describe("kiteCrypto", () => {
  beforeEach(() => {
    unsetKey();
  });

  describe("with a valid key", () => {
    beforeEach(() => setKey());

    it("isEncryptionKeyConfigured returns true", () => {
      expect(isEncryptionKeyConfigured()).toBe(true);
    });

    it("round-trips a token", () => {
      const ct = encryptToken(SAMPLE_TOKEN);
      expect(ct).not.toBe(SAMPLE_TOKEN);
      expect(ct.startsWith("v1:")).toBe(true);
      expect(isEncrypted(ct)).toBe(true);
      expect(decryptToken(ct)).toBe(SAMPLE_TOKEN);
    });

    it("produces a different ciphertext each call (random IV)", () => {
      const a = encryptToken(SAMPLE_TOKEN);
      const b = encryptToken(SAMPLE_TOKEN);
      expect(a).not.toBe(b);
      expect(decryptToken(a)).toBe(decryptToken(b));
    });

    it("never includes the plaintext token in the ciphertext envelope", () => {
      const ct = encryptToken(SAMPLE_TOKEN);
      expect(ct.includes(SAMPLE_TOKEN)).toBe(false);
    });

    it("rejects tampered ciphertext via auth tag", () => {
      const ct = encryptToken(SAMPLE_TOKEN);
      const parts = ct.split(":");
      // Flip a byte in the ciphertext segment.
      const ctBytes = Buffer.from(parts[3]!.replace(/-/g, "+").replace(/_/g, "/"), "base64");
      ctBytes[0] = ctBytes[0]! ^ 0xff;
      const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${ctBytes
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "")}`;
      expect(() => decryptToken(tampered)).toThrow();
    });

    it("passes through an already-encrypted value rather than double-wrapping", () => {
      const ct = encryptToken(SAMPLE_TOKEN);
      const ct2 = encryptToken(ct);
      expect(ct2).toBe(ct);
    });

    it("decryptToken passes through legacy plaintext", () => {
      expect(decryptToken("legacy-plaintext")).toBe("legacy-plaintext");
    });

    it("decryptToken handles null/empty", () => {
      expect(decryptToken(null)).toBeNull();
      expect(decryptToken("")).toBe("");
    });

    it("rejects empty plaintext on encrypt", () => {
      expect(() => encryptToken("")).toThrow();
    });

    it("rejects malformed v1 envelopes", () => {
      expect(() => decryptToken("v1:onlytwoparts")).toThrow();
      expect(() => decryptToken("v1:a:b")).toThrow();
    });
  });

  describe("with no key set (legacy/passthrough mode)", () => {
    it("isEncryptionKeyConfigured returns false", () => {
      expect(isEncryptionKeyConfigured()).toBe(false);
    });

    it("encryptToken returns the input unchanged", () => {
      expect(encryptToken(SAMPLE_TOKEN)).toBe(SAMPLE_TOKEN);
    });

    it("decryptToken passes legacy plaintext through", () => {
      expect(decryptToken(SAMPLE_TOKEN)).toBe(SAMPLE_TOKEN);
    });

    it("decryptToken FAILS CLOSED on a v1: payload without a key", () => {
      // Encrypt with a key, then unset the key and try to decrypt.
      process.env["KITE_TOKEN_ENC_KEY"] = randomBytes(32).toString("base64");
      _resetKeyCacheForTests();
      const ct = encryptToken(SAMPLE_TOKEN);
      delete process.env["KITE_TOKEN_ENC_KEY"];
      _resetKeyCacheForTests();
      expect(() => decryptToken(ct)).toThrow(/KITE_TOKEN_ENC_KEY/);
    });
  });

  describe("with a malformed key", () => {
    it("rejects a key that doesn't decode to 32 bytes", () => {
      process.env["KITE_TOKEN_ENC_KEY"] = "too-short";
      _resetKeyCacheForTests();
      expect(() => encryptToken(SAMPLE_TOKEN)).toThrow(/32 bytes/);
      expect(isEncryptionKeyConfigured()).toBe(false);
    });

    it("accepts a 64-char hex key", () => {
      process.env["KITE_TOKEN_ENC_KEY"] = randomBytes(32).toString("hex");
      _resetKeyCacheForTests();
      expect(isEncryptionKeyConfigured()).toBe(true);
      const ct = encryptToken(SAMPLE_TOKEN);
      expect(decryptToken(ct)).toBe(SAMPLE_TOKEN);
    });
  });

  describe("isEncrypted detector", () => {
    it("detects v1 envelopes", () => {
      expect(isEncrypted("v1:a:b:c")).toBe(true);
    });
    it("rejects legacy plaintext", () => {
      expect(isEncrypted("legacy-plaintext")).toBe(false);
      expect(isEncrypted("")).toBe(false);
      expect(isEncrypted(null)).toBe(false);
      expect(isEncrypted(undefined)).toBe(false);
    });
  });
});
