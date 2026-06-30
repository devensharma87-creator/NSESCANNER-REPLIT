#!/usr/bin/env bash
# Install LLM index staleness check as a git pre-commit hook.
# Run once from repo root: bash scripts/install-git-hooks.sh

set -euo pipefail

HOOK_DIR="$(git rev-parse --git-dir)/hooks"
HOOK_FILE="${HOOK_DIR}/pre-commit"

cat > "${HOOK_FILE}" << 'EOF'
#!/usr/bin/env bash
# pre-commit: warn if tracked source files changed but LLM index was not regenerated.
# Non-blocking (exits 0 even when stale) — prevents accidental commit blockage.

if pnpm --filter @workspace/scripts run index:llm:check --silent 2>/dev/null; then
  exit 0
fi

echo ""
echo "⚠  LLM index may be stale — source files changed since last 'index:llm' run."
echo "   Run: pnpm --filter @workspace/scripts run index:llm"
echo "   Then: add an entry to docs/llm-index/CHANGELOG_FOR_AGENTS.md"
echo "   (Commit proceeds — this is a warning, not a block.)"
echo ""
exit 0
EOF

chmod +x "${HOOK_FILE}"
echo "✓ Pre-commit hook installed at ${HOOK_FILE}"
echo "  The hook warns (does not block) when the LLM index appears stale."
