/**
 * dbNetworkTripwire.setup.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Vitest setupFiles entry for vitest.config.tripwire.ts.
 *
 * Belt-and-suspenders: NODE_OPTIONS --require loads dbNetworkTripwire.preload.cjs
 * in the main Vitest process and (via tinypool execArgv propagation) in each
 * worker thread. This setupFiles entry ensures installation even in workers that
 * do not inherit execArgv.
 *
 * The preload's INSTALLED_KEY guard prevents double-installation: if the worker
 * already has the preload loaded (via --require), this require() is a no-op.
 *
 * NO-OP when TRIPWIRE_NONCE is absent — normal test runs are completely unaffected.
 */
import { createRequire } from 'module';

if (process.env.TRIPWIRE_NONCE) {
  const _require = createRequire(import.meta.url);
  _require('./dbNetworkTripwire.preload.cjs');
}
