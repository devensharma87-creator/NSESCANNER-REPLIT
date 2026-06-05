---
name: getEnvironmentLabel returns an object (React #31 trap)
description: The F&O diagnostics "environment" field is a structured object, not a string — rendering it raw crashes React.
---

`getEnvironmentLabel()` (api-server `lib/paperAutoTradeFlag.ts`) returns an
OBJECT `{ env: "production"|"development", autoTradingEnabled: boolean, reason: string }`,
NOT a plain string. It is attached to `/api/fno/data-health` and
`/api/fno/diagnostics/today` as the `environment` field, and also drives the
paper-trading EnvironmentBanner.

**Why this matters:** the `/fno-diagnostics` page once typed `environment` as
`string` and rendered `<span>{health.data.environment}</span>` directly →
Minified React error #31 ("Objects are not valid as a React child"), a full
page crash. It shipped to production because the diagnostics-fetch types are
"intentionally loose" and no component render test exercised the live shape.

**How to apply:**
- Never render `environment` (or any `/api/fno/*` field) as a raw child. Run it
  through `formatEnvLabel`/`formatDiagnosticValue` in
  `artifacts/scanner/src/lib/fno/diagnostics-format.ts`.
- When adding fields to these loosely-typed diagnostics responses, confirm the
  ACTUAL backend shape (object vs scalar) before binding it into JSX.
- A minified React #31 with a component stack ending in a `<span>`/`<p>` almost
  always means an object/array reached JSX as a child — find the raw `{value}`.
