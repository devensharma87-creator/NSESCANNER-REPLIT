# Test Credentials — MarketScanner (Hrishi Associates)

## Admin (site master password — not a user account)
- Login: open site → "Admin" tab → password: `HrishiAdmin@2026`
- API: `POST /api/auth/login` body `{"password":"HrishiAdmin@2026"}` → sets HttpOnly session cookie.

## Global scanner gate
- Password: `HrishiGlobal@2026` (`POST /api/global/auth/login`)

## Database (local)
- postgresql://nse:nse_secure_2026@localhost:5432/nsescanner (PGDATA=/app/.pgdata)

## Secrets Vault (owner-only page at /secrets-vault)
- Owner pastes KITE_API_KEY, KITE_API_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID,
  PREPOST_TELEGRAM_* there. Backend route: /api/secrets-vault/status (masked) and
  /api/secrets-vault/set (writes /app/backend/.env chmod 600, then process exits so
  supervisor restarts apiserver with new env, ~25s downtime).

## Not yet provided by user (check /api/secrets-vault/status before assuming)
- Kite Connect: KITE_API_KEY / KITE_API_SECRET / daily access token
- Telegram: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
