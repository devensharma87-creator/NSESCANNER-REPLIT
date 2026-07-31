'use strict';
/**
 * tripwireNegControl.cjs
 * ─────────────────────────────────────────────────────────────────────────────
 * NEG-NET-01 child script for the P0.1B process-wide tripwire harness.
 *
 * Deliberately connects to the sentinel loopback port to prove the tripwire
 * intercepts and blocks the attempt.
 *
 * Expected outcome (tripwire active):
 *   - net.Socket.prototype.connect throws DB_NETWORK_TRIPWIRE_CONNECTION_ATTEMPT
 *   - Exception is NOT caught — process exits non-zero (uncaught exception)
 *   - Manifest is written with connectionAttempts > 0
 *   - No OS socket was created or opened
 *
 * If we reach the line after sock.connect(), the tripwire failed to intercept.
 * In that case we exit code 3 (distinct from the normal uncaught-exception code 1).
 */

const net = require('net');

const sentinelPort = parseInt(process.env.TRIPWIRE_SENTINEL_PORT || '0', 10);
if (!sentinelPort || !Number.isFinite(sentinelPort)) {
  process.stderr.write('[NEG-CONTROL] TRIPWIRE_SENTINEL_PORT not set or invalid\n');
  process.exit(2);
}

process.stdout.write(`[NEG-CONTROL] Attempting net.Socket.connect to 127.0.0.1:${sentinelPort}\n`);

// Deliberately connect — must throw DB_NETWORK_TRIPWIRE_CONNECTION_ATTEMPT.
// We do NOT wrap this in try/catch so the process exits with an uncaught exception.
const sock = new net.Socket();
sock.connect(sentinelPort, '127.0.0.1');

// If execution reaches here, the tripwire did NOT intercept. This is a harness failure.
process.stderr.write('[NEG-CONTROL] ERROR: net.Socket.connect did not throw — tripwire NOT active\n');
process.exit(3);
