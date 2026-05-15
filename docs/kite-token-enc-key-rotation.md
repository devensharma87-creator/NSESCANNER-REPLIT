# `KITE_TOKEN_ENC_KEY` rotation runbook

Operator-facing guide for rotating the AES-256-GCM key that protects
the Zerodha Kite session tokens at rest.

> **Audience.** The owner / operator only. This is a security-sensitive
> procedure — read the whole document once before doing it. None of the
> commands below print token plaintext or key bytes; if a step asks you
> to copy the key, do it inside a private terminal and never paste it
> into chat, logs, or version control.

---

## 1. What is `KITE_TOKEN_ENC_KEY`?

A 32-byte symmetric key used by `artifacts/api-server/src/lib/kiteCrypto.ts`
to encrypt the three sensitive columns of the single `kite_session` row:

- `api_key`
- `access_token`
- `public_token`

Format on disk: `v1:<iv>:<tag>:<ct>` (AES-256-GCM, base64url-encoded
parts). Encrypted writes happen on every Kite login (`kiteAuth.completeLogin`).

The key itself lives in **Replit Secrets** as `KITE_TOKEN_ENC_KEY`. It
never lives in the codebase, the database, or any log.

## 2. Why protect it?

Holding `KITE_TOKEN_ENC_KEY` plus a Postgres dump = a working Kite
access token until the next 06:00 IST Zerodha logout. Treat it with
the same care as `DATABASE_URL` itself.

## 3. When to rotate

- **Immediately**, if you suspect the secret has leaked (committed by
  accident, exposed in a screenshot, copied into a 3rd-party tool, etc.).
- After any incident touching `APP_ACCESS_PASSWORD` or `SESSION_SECRET`
  — these gate the diagnostic surfaces that can read live state.
- On a routine cadence — every 90 days is a sensible default.
- After offboarding anyone who had access to Replit Secrets.

## 4. What happens if it is lost?

The encrypted `kite_session` row becomes undecryptable. The runtime
fail-closes — `getActiveSession()` returns `null` — so the next 06:00
IST Kite re-login simply recreates the row using whatever key is now
configured. No data corruption, only a forced re-login.

If you have lost the key and want to short-circuit the wait:

```bash
psql "$DATABASE_URL" -c "DELETE FROM kite_session;"
```

…then re-login via the in-app "Reconnect Zerodha" CTA.

## 5. How to generate a new 32-byte key

In a private terminal (not the Replit shell — the shell history is
not a place for keys):

```bash
node -e 'console.log(require("crypto").randomBytes(32).toString("base64"))'
```

Output is a 44-character base64 string. The rotation script also
accepts 64-char hex (`randomBytes(32).toString("hex")`) — the
acceptance rules are enforced by `parseKeyMaterial()` and tested in
`rotateKiteTokenEncKey.test.ts`.

## 6. Rotation procedure (no token / key plaintext printed)

The `rotate:kite-key` script reads OLD and NEW keys from env, decrypts
every encrypted column with OLD, re-encrypts with NEW, and writes the
result inside a single transaction. Dry-run is the default. Token
values and key bytes are **never** logged — only counts and short
non-reversible fingerprints (`sha256(key)[:8]`).

### Step A — set both keys in your shell session only

```bash
# OLD = whatever is currently in Replit Secrets as KITE_TOKEN_ENC_KEY
export KITE_TOKEN_ENC_KEY_OLD="<paste current key here>"
export KITE_TOKEN_ENC_KEY_NEW="<paste freshly generated key here>"
# DATABASE_URL must point at the SAME database the running app uses.
export DATABASE_URL="<your prod DB URL>"
```

### Step B — dry-run (writes nothing)

```bash
pnpm --filter @workspace/api-server run rotate:kite-key
```

A successful dry-run looks like:

```
mode=DRY-RUN oldKeyFp=ab12cd34 newKeyFp=ef56gh78
columns api_key=ENCRYPTED access_token=ENCRYPTED public_token=ENCRYPTED
encryptedColumnCount=3
status=DRY_RUN_OK (verified all encrypted columns decrypt with OLD and re-encrypt with NEW; no rows written)
```

If the dry-run does **not** print `status=DRY_RUN_OK`, do not proceed.
Common reasons:

| Symptom | Meaning | Fix |
|---|---|---|
| `ERROR: KITE_TOKEN_ENC_KEY_OLD invalid` | Key didn't decode to 32 bytes | Re-paste; check for trailing whitespace |
| `ERROR: ... are identical` | OLD and NEW match | Generate a fresh NEW key |
| `ERROR: decrypt/re-encrypt failed` | OLD key isn't the one the row was sealed with | Confirm `KITE_TOKEN_ENC_KEY` in Replit Secrets matches your `..._OLD` |
| `status=NO_ROW` | `kite_session` is empty | No rotation needed; the next login will use whichever key is in Replit Secrets |
| `status=NOTHING_TO_ROTATE` | Row exists but every column is plaintext | Trigger one Kite re-login first so columns become encrypted, then rotate |

### Step C — apply

```bash
pnpm --filter @workspace/api-server run rotate:kite-key -- --apply
```

A successful apply looks like:

