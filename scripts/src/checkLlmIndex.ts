/**
 * LLM Index Staleness Checker
 *
 * Compares the current SHA-256 hashes of tracked source files against the
 * hashes stored in docs/llm-index/INDEX_MANIFEST.json.
 *
 * Exits 0 if fresh, exits 1 if stale (new/changed/deleted files detected).
 * Use in CI or as a git pre-commit hook to enforce index freshness.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts run index:llm:check
 */

import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const ROOT     = path.resolve(import.meta.dirname, "../..");
const MANIFEST = path.join(ROOT, "docs/llm-index/INDEX_MANIFEST.json");

interface ManifestEntry {
  hash:  string;
  lines: number;
  mtime: string;
}

interface IndexManifest {
  generatedAt:      string;
  generatorVersion: string;
  files: Record<string, ManifestEntry>;
}

function sha256(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/** Return how many minutes ago an ISO timestamp was. */
function minutesAgo(iso: string): number {
  return Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
}

async function main() {
  // ── Check manifest exists ──────────────────────────────────────────────────

  if (!fs.existsSync(MANIFEST)) {
    console.error("❌ INDEX_MANIFEST.json not found — run 'pnpm --filter @workspace/scripts run index:llm' first.");
    process.exit(1);
  }

  const manifest: IndexManifest = JSON.parse(fs.readFileSync(MANIFEST, "utf-8"));
  const genAgo = minutesAgo(manifest.generatedAt);
  console.log(`LLM Index Staleness Check`);
  console.log(`  Manifest generated: ${manifest.generatedAt} (${genAgo} min ago)`);
  console.log(`  Tracked files: ${Object.keys(manifest.files).length}`);

  // ── Compare each tracked file ──────────────────────────────────────────────

  const changed:  string[] = [];
  const deleted:  string[] = [];
  const newFiles: string[] = [];

  for (const [relPath, entry] of Object.entries(manifest.files)) {
    const absPath = path.join(ROOT, relPath);
    if (!fs.existsSync(absPath)) {
      deleted.push(relPath);
      continue;
    }
    const content = fs.readFileSync(absPath, "utf-8");
    const currentHash = sha256(content);
    if (currentHash !== entry.hash) {
      changed.push(relPath);
    }
  }

  // Detect newly-tracked files (not in manifest but exist in standard locations).
  // This is a best-effort scan — the generator rebuilds the full list.
  const trackedDirs = [
    "artifacts/api-server/src/routes",
    "artifacts/api-server/src/lib",
    "lib/db/src/schema",
    "artifacts/scanner/src/pages",
    "artifacts/scanner/src/lib",
    "scripts/src",
  ];

  function walkFlat(dir: string): string[] {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return [];
    return fs.readdirSync(abs, { withFileTypes: true })
      .filter(e => e.isFile() && /\.(ts|tsx)$/.test(e.name) && !e.name.includes(".test.") && !e.name.includes(".spec."))
      .map(e => path.join(dir, e.name));
  }

  for (const dir of trackedDirs) {
    for (const relPath of walkFlat(dir)) {
      if (!(relPath in manifest.files)) {
        newFiles.push(relPath);
      }
    }
  }

  // ── Report ─────────────────────────────────────────────────────────────────

  const stale = changed.length > 0 || deleted.length > 0 || newFiles.length > 0;

  if (changed.length > 0) {
    console.log(`\n⚠  Changed files (${changed.length}):`);
    for (const f of changed.slice(0, 20)) console.log(`    ~ ${f}`);
    if (changed.length > 20) console.log(`    … and ${changed.length - 20} more`);
  }

  if (deleted.length > 0) {
    console.log(`\n⚠  Deleted files tracked in manifest (${deleted.length}):`);
    for (const f of deleted) console.log(`    - ${f}`);
  }

  if (newFiles.length > 0) {
    console.log(`\n⚠  New untracked files (${newFiles.length}):`);
    for (const f of newFiles.slice(0, 20)) console.log(`    + ${f}`);
    if (newFiles.length > 20) console.log(`    … and ${newFiles.length - 20} more`);
  }

  if (stale) {
    console.log(`\n❌ LLM index is stale. Run:`);
    console.log(`   pnpm --filter @workspace/scripts run index:llm`);
    console.log(`   Then add an entry to docs/llm-index/CHANGELOG_FOR_AGENTS.md`);
    process.exit(1);
  } else {
    console.log(`\n✓ LLM index is fresh — all ${Object.keys(manifest.files).length} tracked files match.`);
    process.exit(0);
  }
}

main().catch(err => {
  console.error("checkLlmIndex failed:", err);
  process.exit(1);
});
