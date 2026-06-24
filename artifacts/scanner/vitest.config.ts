/**
 * WHY vmThreads + forceExit:
 *   Default `forks` pool spawns one child process per test file.  With 34
 *   test files and a 2-CPU Replit workspace running 4 other services, process
 *   spawn overhead exceeds the 120 s bash window before a single test runs.
 *
 *   `vmThreads` uses worker threads with per-thread vm context (isolates
 *   globals for jsdom correctness).  Thread startup costs nanoseconds vs
 *   milliseconds for fork().  34 files complete in ~11 s vs never.
 *
 *   `forceExit: true` terminates any stray React Query / timer handles after
 *   all tests pass, so the process exits cleanly without a 30 s drain wait.
 */
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    pool: "vmThreads",
    forceExit: true,
    environment: "jsdom",
    environmentOptions: {
      jsdom: { url: "http://localhost/" },
    },
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
