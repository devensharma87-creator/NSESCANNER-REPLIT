#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-https://kite-analytics-lab.preview.emergentagent.com}"
DSN="${DSN:-postgresql://nse:nse_secure_2026@localhost:5432/nsescanner}"
APP_PASSWORD="${APP_PASSWORD:-HrishiAdmin@2026}"
COOKIE_JAR="/tmp/marketscanner_kite_status_cookies.txt"

echo "## supervisor status"
sudo supervisorctl status postgresql || true

echo "## postgres SELECT 1"
psql "$DSN" -v ON_ERROR_STOP=1 -X -A -t -c "SELECT 1 AS ok;"

echo "## writer_version schema width"
psql "$DSN" -v ON_ERROR_STOP=1 -X -A -F $'\t' -c "SELECT table_name, column_name, data_type, character_maximum_length FROM information_schema.columns WHERE table_schema='public' AND table_name='option_signal_history' AND column_name='writer_version';"

echo "## option_signal_history post-alter emission proof"
psql "$DSN" -v ON_ERROR_STOP=1 -X -A -F $'\t' -c "SELECT COUNT(*) AS total_rows, MAX(generated_at) AS latest_generated_at, COUNT(*) FILTER (WHERE generated_at > TIMESTAMPTZ '2026-07-17 11:43:49+05:30') AS rows_after_alter, COUNT(*) FILTER (WHERE writer_version = 'paper-writer-v1.3.0-reasoning-instrumented') AS rows_with_long_writer_version, MAX(generated_at) FILTER (WHERE writer_version = 'paper-writer-v1.3.0-reasoning-instrumented') AS latest_long_writer_version_at FROM option_signal_history;"

echo "## latest option_signal_history rows"
psql "$DSN" -v ON_ERROR_STOP=1 -X -A -F $'\t' -c "SELECT signal_date, index_symbol, setup_key, direction, generated_at, writer_version, char_length(writer_version) AS writer_version_len FROM option_signal_history ORDER BY generated_at DESC LIMIT 10;"

echo "## fno_signal_reasoning freshness"
psql "$DSN" -v ON_ERROR_STOP=1 -X -A -F $'\t' -c "SELECT COUNT(*) FILTER (WHERE captured_at >= now() - interval '5 minutes') AS rows_last_5m, MAX(captured_at) AS latest_captured_at, now() AS db_now FROM fno_signal_reasoning;"

echo "## postgresql overflow errors after 2026-07-17 06:13:49 UTC"
python3 - <<'PY'
from pathlib import Path
from datetime import datetime, timezone
import re
path = Path('/var/log/supervisor/postgresql.err.log')
cutoff = datetime.fromisoformat('2026-07-17T06:13:49+00:00')
matches = []
if path.exists():
    for line in path.read_text(errors='replace').splitlines():
        if 'value too long for type character varying(32)' not in line:
            continue
        # PostgreSQL default log prefix here is expected to include an ISO-like UTC timestamp.
        m = re.search(r'(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:\s+UTC)?', line)
        if m:
            ts = datetime.fromisoformat(f'{m.group(1)}T{m.group(2)}+00:00')
            if ts > cutoff:
                matches.append(line)
        else:
            matches.append(f'UNPARSEABLE_TS: {line}')
print(f'overflow_errors_after_cutoff={len(matches)}')
for item in matches[-20:]:
    print(item)
PY

echo "## auth login and Kite status"
rm -f "$COOKIE_JAR"
curl -sS -i -c "$COOKIE_JAR" -H 'Content-Type: application/json' -X POST "$BASE_URL/api/auth/login" --data "{\"password\":\"$APP_PASSWORD\"}" | sed -n '1,20p'
curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/kite/status"
echo

echo "## callback route registration check (missing token should redirect to /kite with missing_request_token)"
curl -sS -i "$BASE_URL/api/kite/callback" | sed -n '1,20p'

echo "## expected redirect URL"
echo "$BASE_URL/api/kite/callback"