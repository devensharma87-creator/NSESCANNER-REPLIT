/**
 * Portfolio Analyser — benchmark selection preference (pure, tested).
 *
 * Persists the user's last-chosen benchmark so the comparison no longer resets
 * to NIFTY 50 on every page load. Stored client-side in `localStorage`, scoped
 * per saved portfolio (keyed by portfolio id) with a shared default scope used
 * for the unsaved / sample working set. This keeps the preference per-portfolio
 * AND per-user (browser) with zero backend, schema, or codegen changes.
 *
 * Honest by construction: this only remembers a UI selection. It never affects
 * which series is fetched beyond the user's own choice, and the explicit
 * "unavailable" fallback in `compareToBenchmark` is unchanged.
 */
import { BENCHMARK_OPTIONS, type BenchmarkOption } from "./benchmark";

export type BenchmarkKey = BenchmarkOption["key"];

/** Default selection when nothing has been stored yet. */
export const DEFAULT_BENCHMARK_KEY: BenchmarkKey = BENCHMARK_OPTIONS[0].key;

const STORAGE_PREFIX = "portfolio-analyser:benchmark:";
const DEFAULT_SCOPE = "__default__";

const VALID_KEYS: ReadonlySet<string> = new Set(BENCHMARK_OPTIONS.map(o => o.key));

/** Type guard: is the supplied value a currently-known benchmark key? */
export function isBenchmarkKey(value: unknown): value is BenchmarkKey {
  return typeof value === "string" && VALID_KEYS.has(value);
}

function scopeKey(portfolioId: string | null): string {
  const scope = portfolioId && portfolioId.trim().length ? portfolioId : DEFAULT_SCOPE;
  return STORAGE_PREFIX + scope;
}

function safeStorage(): Storage | undefined {
  try {
    return typeof window !== "undefined" ? window.localStorage : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read the stored benchmark for a given portfolio scope. Returns null when
 * nothing valid is stored (or storage is unavailable). Unknown / stale keys are
 * treated as absent so a renamed/removed index never sticks.
 */
export function loadBenchmarkPref(
  portfolioId: string | null,
  storage: Storage | undefined = safeStorage(),
): BenchmarkKey | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(scopeKey(portfolioId));
    return isBenchmarkKey(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Persist the benchmark selection for a given portfolio scope. No-op when storage is unavailable. */
export function saveBenchmarkPref(
  portfolioId: string | null,
  key: BenchmarkKey,
  storage: Storage | undefined = safeStorage(),
): void {
  if (!storage || !isBenchmarkKey(key)) return;
  try {
    storage.setItem(scopeKey(portfolioId), key);
  } catch {
    /* ignore quota / disabled storage — preference persistence is best-effort */
  }
}

/**
 * Resolve the benchmark to show for a portfolio: prefer the per-portfolio
 * preference, then the shared default-scope preference (so a brand-new portfolio
 * inherits the user's usual pick), then the global default key.
 */
export function resolveBenchmarkPref(
  portfolioId: string | null,
  storage: Storage | undefined = safeStorage(),
): BenchmarkKey {
  const own = loadBenchmarkPref(portfolioId, storage);
  if (own) return own;
  if (portfolioId) {
    const shared = loadBenchmarkPref(null, storage);
    if (shared) return shared;
  }
  return DEFAULT_BENCHMARK_KEY;
}
