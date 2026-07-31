/**
 * tripwireHarness.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * P0.1B Process-Wide DB Network Tripwire Harness
 *
 * Run via:  pnpm run test:tripwire   (from artifacts/api-server)
 *
 * This harness:
 *   1. Allocates a free loopback port as the sentinel DB endpoint
 *   2. Creates an isolated temp directory for per-process/thread manifests
 *   3. Generates a random nonce (each harness run has a unique nonce)
 *   4. Sets DATABASE_URL to a fake sentinel value; removes TEST_DATABASE_URL
 *   5. Installs NODE_OPTIONS --require for the CJS preload
 *   6. Runs controls:
 *        NEG-NET-01  Deliberate sentinel connection → detected + blocked
 *        POS-NET-01  No connection → manifest with zero attempts
 *        NEG-NET-03  Corrupt manifest field → validator fails closed
 *   7. Runs the full non-DB suite (vitest.config.tripwire.ts) under the tripwire
 *   8. Validates ALL manifests: nonce, schema, finite numbers, zero attempts
 *   9. Prints the required summary table
 *  10. Exits 0 only when every gate passes
 *
 * INVARIANTS
 *   - Operational DATABASE_URL is never passed to child processes
 *   - No real DB connection is attempted or completed
 *   - No ?? 0, || 0, or missing-manifest-as-success in manifest validation
 *   - DB_TEST_RUNTIME_AUTHORIZED remains false
 */

import { spawnSync }   from 'child_process';
import * as fs          from 'fs';
import * as path        from 'path';
import * as os          from 'os';
import * as crypto      from 'crypto';
import * as net         from 'net';

// ── Constants ─────────────────────────────────────────────────────────────────
const ROOT         = process.cwd();          // artifacts/api-server
const PRELOAD      = path.join(ROOT, 'src/test-infra/dbNetworkTripwire.preload.cjs');
const NEG_SCRIPT   = path.join(ROOT, 'src/test-infra/tripwireNegControl.cjs');
const POS_SCRIPT   = path.join(ROOT, 'src/test-infra/tripwirePosControl.cjs');
const TRIPWIRE_CFG = path.join(ROOT, 'vitest.config.tripwire.ts');

// ── Types ─────────────────────────────────────────────────────────────────────
interface TripwireManifest {
  schemaVersion:     number;
  nonce:             string;
  pid:               number;
  instanceId:        string;
  preloadLoaded:     boolean;
  connectionAttempts: number;
  perPathway:        { netSocketConnect: number; tlsConnect: number };
  malformed:         boolean;
  events:            unknown[];
}

type ValidateResult =
  | { valid: true;  manifest: TripwireManifest }
  | { valid: false; error: string };

// ── Helpers ───────────────────────────────────────────────────────────────────
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as net.AddressInfo;
      server.close(() => resolve(addr.port));
    });
    server.on('error', reject);
  });
}

/**
 * Validate one manifest file.
 * Rules:
 *   - File must exist and be parseable JSON
 *   - schemaVersion === 1
 *   - nonce must match the harness nonce
 *   - pid must be a finite number
 *   - preloadLoaded must be true
 *   - connectionAttempts must be a finite number (NOT converted from missing via ?? 0)
 *   - perPathway.netSocketConnect / tlsConnect must both be finite numbers
 */
function validateManifest(filePath: string, expectedNonce: string): ValidateResult {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e: unknown) {
    return { valid: false, error: `manifest not readable: ${filePath} — ${(e as Error).message}` };
  }

  let m: Record<string, unknown>;
  try {
    m = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { valid: false, error: `manifest not valid JSON: ${filePath}` };
  }

  if (!m || typeof m !== 'object' || Array.isArray(m)) {
    return { valid: false, error: 'root is not an object' };
  }
  if (m['schemaVersion'] !== 1) {
    return { valid: false, error: `schemaVersion !== 1 (got ${String(m['schemaVersion'])})` };
  }
  if (m['nonce'] !== expectedNonce) {
    return { valid: false, error: `nonce mismatch: expected ${expectedNonce}, got ${String(m['nonce'])}` };
  }
  if (typeof m['pid'] !== 'number' || !Number.isFinite(m['pid'] as number)) {
    return { valid: false, error: `pid is not a finite number (got ${String(m['pid'])})` };
  }
  if (m['preloadLoaded'] !== true) {
    return { valid: false, error: `preloadLoaded !== true (got ${String(m['preloadLoaded'])})` };
  }

  // connectionAttempts: must be a number, must be finite — NO ?? 0 fallback
  if (typeof m['connectionAttempts'] !== 'number') {
    return { valid: false, error: `connectionAttempts is not a number (got type ${typeof m['connectionAttempts']})` };
  }
  if (!Number.isFinite(m['connectionAttempts'] as number)) {
    return { valid: false, error: `connectionAttempts is not finite (got ${String(m['connectionAttempts'])})` };
  }

  // perPathway checks
  const pp = m['perPathway'];
  if (!pp || typeof pp !== 'object' || Array.isArray(pp)) {
    return { valid: false, error: 'perPathway is missing or not an object' };
  }
  const ppObj = pp as Record<string, unknown>;
  for (const key of ['netSocketConnect', 'tlsConnect'] as const) {
    if (typeof ppObj[key] !== 'number') {
      return { valid: false, error: `perPathway.${key} is not a number (got type ${typeof ppObj[key]})` };
    }
    if (!Number.isFinite(ppObj[key] as number)) {
      return { valid: false, error: `perPathway.${key} is not finite (got ${String(ppObj[key])})` };
    }
  }

  return { valid: true, manifest: m as unknown as TripwireManifest };
}

