/**
 * INDstocks provider — DISABLED SCAFFOLD.
 *
 * INDstocks is the planned secondary validation/failover source. Its adapter,
 * cross-provider instrument mapping and mismatch guards are a separate task.
 * Until then this module exists only so the router/diagnostics can report it
 * honestly as configured-but-disabled. It NEVER returns market data.
 */

import { getPolicy } from "./policy";

export interface IndstocksHealth {
  enabled: boolean;
  reachable: boolean;
  reason: string;
}

export function isIndstocksEnabled(): boolean {
  return getPolicy().indstocksEnabled;
}

export function indstocksHealth(): IndstocksHealth {
  const enabled = isIndstocksEnabled();
  return {
    enabled,
    reachable: false,
    reason: enabled
      ? "INDstocks is flagged on, but the adapter is not implemented yet (scaffold only)."
      : "INDstocks is disabled (scaffold only). Enable via INDSTOCKS_ENABLED once the adapter ships.",
  };
}
