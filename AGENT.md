# Agent Instructions

**MANDATORY FIRST STEP:** Before doing ANY work on this repository, read:

```
docs/llm-index/AGENT_START_HERE.md
```

Then read only the specific index file for your task type:
- APIs / routes → `docs/llm-index/API_ROUTES_INDEX.md`
- Database / schema → `docs/llm-index/DATABASE_INDEX.md`
- Data sources / provenance → `docs/llm-index/DATA_SOURCES_AND_PROVENANCE.md`
- Signal flows / architecture → `docs/llm-index/CRITICAL_FLOWS.md`
- Tests / verification → `docs/llm-index/TEST_AND_VERIFICATION_INDEX.md`
- File discovery → `docs/llm-index/PROJECT_MAP.md`

## After Every Code Change

```bash
# 1. Run relevant tests
pnpm --filter @workspace/api-server run test
pnpm --filter @workspace/scanner run test

# 2. Regenerate the index
pnpm --filter @workspace/scripts run index:llm

# 3. Verify index is fresh
pnpm --filter @workspace/scripts run index:llm:check

# 4. Append to CHANGELOG_FOR_AGENTS.md
```

## Stale Index Check

```bash
pnpm --filter @workspace/scripts run index:llm:check
```

Exits non-zero if any source file changed since last index generation.

## Key Rules (never break these)

1. Kite is the ONLY trusted source for live price-sensitive data
2. `Risk eval: kite` label in swing alerts must NOT revert to `Data: kite`
3. `LIVE_CASH_SWING_ORDER_ENABLED` must remain false unless explicitly enabled
4. Never fabricate market data — label honestly or omit
5. Do not trim or reorganize `replit.md` (owner directive)
