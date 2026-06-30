/**
 * LLM Index Generator
 *
 * Scans the repo and emits two artefacts into docs/llm-index/:
 *   FILE_SUMMARIES.json  — per-file metadata (lines, exports, imports, purpose)
 *   INDEX_MANIFEST.json  — hashes + timestamps of all indexed source files
 *                          (used by checkLlmIndex.ts to detect staleness)
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run index:llm
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// ── Config ────────────────────────────────────────────────────────────────────

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT_DIR = path.join(ROOT, "docs/llm-index");

/** Files/dirs to track in INDEX_MANIFEST (staleness detection). */
const TRACKED_GLOBS: { dir: string; exts: string[]; maxDepth: number }[] = [
  { dir: "artifacts/api-server/src/routes", exts: [".ts"], maxDepth: 2 },
  { dir: "artifacts/api-server/src/lib",   exts: [".ts"], maxDepth: 1 },
  { dir: "lib/db/src/schema",              exts: [".ts"], maxDepth: 1 },
  { dir: "lib/api-spec",                   exts: [".yaml", ".yml"], maxDepth: 1 },
  { dir: "artifacts/scanner/src/pages",    exts: [".tsx"], maxDepth: 1 },
  { dir: "artifacts/scanner/src/lib",      exts: [".ts", ".tsx"], maxDepth: 2 },
  { dir: "scripts/src",                    exts: [".ts"], maxDepth: 1 },
];

/** Files that are always tracked regardless of ext. */
const ALWAYS_TRACK = [
  "lib/api-spec/openapi.yaml",
  "pnpm-workspace.yaml",
];

/** Source files to include in FILE_SUMMARIES. */
const SUMMARY_DIRS: string[] = [
  "artifacts/api-server/src/routes",
  "artifacts/api-server/src/lib",
  "lib/db/src/schema",
  "artifacts/scanner/src/pages",
  "artifacts/scanner/src/lib",
  "scripts/src",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function walkDir(dir: string, exts: string[], maxDepth: number, depth = 0): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  const entries = fs.readdirSync(abs, { withFileTypes: true });
  const results: string[] = [];
  for (const e of entries) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory() && depth < maxDepth) {
      results.push(...walkDir(rel, exts, maxDepth, depth + 1));
    } else if (e.isFile() && exts.some(ext => e.name.endsWith(ext))) {
      results.push(rel);
    }
  }
  return results.sort();
}

function countLines(content: string): number {
  return content.split("\n").length;
}

function extractExports(content: string): string[] {
  const matches = content.matchAll(/^export\s+(?:(?:async\s+)?function|const|class|interface|type|enum)\s+(\w+)/gm);
  return [...new Set([...matches].map(m => m[1]!))].slice(0, 20);
}

function extractImports(content: string): string[] {
  const matches = content.matchAll(/^import\s+.*?\bfrom\s+["']([^"']+)["']/gm);
  return [...new Set([...matches].map(m => m[1]!))].filter(i => !i.startsWith(".")).slice(0, 10);
}

