# Combo Paper Trader — Design Note (Tier C, awaiting approval)

**Status:** Design only. No DB tables, routes, or UI shipped. This document
captures the intent and the trade-offs so the user can approve (or reject) the
shape before any code lands. Aligns with the user-approved phased plan: Tier A
(Unusual OI Buildup) ✅, Tier B (Strategy Builder) ✅, Tier C (Combo Paper
Trader) — **pending sign-off**.

---

## What it is

A separate paper-trading lane for **multi-leg option strategies as a single
position**. Today's `paper_trade_fo` is one row per option leg — perfectly
fine for naked CE/PE entries from the F&O signal pipeline, but wrong shape for
spreads, iron condors, straddles, etc., where the legs must open / close /
stop together and the P&L is a single combo number.

The user already has the math (the new `buildCustomStrategy` server helper
returns the snapshot that an entry would consume). The Combo Paper Trader
would persist that snapshot at entry time and re-mark it tick-by-tick.

---

## Why a new lane (and not "just store multiple `paper_trade_fo` rows")

1. **Atomic open / close.** A spread isn't a spread if one leg fills and the
   other doesn't. Per-leg rows force the UI to invent a "combo group id" and
   reconcile partial closes — the exact mess Combo Paper Trader exists to
   avoid.
2. **Combo-level P&L is the only P&L the user cares about.** Net debit /
   credit, max profit, max loss, and breakevens are all defined for the
   combo, not the legs. Storing them per-leg makes the dashboard math
   second-guess itself.
3. **Safety guardrails are different.** The existing F&O paper-trader gates
   (heat cap, daily DD, vol-clamped stop, etc., listed in the architecture
   doc) are calibrated for **single-leg directional exposure**. Combos are
   defined-risk by construction; gating them with the same constants would
   either over-block (rejecting iron condors because each leg looks like a
   naked sell) or silently leak into the FNO heat budget. Separation keeps
   each lane's guardrails honest.
4. **No collision with the auto-trader.** `runFnoPaperTradingTick` should
   never see combo legs in `paper_trade_fo`. A separate table is the simplest
   way to guarantee that — the alternative (a `combo_group_id` discriminator
   column with `WHERE combo_group_id IS NULL` everywhere in the existing code
   path) is a refactoring risk we don't want to take on.

## What it is NOT

- **Not** a new auto-trader. Combo Paper Trader is **manual entry only** —
  the user explicitly clicks "Open this combo" from the Strategy Builder. No
  signal pipeline auto-opens combos.
- **Not** an order-routing surface. Same fiction as the rest of the paper
  account: virtual fills at the chain mid (or a configurable slippage), no
  broker handshake.
- **Not** a replacement for `paper_trade_fo`. Single-leg signal trades
  continue to live in `paper_trade_fo`; combos live in `paper_trade_combo`.

---

## Schema (DB)

> **Checkpoint required before applying.** New tables touch the live paper
> account schema. Per `replit.md` guardrail: "no major DB tables without
> checkpoint."