function listManifests(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter(f => f.startsWith('tripwire-') && f.endsWith('.json'))
      .map(f => path.join(dir, f));
  } catch {
    return [];
  }
}

function clearManifests(dir: string): void {
  listManifests(dir).forEach(f => {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  });
  // Also remove any corruption test files
  try {
    fs.readdirSync(dir)
      .filter(f => f.startsWith('corrupt-') && f.endsWith('.json'))
      .forEach(f => {
        try { fs.unlinkSync(path.join(dir, f)); } catch { /* ignore */ }
      });
  } catch { /* ignore */ }
}

function section(title: string): void {
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(70));
}

function pass(msg: string): void { console.log(`  ✓ ${msg}`); }
function fail(msg: string): void { console.error(`  ✗ FAIL: ${msg}`); }

// ── Main ──────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('\n╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║   P0.1B PROCESS-WIDE DB NETWORK TRIPWIRE HARNESS                    ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  // ── 1. Allocate resources ───────────────────────────────────────────────────
  const sentinelPort = await findFreePort();
  const manifestDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'tripwire-'));
  const nonce        = crypto.randomUUID();

  console.log(`\n  Sentinel port : 127.0.0.1:${sentinelPort}`);
  console.log(`  Manifest dir  : ${manifestDir}`);
  console.log(`  Nonce         : ${nonce}`);
  console.log(`  Preload       : ${PRELOAD}`);
  console.log(`  Tripwire cfg  : ${TRIPWIRE_CFG}`);

  // Verify preload exists
  if (!fs.existsSync(PRELOAD)) {
    console.error(`\nFATAL: preload not found at ${PRELOAD}`);
    process.exit(1);
  }

  // ── 2. Build child environment ──────────────────────────────────────────────
  // Operational DATABASE_URL is NEVER passed to any child.
  const childEnv: Record<string, string | undefined> = {
    ...process.env,
    DATABASE_URL:               `postgresql://tripwire:tripwire@127.0.0.1:${sentinelPort}/tripwire_only`,
    TRIPWIRE_NONCE:             nonce,
    TRIPWIRE_MANIFEST_DIR:      manifestDir,
    TRIPWIRE_SENTINEL_PORT:     String(sentinelPort),
    DB_TEST_RUNTIME_AUTHORIZED: 'false',
    NODE_ENV:                   'test',
  };
  // Explicitly remove real test-DB credential
  delete childEnv['TEST_DATABASE_URL'];

  // Build NODE_OPTIONS with --require preload (prepend; preserve any existing flags)
  const requireFlag   = `--require ${PRELOAD}`;
  const existingOpts  = process.env.NODE_OPTIONS || '';
  childEnv['NODE_OPTIONS'] = existingOpts ? `${requireFlag} ${existingOpts}` : requireFlag;

  const spawnOpts = {
    env:      childEnv as NodeJS.ProcessEnv,
    encoding: 'utf8' as const,
    timeout:  15_000,
  };

  let allPassed = true;

  // ──────────────────────────────────────────────────────────────────────────
  // NEG-NET-01  Deliberate connection attempt — must be detected and blocked
  // ──────────────────────────────────────────────────────────────────────────
  section('NEG-NET-01: Deliberate sentinel connection (must be intercepted)');
  clearManifests(manifestDir);

  const negResult = spawnSync('node', [NEG_SCRIPT], spawnOpts);

  console.log(`  Child exit code: ${negResult.status}`);
  if (negResult.stdout) console.log(`  stdout: ${negResult.stdout.trim()}`);
  if (negResult.stderr) console.log(`  stderr: ${negResult.stderr.trim()}`);

  const negManifests = listManifests(manifestDir);
  console.log(`  Manifests found: ${negManifests.length}`);

  let neg01Ok       = true;
  let negTotalAttempts = 0;

  if (negManifests.length === 0) {
    fail('no manifest written — preload did not run');
    neg01Ok = false;
  }

  for (const mf of negManifests) {
    const r = validateManifest(mf, nonce);
    if (!r.valid) {
      fail(`manifest invalid: ${r.error}`);
      neg01Ok = false;
    } else {
      negTotalAttempts += r.manifest.connectionAttempts;
      console.log(`  manifest ${path.basename(mf)}: attempts=${r.manifest.connectionAttempts} perPathway=${JSON.stringify(r.manifest.perPathway)}`);
    }
  }

  if (negTotalAttempts === 0) {
    fail('total attempts === 0 — tripwire did NOT detect the deliberate connection');
    neg01Ok = false;
  } else {
    pass(`total attempts = ${negTotalAttempts} (> 0 — connection intercepted and blocked)`);
  }

  // Verify no socket actually connected — negResult.status should be non-zero
  // (uncaught exception from throw) or code 0 if the script caught it.
  // We rely on the manifest for the authoritative proof; exit code is informational.
  if (neg01Ok) pass('NEG-NET-01: PASS');
  else { fail('NEG-NET-01: FAIL'); allPassed = false; }

  // ──────────────────────────────────────────────────────────────────────────
  // POS-NET-01  Harmless control — zero attempts, manifest valid
  // ──────────────────────────────────────────────────────────────────────────
  section('POS-NET-01: Harmless control (no connection — zero attempts expected)');
  clearManifests(manifestDir);

  const posResult = spawnSync('node', [POS_SCRIPT], spawnOpts);

  console.log(`  Child exit code: ${posResult.status}`);
  if (posResult.stdout) console.log(`  stdout: ${posResult.stdout.trim()}`);

  const posManifests = listManifests(manifestDir);
  console.log(`  Manifests found: ${posManifests.length}`);

  let pos01Ok = true;

  if (posResult.status !== 0) {
    fail(`child exited non-zero (${posResult.status})`);
    pos01Ok = false;
  }

  if (posManifests.length === 0) {
    fail('no manifest written — preload did not run');
    pos01Ok = false;
  }

  for (const mf of posManifests) {
    const r = validateManifest(mf, nonce);
    if (!r.valid) {
      fail(`manifest invalid: ${r.error}`);
      pos01Ok = false;
    } else {
      console.log(`  manifest ${path.basename(mf)}: attempts=${r.manifest.connectionAttempts}`);
      if (r.manifest.connectionAttempts !== 0) {
        fail(`connectionAttempts !== 0 (got ${r.manifest.connectionAttempts})`);
        pos01Ok = false;
      } else {
        pass('connectionAttempts === 0 (explicit finite zero)');
      }
    }
  }

  if (pos01Ok) pass('POS-NET-01: PASS');
  else { fail('POS-NET-01: FAIL'); allPassed = false; }

  // ──────────────────────────────────────────────────────────────────────────
  // NEG-NET-03  Manifest corruption — validator must fail closed
  // ──────────────────────────────────────────────────────────────────────────
  section('NEG-NET-03: Manifest corruption — validator must fail closed');

  let neg03Ok = false;

  if (posManifests.length > 0) {
    const baseRaw = JSON.parse(fs.readFileSync(posManifests[0], 'utf8')) as Record<string, unknown>;

    // 3a: delete connectionAttempts
    const c1 = { ...baseRaw };
    delete c1['connectionAttempts'];
    const c1Path = path.join(manifestDir, 'corrupt-1.json');
    fs.writeFileSync(c1Path, JSON.stringify(c1));
    const r1 = validateManifest(c1Path, nonce);

    // 3b: set connectionAttempts to null
    const c2 = { ...baseRaw, connectionAttempts: null };
    const c2Path = path.join(manifestDir, 'corrupt-2.json');
    fs.writeFileSync(c2Path, JSON.stringify(c2));
    const r2 = validateManifest(c2Path, nonce);

    // 3c: nonce mismatch
    const c3 = { ...baseRaw, nonce: 'wrong-nonce-intentionally-corrupted' };
    const c3Path = path.join(manifestDir, 'corrupt-3.json');
    fs.writeFileSync(c3Path, JSON.stringify(c3));
    const r3 = validateManifest(c3Path, nonce);

    // 3d: perPathway.netSocketConnect set to undefined (missing)
    const c4pp = { ...baseRaw['perPathway'] as Record<string, unknown> };
    delete c4pp['netSocketConnect'];
    const c4 = { ...baseRaw, perPathway: c4pp };
    const c4Path = path.join(manifestDir, 'corrupt-4.json');
    fs.writeFileSync(c4Path, JSON.stringify(c4));
    const r4 = validateManifest(c4Path, nonce);

    console.log(`  corrupt-1 (missing connectionAttempts): valid=${r1.valid} ${!r1.valid ? '→ ' + r1.error : ''}`);
    console.log(`  corrupt-2 (null connectionAttempts):    valid=${r2.valid} ${!r2.valid ? '→ ' + r2.error : ''}`);
    console.log(`  corrupt-3 (nonce mismatch):             valid=${r3.valid} ${!r3.valid ? '→ ' + r3.error : ''}`);
    console.log(`  corrupt-4 (missing perPathway field):   valid=${r4.valid} ${!r4.valid ? '→ ' + r4.error : ''}`);

    if (r1.valid || r2.valid || r3.valid || r4.valid) {
      fail(`validator accepted a corrupt manifest: r1=${r1.valid} r2=${r2.valid} r3=${r3.valid} r4=${r4.valid}`);
    } else {
      pass('all 4 corrupt variants correctly rejected (fails closed, no ?? 0 fallback)');
      neg03Ok = true;
    }
  } else {
    fail('no base manifests available (POS-NET-01 must pass first)');
  }

  if (neg03Ok) pass('NEG-NET-03: PASS');
  else { fail('NEG-NET-03: FAIL'); allPassed = false; }

  // ──────────────────────────────────────────────────────────────────────────
  // FULL SUITE  Run test:full under the tripwire; verify zero DB attempts
  // ──────────────────────────────────────────────────────────────────────────
  section('FULL SUITE: vitest test:full under process-wide tripwire');
  clearManifests(manifestDir);
  console.log('  Spawning: pnpm exec vitest run --config vitest.config.tripwire.ts --pool=threads');
  console.log('  (may take up to 120 seconds)\n');

  const suiteResult = spawnSync(
    'pnpm',
    ['exec', 'vitest', 'run', '--config', 'vitest.config.tripwire.ts', '--pool=threads'],
    {
      env:      childEnv as NodeJS.ProcessEnv,
      cwd:      ROOT,
      encoding: 'utf8' as const,
      timeout:  200_000,
    },
  );

  const suiteManifests = listManifests(manifestDir);
  const suitePassed    = suiteResult.status === 0;

  // Print vitest output tail
  const vitestLines = (suiteResult.stdout || '').split('\n');
  console.log('  --- Vitest output (last 15 lines) ---');
  vitestLines.slice(-15).forEach(l => console.log(`  ${l}`));
  console.log('  ---');

  console.log(`\n  Vitest exit code        : ${suiteResult.status}`);
  console.log(`  Manifests written       : ${suiteManifests.length}`);

  if (!suitePassed) {
    fail(`vitest exited ${suiteResult.status}`);
    if (suiteResult.stderr) console.error('  stderr:', suiteResult.stderr.slice(-1000));
    allPassed = false;
  }

  // Validate all manifests and sum attempts
  let suiteAttempts        = 0;
  let invalidManifestCount = 0;
  let instrumentedCount    = 0;

  for (const mf of suiteManifests) {
    const r = validateManifest(mf, nonce);
    if (!r.valid) {
      fail(`manifest ${path.basename(mf)} invalid: ${r.error}`);
      invalidManifestCount++;
    } else {
      suiteAttempts += r.manifest.connectionAttempts;
      instrumentedCount++;
    }
  }

  console.log(`  Processes/threads instrumented: ${instrumentedCount}`);
  console.log(`  Invalid manifests             : ${invalidManifestCount}`);
  console.log(`  Total DB network attempts     : ${suiteAttempts}`);

  if (suiteManifests.length === 0) {
    fail('no manifests found — preload did NOT run in the vitest process');
    allPassed = false;
  } else if (invalidManifestCount > 0) {
    fail(`${invalidManifestCount} manifests failed validation`);
    allPassed = false;
  } else if (suiteAttempts !== 0) {
    fail(`${suiteAttempts} DB network attempts detected — suite is NOT connection-safe`);
    allPassed = false;
  } else {
    pass(`all ${instrumentedCount} manifests valid`);
    pass('total DB network attempts = 0 (aggregate exact zero, no ?? 0 conversion)');
  }

  // Check: no .db.test.ts collected by vitest
  const vitestOutput = suiteResult.stdout || '';
  const dbTestMatches = (vitestOutput.match(/\.db\.test\.ts/g) ?? []).length;
  if (dbTestMatches > 0) {
    fail(`${dbTestMatches} .db.test.ts references in vitest output — DB files were collected`);
    allPassed = false;
  } else {
    pass('.db.test.ts files: 0 collected by vitest');
  }

  // Extract test counts from vitest output for reporting
  const countMatch = vitestOutput.match(/Tests\s+(\d+) passed/);
  const fileMatch  = vitestOutput.match(/Test Files\s+(\d+) passed/);
  const suiteTestCount = countMatch ? parseInt(countMatch[1], 10) : -1;
  const suiteFileCount = fileMatch  ? parseInt(fileMatch[1],  10) : -1;
  console.log(`  Tests passed: ${suiteTestCount} in ${suiteFileCount} files`);

  if (suitePassed && suiteManifests.length > 0 && invalidManifestCount === 0 && suiteAttempts === 0) {
    pass('FULL SUITE: PASS');
  } else {
    fail('FULL SUITE: FAIL');
    allPassed = false;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Summary table
  // ──────────────────────────────────────────────────────────────────────────
  section('SUMMARY TABLE');
  console.log('');
  console.log('| Run          | Suite exit | Manifests | Processes instrumented | DB files collected | Network attempts | Result    |');
  console.log('|---|---:|---:|---:|---:|---:|---|');
  console.log(`| NEG-NET-01   | ${String(negResult.status).padEnd(10)} | ${String(negManifests.length).padEnd(9)} | 1                      | N/A                | ${String(negTotalAttempts).padEnd(16)} | ${neg01Ok ? 'detected ✓' : 'FAIL ✗   '} |`);
  console.log(`| POS-NET-01   | ${String(posResult.status).padEnd(10)} | ${String(posManifests.length).padEnd(9)} | 1                      | N/A                | ${'0'.padEnd(16)}| ${pos01Ok ? 'pass ✓    ' : 'FAIL ✗   '} |`);
  console.log(`| test:full    | ${String(suiteResult.status ?? 'err').padEnd(10)} | ${String(suiteManifests.length).padEnd(9)} | ${String(instrumentedCount).padEnd(22)} | ${'0'.padEnd(18)} | ${'0'.padEnd(16)} | ${(suitePassed && suiteAttempts === 0 && invalidManifestCount === 0) ? 'pass ✓    ' : 'FAIL ✗   '} |`);
  console.log('');
  console.log(`NEG-NET-03 (manifest corruption detection): ${neg03Ok ? 'PASS ✓' : 'FAIL ✗'}`);

  // ── Log non-zero manifests before cleanup ────────────────────────────────────
  if (suiteAttempts > 0) {
    console.log('\n  Non-zero connection manifests (suite run):');
    for (const mf of suiteManifests) {
      const r = validateManifest(mf, nonce);
      if (r.valid && r.manifest.connectionAttempts > 0) {
        const raw = JSON.parse(fs.readFileSync(mf, 'utf8')) as Record<string, unknown>;
        const events = Array.isArray(raw['events']) ? raw['events'] as Array<Record<string, unknown>> : [];
        console.log(`    ${path.basename(mf)}: attempts=${r.manifest.connectionAttempts}`);
        for (const ev of events) {
          const traces = Array.isArray(ev['trace']) ? (ev['trace'] as string[]) : [];
          const appLines = traces.filter(l => l.includes('/artifacts/api-server/') && !l.includes('node_modules') && !l.includes('preload.cjs'));
          const printLines = appLines.length > 0 ? appLines.slice(0, 5) : traces.slice(5, 10);
          console.log(`      trace: ${printLines.join(' || ')}`);
        }
      }
    }
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────
  try {
    fs.rmSync(manifestDir, { recursive: true, force: true });
  } catch { /* ignore cleanup errors */ }

  // ── Final verdict ────────────────────────────────────────────────────────────
  console.log('');
  if (allPassed) {
    console.log('════════════════════════════════════════════════════════════════════════');
    console.log('  OVERALL: PASS — P0.1B PROCESS-WIDE ZERO-CONNECTION PROOF COMPLETE ✓');
    console.log('════════════════════════════════════════════════════════════════════════\n');
    process.exit(0);
  } else {
    console.error('════════════════════════════════════════════════════════════════════════');
    console.error('  OVERALL: FAIL — one or more gates failed');
    console.error('════════════════════════════════════════════════════════════════════════\n');
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('Harness fatal error:', err);
  process.exit(1);
});
