import fs from 'node:fs';
import { execFileSync, execSync } from 'node:child_process';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:8001';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'HrishiAdmin@2026';
const DSN = process.env.PG_DSN || 'postgresql://nse:nse_secure_2026@localhost:5432/nsescanner';
const RESTART_ISO = '2026-07-17T14:00:40Z';
const results = [];

function record(name, ok, detail = {}) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}: ${JSON.stringify(detail)}`);
}

async function main() {
  const loginResp = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  const loginText = await loginResp.text();
  const cookie = loginResp.headers.get('set-cookie')?.split(';')[0] || '';
  record('admin login returns ok and session cookie', loginResp.ok && cookie.length > 0, {
    status: loginResp.status,
    body: loginText.slice(0, 120),
    hasCookie: cookie.length > 0,
  });

  const authHeaders = cookie ? { cookie } : {};

  const paperResp = await fetch(`${BASE}/api/paper/account?segment=EQUITY&reconcile=1`, { headers: authHeaders });
  const paperText = await paperResp.text();
  let paperJson = null;
  try { paperJson = JSON.parse(paperText); } catch {}
  const mtm = paperJson?.openMarkToMarketPnl;
  const notes = Array.isArray(paperJson?.notes) ? paperJson.notes.join(' | ') : '';
  record('paper equity reconciliation returns finite non-null MTM without quantity error',
    paperResp.ok && Number.isFinite(Number(mtm)) && mtm !== null && mtm !== undefined && !/quantity/i.test(paperText),
    { status: paperResp.status, openMarkToMarketPnl: mtm, bodySample: paperText.slice(0, 500), notes });

  const kiteStatusResp = await fetch(`${BASE}/api/kite/status`, { headers: authHeaders });
  const kiteStatusText = await kiteStatusResp.text();
  let kiteStatus = null;
  try { kiteStatus = JSON.parse(kiteStatusText); } catch {}
  record('kite status after admin login is loggedIn and KITE_READY',
    kiteStatusResp.ok && kiteStatus?.loggedIn === true && kiteStatus?.readiness?.state === 'KITE_READY',
    { status: kiteStatusResp.status, loggedIn: kiteStatus?.loggedIn, readinessState: kiteStatus?.readiness?.state, bodySample: kiteStatusText.slice(0, 500) });

  const loginUrlResp = await fetch(`${BASE}/api/kite/login-url`, { headers: authHeaders });
  const loginUrlText = await loginUrlResp.text();
  let loginUrlJson = null;
  try { loginUrlJson = JSON.parse(loginUrlText); } catch {}
  record('kite login-url is available to logged-in admin',
    loginUrlResp.ok && typeof loginUrlJson?.url === 'string' && /https:\/\/kite\.zerodha\.com\/connect\/login\?/.test(loginUrlJson.url),
    { status: loginUrlResp.status, urlSample: loginUrlJson?.url?.replace(/api_key=[^&]+/, 'api_key=***') ?? loginUrlText.slice(0, 200), expectedAppRedirectPath: '/api/kite/callback' });

  const callbackResp = await fetch(`${BASE}/api/kite/callback`, { redirect: 'manual' });
  record('kite callback redirect endpoint is reachable at /api/kite/callback',
    callbackResp.status === 302 && (callbackResp.headers.get('location') || '').startsWith('/kite?login=failed'),
    { status: callbackResp.status, location: callbackResp.headers.get('location'), redirectUrlForKiteApp: '<deployment-domain>/api/kite/callback' });

  const src = fs.readFileSync('/app/artifacts/api-server/src/lib/paperAccountReconciliation.ts', 'utf8');
  const quantityMatches = src.match(/quantity/g) || [];
  const requiredSnippets = [
    'SUM((last_price - entry_price) * qty)',
    'entry_price × qty',
    'SUM(entry_price * qty)',
    'SUM(exit_price  * qty)',
  ];
  record('source has no quantity fossil and expected qty snippets',
    quantityMatches.length === 0 && requiredSnippets.every((s) => src.includes(s)),
    { quantityCount: quantityMatches.length, snippetsPresent: Object.fromEntries(requiredSnippets.map((s) => [s, src.includes(s)])) });

  const distStat = fs.statSync('/app/artifacts/api-server/dist/index.mjs');
  record('compiled dist/index.mjs rebuilt at/after restart moment',
    distStat.mtime >= new Date(RESTART_ISO),
    { mtime: distStat.mtime.toISOString(), threshold: RESTART_ISO });

  const pids = execSync(`pgrep -af 'node --enable-source-maps ./dist/index.mjs' | awk '{print $1}' || true`, { encoding: 'utf8' }).trim().split(/\s+/).filter(Boolean);
  let envValue = null;
  for (const pid of pids) {
    try {
      const envRaw = fs.readFileSync(`/proc/${pid}/environ`);
      const envParts = envRaw.toString('utf8').split('\0');
      const hit = envParts.find((x) => x.startsWith('REASONING_WRITER_V2_ENABLED='));
      if (hit) envValue = hit.split('=')[1];
    } catch {}
  }
  record('running apiserver process has REASONING_WRITER_V2_ENABLED=1', envValue === '1', { pids, envValue });

  const logText = fs.existsSync('/var/log/supervisor/postgresql.err.log')
    ? fs.readFileSync('/var/log/supervisor/postgresql.err.log', 'utf8')
    : '';
  const postRestartQuantityLines = logText.split('\n').filter((line) => line.includes('quantity') && /2026-07-17 14:0[1-9]|2026-07-17 14:[1-5][0-9]|2026-07-17 1[5-9]:|2026-07-17 2[0-3]:|2026-07-1[89]|2026-07-[2-9]/.test(line));
  record('postgresql.err.log has zero post-restart quantity errors', postRestartQuantityLines.length === 0, {
    count: postRestartQuantityLines.length,
    sample: postRestartQuantityLines.slice(-5),
  });

  const schemaSql = `SELECT table_name, column_name, character_maximum_length FROM information_schema.columns WHERE table_schema='public' AND ((table_name='option_signal_history' AND column_name IN ('writer_version','execution_status')) OR (table_name='fno_signal_reasoning' AND column_name='verdict')) ORDER BY table_name, column_name;`;
  const schemaOut = execFileSync('psql', [DSN, '-At', '-c', schemaSql], { encoding: 'utf8' });
  const schemaRows = schemaOut.trim().split('\n').filter(Boolean).map((line) => line.split('|'));
  const got = Object.fromEntries(schemaRows.map(([t, c, len]) => [`${t}.${c}`, Number(len)]));
  record('prior varchar ALTERs are preserved',
    got['option_signal_history.writer_version'] === 64 && got['option_signal_history.execution_status'] === 32 && got['fno_signal_reasoning.verdict'] === 24,
    { got, raw: schemaOut.trim() });

  const ok = results.every((r) => r.ok);
  fs.writeFileSync('/app/test_reports/bug_verification_5_raw_results.json', JSON.stringify({ ok, results }, null, 2));
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err?.stack || err);
  fs.writeFileSync('/app/test_reports/bug_verification_5_raw_results.json', JSON.stringify({ ok: false, error: String(err?.stack || err), results }, null, 2));
  process.exit(1);
});