---
name: Kite instrument_token is a string at runtime
description: Kite CSV parser returns instrument_token as a string despite TypeScript types and OpenAPI spec saying number; coerce at both source and route level.
---

**Rule:** `FnoInstrument.instrument_token` (and similar Kite CSV fields) is a JS string at runtime even though the TypeScript type annotation and OpenAPI spec say `integer`/`number`. A plain `===` comparison or Zod `zod.number()` parse will fail silently or throw.

**Why:** Kite's instruments CSV is parsed without explicit numeric coercion. TypeScript does not enforce runtime types; the annotation is wrong at runtime.

**How to apply:**
1. At the **source** (`contractMasterFact.ts` exact-match branch): `Number(exactRow.instrument_token)` before assigning to `ContractMasterFact.instrumentToken`.
2. At the **route level** (scanner.ts `/options/signals`): normalize `signals.map(s => ({ ...s, leg: { ...s.leg, contractInstrumentToken: s.leg.contractInstrumentToken != null ? Number(s.leg.contractInstrumentToken) : s.leg.contractInstrumentToken } }))` BEFORE `GetOptionSignalsResponse.parse()` — disk-cached signals bypass the source-level fix.
3. Do NOT change the OpenAPI spec type to `string` — the DB column is `integer` and `paperTradingFO.ts` writes it as a number.
