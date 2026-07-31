'use strict';
/**
 * dbNetworkTripwire.preload.cjs
 * ─────────────────────────────────────────────────────────────────────────────
 * Process-wide DB network tripwire for P0.1B zero-connection proof.
 *
 * ACTIVATION
 *   Load via:  NODE_OPTIONS="--require /abs/path/dbNetworkTripwire.preload.cjs"
 *   The module is a pure no-op when TRIPWIRE_NONCE is not set, so it is safe
 *   to load in any context.
 *
 * WHAT IT DOES (when activated)
 *   - Patches net.Socket.prototype.connect and tls.connect
 *   - Intercepts only connections to the sentinel loopback host:port
 *   - On match: increments counter, records event, writes manifest, THROWS
 *   - Non-sentinel connections are passed through unchanged
 *   - Writes a per-instance manifest JSON to TRIPWIRE_MANIFEST_DIR
 *
 * ENV VARS (set by tripwireHarness.ts)
 *   TRIPWIRE_NONCE         Random UUID; must be present to activate
 *   TRIPWIRE_MANIFEST_DIR  Absolute path to temp dir for manifest files
 *   TRIPWIRE_SENTINEL_PORT Port number on 127.0.0.1 used as the fake DB endpoint
 *
 * MANIFEST SCHEMA (schemaVersion: 1)
 *   {
 *     schemaVersion: 1,
 *     nonce:                string,
 *     pid:                  number,
 *     instanceId:           string (random hex — unique per thread),
 *     preloadLoaded:        true,
 *     connectionAttempts:   number (finite, >= 0),
 *     perPathway:           { netSocketConnect: number, tlsConnect: number },
 *     malformed:            false (true if writeManifest itself threw),
 *     events:               Array<{ pathway, pid, host, port, timestamp }>
 *   }
 *
 * INVARIANTS
 *   - No ?? 0, || 0, optional-chain-to-zero, or missing-field fallbacks.
 *   - Any missing or non-finite field in a manifest must fail validation.
 *   - No real credentials; TRIPWIRE_NONCE is a transient random UUID.
 */

const net    = require('net');
const tls    = require('tls');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

// ── Guard: prevent double-installation in the same V8 context ───────────────
const INSTALLED_KEY = '__TRIPWIRE_PRELOAD_INSTALLED_v1__';
if (global[INSTALLED_KEY]) {
  module.exports = { _alreadyInstalled: true };
  return; // CJS modules are wrapped functions — top-level return is valid
}

// ── Activation check ─────────────────────────────────────────────────────────
const nonce          = process.env.TRIPWIRE_NONCE;
const manifestDir    = process.env.TRIPWIRE_MANIFEST_DIR;
const sentinelPortRaw = process.env.TRIPWIRE_SENTINEL_PORT;
const sentinelPort   = sentinelPortRaw ? parseInt(sentinelPortRaw, 10) : 0;

if (!nonce || !manifestDir || !sentinelPort || !Number.isFinite(sentinelPort) || sentinelPort <= 0) {
  // Not in tripwire mode — no-op
  module.exports = {};
  return;
}

// ── Mark as installed before any async work ───────────────────────────────────
global[INSTALLED_KEY] = true;

// ── Per-instance state ────────────────────────────────────────────────────────
// Worker threads all share process.pid; use a random hex suffix for uniqueness.
const instanceId   = crypto.randomBytes(4).toString('hex');
const manifestPath = path.join(manifestDir, `tripwire-${process.pid}-${instanceId}.json`);

/** @type {{ schemaVersion:number, nonce:string, pid:number, instanceId:string,
 *            preloadLoaded:boolean, connectionAttempts:number,
 *            perPathway:{netSocketConnect:number,tlsConnect:number},
 *            malformed:boolean, events:unknown[] }} */
const state = {
  schemaVersion:    1,
  nonce,
  pid:              process.pid,
  instanceId,
  preloadLoaded:    true,
  connectionAttempts: 0,
  perPathway: {
    netSocketConnect: 0,
    tlsConnect:       0,
  },
  malformed: false,
  events:    [],
};

function writeManifestSync() {
  try {
    fs.mkdirSync(manifestDir, { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(state, null, 2) + '\n', 'utf8');
  } catch (err) {
    // Never throw from the writer — flag malformed and log
    state.malformed = true;
    process.stderr.write(
      `[TRIPWIRE] manifest write error (pid=${process.pid} inst=${instanceId}): ${err.message}\n`,
    );
  }
}

// Write initial manifest immediately (zero attempts) so the file exists
// even if the process exits before any interception is triggered.
writeManifestSync();

// ── Helpers ───────────────────────────────────────────────────────────────────
function isSentinel(host, port) {
  const portNum = typeof port === 'string' ? parseInt(port, 10) : Number(port);
  return (
    Number.isFinite(portNum) &&
    portNum === sentinelPort &&
    (host === '127.0.0.1' || host === 'localhost' || host === '::1')
  );
}

function extractHostPort(args) {
  const firstArg = args[0];
  if (firstArg !== null && typeof firstArg === 'object' && !Array.isArray(firstArg)) {
    return {
      host: String(firstArg.host || firstArg.hostname || 'localhost'),
      port: firstArg.port,
    };
  }
  if (typeof firstArg === 'number') {
    return {
      host: typeof args[1] === 'string' ? args[1] : 'localhost',
      port: firstArg,
    };
  }
  // Unix socket path or other non-TCP form — not a DB connection
  return null;
}

function recordAndThrow(pathway, host, port) {
  const traceLines = new Error('__trace__').stack?.split('\n').slice(2, 12) ?? [];
  const event = {
    pathway,
    pid:       process.pid,
    instanceId,
    host:      String(host),
    port:      Number(port),
    timestamp: new Date().toISOString(),
    trace:     traceLines,
  };
  state.connectionAttempts += 1;
  state.perPathway[
    pathway === 'tls.connect' ? 'tlsConnect' : 'netSocketConnect'
  ] += 1;
  state.events.push(event);
  writeManifestSync();

  const err = new Error('DB_NETWORK_TRIPWIRE_CONNECTION_ATTEMPT');
  err.code  = 'DB_NETWORK_TRIPWIRE_CONNECTION_ATTEMPT';
  throw err;
}

// ── Patch net.Socket.prototype.connect ───────────────────────────────────────
const _originalNetSocketConnect = net.Socket.prototype.connect;

net.Socket.prototype.connect = function _tripwireNetSocketConnect(...args) {
  const hp = extractHostPort(args);
  if (hp && isSentinel(hp.host, hp.port)) {
    recordAndThrow('net.Socket.prototype.connect', hp.host, hp.port);
  }
  return _originalNetSocketConnect.apply(this, args);
};

// ── Patch tls.connect ─────────────────────────────────────────────────────────
const _originalTlsConnect = tls.connect;

tls.connect = function _tripwireTlsConnect(...args) {
  const hp = extractHostPort(args);
  if (hp && isSentinel(hp.host, hp.port)) {
    recordAndThrow('tls.connect', hp.host, hp.port);
  }
  return _originalTlsConnect.apply(this, args);
};

// ── Finalize manifest on process/worker exit ──────────────────────────────────
// 'beforeExit' fires in worker threads; 'exit' fires at process level.
process.on('beforeExit', writeManifestSync);
process.on('exit',       writeManifestSync);

// ── Export for introspection in tests ────────────────────────────────────────
module.exports = {
  _tripwireState:    state,
  _manifestPath:     manifestPath,
  _sentinelPort:     sentinelPort,
  _writeManifestSync: writeManifestSync,
};
