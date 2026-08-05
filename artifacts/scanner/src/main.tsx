import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { BUILD_MARKERS } from "./lib/buildMarkers";

// Attach build markers to window for runtime inspection and bundle searchability.
// These compile-time string constants confirm which governance features are
// compiled into this frontend bundle.  Vite embeds them as string literals —
// the verify:release script greps the bundle for their presence.
// No secrets, no trading logic, no side-effects on app behaviour.
(window as unknown as Record<string, unknown>)["__buildMarkers__"] = BUILD_MARKERS;

// DEV-only fixture interceptor — zero cost in production:
// Vite replaces import.meta.env.DEV with `false` in production builds, making
// this entire block dead code that is tree-shaken away. The fixture module is
// never included in the production bundle.
if (import.meta.env.DEV && import.meta.env.VITE_PREVIEW_BYPASS === "true") {
  const { installScannerFixtures } = await import("./mocks/fetchInterceptor");
  installScannerFixtures();
}

createRoot(document.getElementById("root")!).render(<App />);
