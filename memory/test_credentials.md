# Test Credentials — MarketScanner (Hrishi Associates)

## Admin (site master password — not a user account)
- Login: open site → "Admin" tab → password: `HrishiAdmin@2026`
- API: `POST /api/auth/login` body `{"password":"HrishiAdmin@2026"}` → sets HttpOnly session cookie.

## Global scanner gate
- Password: `HrishiGlobal@2026` (`POST /api/global/auth/login`)

## Database (local)
- postgresql://nse:nse_secure_2026@localhost:5432/nsescanner (PGDATA=/app/.pgdata)

## Not yet provided by user
- Kite Connect: KITE_API_KEY / KITE_API_SECRET / daily access token
- Telegram: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID
