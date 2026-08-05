import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// DEV-only fixture interceptor — zero cost in production:
// Vite replaces import.meta.env.DEV with `false` in production builds, making
// this entire block dead code that is tree-shaken away. The fixture module is
// never included in the production bundle.
if (import.meta.env.DEV && import.meta.env.VITE_PREVIEW_BYPASS === "true") {
  const { installGlobalFixtures } = await import("./mocks/fetchInterceptor");
  installGlobalFixtures();
}

createRoot(document.getElementById("root")!).render(<App />);
