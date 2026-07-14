/**
 * Type declarations for esbuild `define` constants injected at build time.
 *
 * esbuild replaces these identifiers with string literals during `node build.mjs`.
 * In dev/test (no esbuild pass) they are unresolved globals — buildInfo.ts accesses
 * them inside IIFE try-catch blocks so a ReferenceError just returns "unknown".
 *
 * Do NOT read these from process.env — they are static build-time bakes only.
 * No secrets, tokens, or passwords are included.
 */
declare const __COMMIT_SHA__: string;
declare const __COMMIT_SHORT__: string;
declare const __GIT_BRANCH__: string;
declare const __BUILD_TIME__: string;
declare const __FRONTEND_BUILD_ID__: string;