```ts
// lib/db/src/schema/paperTradeCombo.ts (new file)
export const paperTradeCombo = pgTable("paper_trade_combo", {
  id:             serial("id").primaryKey(),
  userId:         text("user_id").notNull(),
  underlying:     text("underlying").notNull(),
  expiry:         date("expiry").notNull(),
  strategyName:   text("strategy_name"),     // optional human label, e.g. "BULL_CALL_SPREAD" or "Custom"
  status:         text("status").notNull(),  // OPEN | CLOSED | EXPIRED
  openedAt:       timestamp("opened_at", { withTimezone: true }).notNull(),
  closedAt:       timestamp("closed_at", { withTimezone: true }),
  closeReason:    text("close_reason"),      // MANUAL | EXPIRY | FORCE_1520

  // ── Snapshot at entry (frozen for audit) ────────────────────────────
  spotAtEntry:    numeric("spot_at_entry").notNull(),
  netDebitEntry:  numeric("net_debit_entry").notNull(),  // ₹/share, signed (positive=debit)
  maxProfitEntry: numeric("max_profit_entry"),           // null = unbounded
  maxLossEntry:   numeric("max_loss_entry"),             // null = unbounded
  breakevensEntry: jsonb("breakevens_entry").notNull(),  // number[]
  netGreeksEntry: jsonb("net_greeks_entry").notNull(),   // {delta,gamma,vega,theta}
  marginRequired: numeric("margin_required").notNull(),
  lotSize:        integer("lot_size").notNull(),

  // ── Live MTM (refreshed by tick + on read) ──────────────────────────
  spotLast:       numeric("spot_last"),
  netMtm:         numeric("net_mtm"),                    // current mark, signed
  realizedPnl:    numeric("realized_pnl"),               // populated on CLOSED

  // ── Audit ───────────────────────────────────────────────────────────
  notes:          text("notes"),                         // user-entered
  buildSnapshot:  jsonb("build_snapshot").notNull(),     // full CustomStrategyResponse at entry
});

export const paperTradeComboLeg = pgTable("paper_trade_combo_leg", {
  id:             serial("id").primaryKey(),
  comboId:        integer("combo_id").notNull().references(() => paperTradeCombo.id, { onDelete: "cascade" }),
  action:         text("action").notNull(),    // BUY | SELL
  optionType:     text("option_type").notNull(), // CE | PE
  strike:         numeric("strike").notNull(),
  qty:            integer("qty").notNull(),    // total shares (lots × lotSize)
  entryPremium:   numeric("entry_premium").notNull(),
  ivAtEntry:      numeric("iv_at_entry"),
  lastPremium:    numeric("last_premium"),
  premiumSource:  text("premium_source"),      // chain | bs | ws
});
```

Indexes: `(userId, status)`, `(comboId)` on legs.

## Tamper-resistance (added per code-review)

> The builder snapshot is an *advisory* payload computed from the live chain.
> It must never be trusted as the source-of-record at open time, because the
> client could mutate `entryPremium`, `maxLoss`, `marginRequired`, etc.
> before POSTing.

Two acceptable patterns; pick one before Phase 1 lands:

1. **Server reprice (preferred).** `POST /paper/positions/combo` accepts
   only `{ underlying, expiry, legs: CustomLegSpec[] }` (the same shape the
   builder route accepts). The server then re-runs `buildCustomStrategy`
   against the **live** chain at open time and persists *that* result. Any
   client-supplied premium/Greek/margin field is ignored. This is the
   simplest tamper-proof shape and reuses the existing builder math
   verbatim.
2. **Signed snapshot id.** Builder route returns a short-lived signed
   snapshot id (HMAC over the canonical JSON, 60s TTL); open route accepts
   only the id and re-fetches the cached snapshot server-side. More moving
   parts; only worth it if we want "open at the price you saw" semantics.

Defaulting to **(1)** in this design. The "Open as combo" button on the
Strategy Builder will simply forward the legs and let the server compute
fills against fresh data.

## Routes (api-server)

```
POST  /paper/positions/combo                Open combo from a CustomStrategyResponse
GET   /paper/positions/combo                List user's combos (status filter)
GET   /paper/positions/combo/:id            Detail (with fresh MTM)
POST  /paper/positions/combo/:id/close      Close at current MTM (manual)
GET   /paper/positions/combo/:id/payoff     Refreshed payoff curve at current spot
```

OpenAPI-first: spec the request/response schemas in `lib/api-spec/openapi.yaml`,
let codegen produce hooks + zod schemas. Reuse `CustomStrategyResponse` shape
for the open request body.

## MTM priority (matches existing F&O paper-trader convention)

For each leg's `lastPremium`:
1. **Kite WebSocket** if a tick is available (sub-second).
2. **Live chain mid** from `fetchOptionChain()` (≤30s old).
3. **Black-Scholes** from `buildPayoff` helpers using current spot + frozen IV
   (only if 1 + 2 both fail — same fail-OPEN philosophy as the rest of the
   paper-trader).

Net MTM = Σ (action_sign × (lastPremium − entryPremium) × qty), where
`action_sign = +1 for BUY, −1 for SELL`. This is the exact formula the
existing `closePaperTrade` helper uses per-leg, so we can reuse it.