function extractRoutes(content: string): string[] {
  const matches = content.matchAll(/router\.(get|post|put|delete|patch)\(\s*["'`]([^"'`]+)["'`]/g);
  return [...matches].map(m => `${m[1]!.toUpperCase()} ${m[2]!}`).slice(0, 20);
}

function classifyPurpose(filePath: string, content: string): string {
  const name = path.basename(filePath, path.extname(filePath)).toLowerCase();
  if (filePath.includes("/routes/"))      return "api-route";
  if (filePath.includes("/schema/"))      return "db-schema";
  if (filePath.includes("/pages/"))       return "ui-page";
  if (name.includes("test"))              return "test";
  if (name.includes("alert"))            return "alerting";
  if (name.includes("paper"))            return "paper-trading";
  if (name.includes("swing"))            return "swing-engine";
  if (name.includes("fno") || name.includes("option")) return "fno-engine";
  if (name.includes("kite"))             return "data-source";
  if (name.includes("yahoo"))            return "data-source";
  if (name.includes("market"))           return "market-data";
  if (name.includes("scanner"))          return "scanner";
  if (name.includes("scoring") || name.includes("indicator")) return "scoring";
  if (name.includes("auth"))             return "auth";
  if (content.includes("router.get") || content.includes("router.post")) return "api-route";
  return "lib";
}

// ── Main ──────────────────────────────────────────────────────────────────────

interface FileSummary {
  path: string;
  purpose: string;
  lines: number;
  exports: string[];
  externalImports: string[];
  routes: string[];
  hash: string;
}

interface IndexManifest {
  generatedAt: string;
  generatorVersion: string;
  files: Record<string, { hash: string; lines: number; mtime: string }>;
}

async function main() {
  console.log("LLM Index Generator starting…");

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ── Collect all tracked files ──────────────────────────────────────────────

  const trackedPaths = new Set<string>();

  for (const { dir, exts, maxDepth } of TRACKED_GLOBS) {
    for (const f of walkDir(dir, exts, maxDepth)) {
      // Skip test files from manifest (they change constantly)
      if (!f.includes(".test.") && !f.includes(".spec.")) {
        trackedPaths.add(f);
      }
    }
  }

  for (const f of ALWAYS_TRACK) {
    if (fs.existsSync(path.join(ROOT, f))) trackedPaths.add(f);
  }

  console.log(`  Tracking ${trackedPaths.size} source files for staleness detection`);

  // ── Build INDEX_MANIFEST ───────────────────────────────────────────────────

  const manifestFiles: IndexManifest["files"] = {};

  for (const relPath of trackedPaths) {
    const absPath = path.join(ROOT, relPath);
    if (!fs.existsSync(absPath)) continue;
    const content = fs.readFileSync(absPath, "utf-8");
    const stat = fs.statSync(absPath);
    manifestFiles[relPath] = {
      hash:  sha256(content),
      lines: countLines(content),
      mtime: stat.mtime.toISOString(),
    };
  }

  const manifest: IndexManifest = {
    generatedAt:      new Date().toISOString(),
    generatorVersion: "1.0.0",
    files:            manifestFiles,
  };

  const manifestPath = path.join(OUT_DIR, "INDEX_MANIFEST.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`  ✓ INDEX_MANIFEST.json (${Object.keys(manifestFiles).length} files tracked)`);

  // ── Build FILE_SUMMARIES ───────────────────────────────────────────────────

  const summaries: FileSummary[] = [];

  for (const dir of SUMMARY_DIRS) {
    const files = walkDir(dir, [".ts", ".tsx"], 2);
    for (const relPath of files) {
      const absPath = path.join(ROOT, relPath);
      if (!fs.existsSync(absPath)) continue;
      const content = fs.readFileSync(absPath, "utf-8");
      summaries.push({
        path:            relPath,
        purpose:         classifyPurpose(relPath, content),
        lines:           countLines(content),
        exports:         extractExports(content),
        externalImports: extractImports(content),
        routes:          extractRoutes(content),
        hash:            sha256(content),
      });
    }
  }

  summaries.sort((a, b) => a.path.localeCompare(b.path));

  const summariesPath = path.join(OUT_DIR, "FILE_SUMMARIES.json");
  fs.writeFileSync(summariesPath, JSON.stringify(summaries, null, 2) + "\n");
  console.log(`  ✓ FILE_SUMMARIES.json (${summaries.length} files summarized)`);

  // ── Summary stats ──────────────────────────────────────────────────────────

  const byPurpose = summaries.reduce<Record<string, number>>((acc, s) => {
    acc[s.purpose] = (acc[s.purpose] ?? 0) + 1;
    return acc;
  }, {});

  console.log("\nFile breakdown by purpose:");
  for (const [purpose, count] of Object.entries(byPurpose).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${purpose}: ${count}`);
  }
  console.log(`\nLLM index updated at ${manifest.generatedAt}`);
  console.log("Done. Run 'index:llm:check' to verify staleness.");
}

main().catch(err => {
  console.error("generateLlmIndex failed:", err);
  process.exit(1);
});
