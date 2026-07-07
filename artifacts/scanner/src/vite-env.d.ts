/// <reference types="vite/client" />

/**
 * Vite `define` constants injected at build time (vite.config.ts).
 * In dev these globals remain undefined — buildMarkers.ts reads them
 * via globalThis with a fallback.
 */
declare const __APP_BUILD_ID__: string | undefined;
declare const __FRONTEND_BUILD_TIME__: string | undefined;