## Close / realized P&L flow

- **Manual close**: refresh chain → snapshot `lastPremium` per leg → set
  `realizedPnl = netMtm`, `closedAt = now()`, `closeReason = "MANUAL"`,
  `status = "CLOSED"`. Single transaction.
- **Expiry roll**: cron at 15:25 IST on expiry day; for each OPEN combo with
  `expiry = today`, mark each leg's `lastPremium` to terminal-payoff value
  (`max(0, S - K)` for CE, `max(0, K - S)` for PE) and close with
  `closeReason = "EXPIRY"`. Avoids stale-quote issues post-expiry.
- **15:20 IST force-exit**: combos opt **out** of the existing
  `forceCloseAllOpenFnoFor1520` sweep. Combos are defined-risk; intraday
  forced exits would defeat the whole point of structuring a spread.
- **No auto stop-loss.** First version. The user explicitly closes. Future
  iteration may add a per-combo stop tied to net MTM, but only after the
  surface has been used live for a few weeks.

## Safety guardrails (Combo lane)

| Gate | Constant | Effect |
|---|---|---|
| Combo leg liquidity | Reuse `FNO_LIQUIDITY` per leg | Reject open if any leg fails |
| Net debit cap | New `COMBO_MAX_NET_DEBIT_PCT = 0.05` of equity | Reject open above 5% |
| Combo count cap | `COMBO_MAX_OPEN = 5` | Reject above 5 simultaneous open combos |
| Defined-risk only (v1) | `maxLoss != null` | Reject undefined-loss combos (naked shorts, ratios > 1) |

Combos do **not** count against the existing `MAX_FNO_HEAT_PCT` budget — they
have their own cap. This is the whole point of the separate lane.

## Analytics surface

- New `/paper-reports` section: "Combo Trades" — closed combos with realized
  P&L, holding period, max-loss-vs-realized ratio, IV-context breakdown.
- Equity curve already aggregates from `paper_account_realized_pnl` deltas;
  add a `kind = "combo"` discriminator so the curve can stack combo P&L.

## Confusion risks (and how we mitigate)

1. **"Why is my F&O P&L different from my Combo P&L?"** — Two separate cards
   on `/paper-trading` with explicit headings ("F&O Single-Leg Signals" vs.
   "Manual Combos"). Same color tokens, different titles + hover-help.
2. **"I can't see my combo on the F&O dashboard."** — Combos render in the
   Combo card only. Cross-link from the Strategy Builder ("Open as combo →"
   button after a successful build) so the user knows where it went.
3. **Auto-trader leakage** — `runFnoPaperTradingTick` queries `paper_trade_fo`,
   never `paper_trade_combo`. Schema separation makes leakage impossible.
4. **OpenAPI codegen drift** — request body reuses the existing
   `CustomStrategyResponse` shape; no parallel Combo type to keep in sync.

## Phasing

- **Phase 1** (≈1 day): schema + open/list/close routes + minimal UI card on
  `/paper-trading`.
- **Phase 2** (≈half day): MTM tick (piggybacks on existing 30s F&O sweep,
  separate query against `paper_trade_combo`) + payoff refresh.
- **Phase 3** (≈half day): analytics on `/paper-reports`, equity-curve
  integration, expiry-day cron.

## Out of scope (explicit)

- Auto-opening combos from a signal pipeline.
- Greeks-based stop-loss (deferred to v2).
- Calendar / diagonal spreads across multiple expiries (single-expiry only
  for v1).
- Margin-benefit modelling (NSE SPAN). v1 uses the simple per-leg margin sum
  from `estimateMargin`.

---

## Sign-off needed before code

- [ ] User OK with the new tables (`paper_trade_combo`, `paper_trade_combo_leg`)?
- [ ] User OK with combo lane being **manual entry only** for v1?
- [ ] User OK with combos opting out of 15:20 force-exit?
- [ ] User OK with phased rollout (Phase 1 first, ship & measure before Phase 2/3)?

If yes to all four, schema + Phase 1 routes can land in a single follow-up
task with a checkpoint right before `drizzle-kit push`.