```
mode=APPLY oldKeyFp=ab12cd34 newKeyFp=ef56gh78
columns api_key=ENCRYPTED access_token=ENCRYPTED public_token=ENCRYPTED
encryptedColumnCount=3
status=APPLIED (kite_session re-encrypted under NEW key)
next-step: update KITE_TOKEN_ENC_KEY in Replit Secrets to the NEW value, then restart api-server.
```

### Step D — swap the key in Replit Secrets

In **Replit → Secrets**, update `KITE_TOKEN_ENC_KEY` to the NEW value.
Then restart the api-server workflow.

### Step E — verify

1. The api-server restart should not warn `KITE_TOKEN_ENC_KEY not set`.
2. Hit the owner-only diagnostic:

   ```
   GET /api/security/audit
   ```

   `kiteEncDetail` should report
   *"Live kite_session row IS encrypted at rest (AES-256-GCM, v1: envelope) and KITE_TOKEN_ENC_KEY is configured."*
3. Confirm the app still serves Kite-backed data (e.g. open `/scanner`).
   If anything goes wrong, the next 06:00 IST will recover automatically;
   in the meantime the user-facing "Reconnect Zerodha" CTA forces a
   manual re-login.

### Step F — clear the env vars

```bash
unset KITE_TOKEN_ENC_KEY_OLD KITE_TOKEN_ENC_KEY_NEW
history -c   # zsh: history -p
```

## 7. Rollback / failure handling

The rotation is a **single transaction** over one row. Either the
entire row is re-encrypted under NEW, or no change is made. There is
no half-rotated state to clean up.

If something looks wrong **after** Step C but **before** Step D:

- The DB now holds ciphertext under NEW.
- The running app still has OLD in `KITE_TOKEN_ENC_KEY`.
- `getActiveSession()` will fail-close → `null` → daily re-login fires
  at the next 06:00 IST.

To force immediate recovery either:

- complete Step D (swap the secret + restart), OR
- run the rotation in reverse (set `KITE_TOKEN_ENC_KEY_OLD` to NEW and
  `KITE_TOKEN_ENC_KEY_NEW` to OLD, dry-run, apply), OR
- nuke the row: `psql "$DATABASE_URL" -c "DELETE FROM kite_session;"`
  and let the next Kite login re-seal under whatever key Replit
  Secrets currently holds.

## 8. Post-rotation verification checklist

- [ ] Step B dry-run printed `status=DRY_RUN_OK`.
- [ ] Step C apply printed `status=APPLIED`.
- [ ] Replit Secrets `KITE_TOKEN_ENC_KEY` now equals the NEW value.
- [ ] api-server workflow restarted cleanly (no `KITE_TOKEN_ENC_KEY not set` warning).
- [ ] `GET /api/security/audit` shows `kiteEncDetail` confirming encryption-at-rest.
- [ ] One round-trip Kite-backed page (e.g. `/scanner`) renders without
      a `KiteOfflineBanner`.
- [ ] Shell env vars `..._OLD` / `..._NEW` are unset.

## 9. Safety guarantees of the rotation tool

Enforced by `rotateKiteTokenEncKey.ts` and verified by
`rotateKiteTokenEncKey.test.ts`:

- Token plaintext is never logged. Test:
  *"output ciphertexts NEVER contain the plaintext token"* +
  *"throws when error message contains NEITHER plaintext NOR raw key bytes"*.
- Key bytes (OLD or NEW) are never logged — only the 8-hex-char
  `sha256(key)[:8]` fingerprint.
- Dry-run is the default. `--apply` (or `--commit`) is required to
  write. Test: *"dry-run by default"*.
- Wrong OLD key fails-closed before any write. Test:
  *"throws when OLD key is wrong"*.
- Identical OLD and NEW are rejected (no-op rotation is a misconfig).
- Empty / malformed key strings are rejected with non-token error
  messages. Tests: *"parseKeyMaterial rejects ..."*.
- Already-encrypted columns are never double-wrapped (`encryptWithKey`
  throws on a v1: envelope input). Test: *"refuses to double-wrap"*.
- Apply runs inside a single transaction so a partial write cannot
  leave the row in a mixed-key state.

## 10. Limitations

- **Single-row scope.** Only the `kite_session` row (id="active") is
  rotated. No other table currently uses `KITE_TOKEN_ENC_KEY`. If a
  future column adopts it, this script must be extended.
- **No multi-key transitional period.** The runtime knows about exactly
  one key at a time; expect a brief window between Step C and Step D
  where reads fail-close and the app falls back to Yahoo until you
  complete Step D. The 06:00 IST re-login is the natural recovery
  boundary if you cannot complete the swap immediately.
- **Operator-supplied keys.** The script does not generate keys for
  you (deliberately — generation belongs in a private shell, not
  inside the app's process).

---

Cross-references:

- Implementation: `artifacts/api-server/src/lib/kiteCrypto.ts`,
  `artifacts/api-server/src/scripts/rotateKiteTokenEncKey.ts`
- Tests: `artifacts/api-server/src/lib/kiteCrypto.test.ts`,
  `artifacts/api-server/src/scripts/rotateKiteTokenEncKey.test.ts`
- Audit context: `docs/audit-implementation-status-2026-05-15.md` (Priority 1)
- Security hygiene summary: `replit.md` → "Security hygiene"
