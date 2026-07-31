'use strict';
/**
 * tripwirePosControl.cjs
 * ─────────────────────────────────────────────────────────────────────────────
 * POS-NET-01 child script for the P0.1B process-wide tripwire harness.
 *
 * Harmless control: loads the preload (via NODE_OPTIONS --require) but does
 * NOT attempt any DB or sentinel connection.
 *
 * Expected outcome:
 *   - Process exits 0
 *   - Preload manifest exists with preloadLoaded: true
 *   - connectionAttempts: 0 (explicit finite number, no ?? 0 fallback)
 *   - All perPathway counters are explicit 0
 */

process.stdout.write('[POS-CONTROL] loaded — no DB connection attempted\n');
process.stdout.write(`[POS-CONTROL] pid=${process.pid}\n`);
process.stdout.write(`[POS-CONTROL] TRIPWIRE_NONCE present: ${Boolean(process.env.TRIPWIRE_NONCE)}\n`);
process.stdout.write(`[POS-CONTROL] DATABASE_URL host check: ${
  (process.env.DATABASE_URL || '').includes('tripwire') ? 'fake (ok)' : 'REAL (FAIL)'
}\n`);
process.exit(0);
