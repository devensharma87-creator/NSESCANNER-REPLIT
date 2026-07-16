# PRE/POST BRIEFING FEATURE — Build Plan + Owner Rulings

**Branch**: `feature/pre-post-briefing`
**Status**: Phase 0 scoped, execution pending Friday morning (freeze-compatible read-only work)
**Spec source**: `PRE_POST_BRIEFING_MASTER_PROMPT.md` (public artifact, session 2026-07-16)

## Owner rulings absorbed (2026-07-16 evening)

### Q1 · Phase 0 timing → EXECUTE THURSDAY EVENING (tonight, 2026-07-16 post 17:35 IST)
- All rows probed tonight EXCEPT row K.
- Row F/G (NSE bhavcopy): **plain fetch from current env only**, capture failure verbatim.
  NO proxies, NO header games, NO retry-from-elsewhere — failure IS the deliverable.
- Row K (NIFTY 500 rate-limit sweep): **post-15:30 Friday ONLY**, never during
  live session — shares Kite session with signal generation on acceptance day.
- Fallback if tonight isn't feasible: Friday **post-close** alongside row K — NOT Friday morning against the open. The forbidden state is an ambiguous "Friday morning" deadline that turns evidence-gathering into a crunch.
- Friday stays a two-deliverable day: 12:00 canary + evening acceptance query. Matrix already done by then.

### Q2 · Branch → `feature/pre-post-briefing`

### Q3 · Matrix ordering → POSITIVE-FIRST
- ACTIVE-set confirmation defines v1 scope (rows A/B/C/D/E/L).
- Gated confirmations (F/G/H/I/J/K) affect placeholder-card labels only.
- If time-boxed: complete positive pass + partial gated pass is still signable.

### Q4 · PRE-8 MANUAL notes → APPROVED, SAME PRIMITIVE AS POST-11 JOURNAL
- Morning notes + evening journal are ONE UX component (text field + save + ✍️ chip).
- Build once (Phase 2 or 4), mount twice.
- **Hard rule**: MANUAL text renders verbatim under ✍️ ONLY. Never blended into any
  computed line. PRE-10's bias rationale cites data sections exclusively — no circular
  confirmation of owner's morning bias back into evening report.

### DRIFT-P0 carve-out ruling → APPROVED IN PRINCIPLE
- **Phase 1 may apply the 3 briefing DDLs + same-day Drizzle declarations on the branch**
  WITHOUT waiting for drift reconciliation.
- **CONDITIONAL** on: pasted `drizzle-kit push` diff from the branch proving the 3 new
  tables produce ZERO additional pending changes beyond the already-inventoried 8 drift
  items.
- **Merge remains BLOCKED** under DRIFT-P0 until reconciliation lands. Carve-out covers
  DDL only, never merge.

## Anchor files discovered (Phase 0 codebase discovery, 2026-07-16 evening)

| Concern | File(s) — extend, do NOT replace |
|---|---|
| Existing pre/post Telegram reports | `dailyReports.ts` (primary) |
| Kite service & trusted-quote layer | `marketData/router.ts`, `scanner.ts` |
| Instrument master / expiry lookup | `marketData/instrumentResolver.ts`, `kiteOptionChain.ts` |
| Option chain snapshots | `optionChainSnapshotIngestor.ts`, `optionSnapshotAnalytics.ts` |
| Market calendar / holidays | via `optionSignals.ts` / `systemStatus.ts` — locate exact helper in Phase 0 |
| Telegram delivery infra | `alerting.ts`, `telegramBotCommands.ts` |
| Sector indices | verify Kite coverage in Phase 0 row L |

## Phase 0 execution plan (Friday morning, freeze-compatible)

For each matrix row, produce raw evidence:

| Row | Action | When |
|---|---|---|
| A/B/D/E/L | Sample pulls via existing marketData/router service (read-only) | Friday morning |
| C | Direct Kite quote `NSE:INDIA VIX` — sanity 8-35 range | Friday morning |
| F/G | Plain HTTP GET to NSE bhavcopy URLs from prod IP — capture exact failure | Friday morning |
| H | Confirm GIFT Nifty absence in Kite instrument master | Friday morning |
| I | Document current Yahoo provider state; note US-10Y unit-parsing defect (0.45 vs 4.5%) | Friday morning |
| J | Confirm no trusted news source exists | Friday morning |
| K | NIFTY 500 quote sweep for rate-limit feasibility | Post-15:30 Friday ONLY |
| **M** | **Existing `optionChainSnapshotIngestor.ts` discovery** — what it captures (full chain vs partial), its schedule (open/close-adjacent captures or ad hoc?), backing table (name + Drizzle-declared vs sits in the 8-item drift inventory). If it covers PRE-6/POST-5 needs, Phase 1's schema proposal shrinks from 3 new tables to 2 + an extension. If its backing table is one of the undeclared runtime tables, that's a drift-inventory cross-reference the reconciliation slice needs. | Tonight |

Deliver as `/app/memory/forensics/phase0_data_availability_matrix.md` with pasted raw
evidence per row. Then owner signs off v1 ACTIVE/PARTIAL/GATED classification.

## Full DoD (per spec §10) — not to be forgotten
1. Phase 0 matrix signed off; Phases 1-4 checkpointed with literal evidence
2. 3 consecutive trading days: pre-market by 09:00 IST + full wrap by 19:00 IST, zero fabricated fields
3. Every GATED section visibly labeled with unlock ticket
4. Level-validation loop demonstrated end-to-end
5. Full test suite green, typecheck exit 0, no regressions in existing Telegram reports
6. Owner has entered ≥1 journal note that renders in that evening's wrap
