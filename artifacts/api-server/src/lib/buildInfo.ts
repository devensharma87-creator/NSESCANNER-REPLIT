/**
 * buildInfo — safe, public-facing build identity surface.
 *
 * Captures build-time constants injected by esbuild `define` (see build.mjs)
 * and runtime facts (boot time, environment).
 *
 * SAFETY CONTRACT:
 *   - No secrets, tokens, passwords, or private env vars are returned.
 *   - All unknown values return "unknown" — never omitted.
 *   - Checkpoint markers are hardcoded compile-time booleans (never from DB).
 *   - No trading logic, signals, broker, or Telegram side-effects.
 */

/** Captured once at module-load time = the process boot time. */
const BOOT_TIME_ISO = new Date().toISOString();

/** Safely reads an esbuild-injected constant. Returns "unknown" if not replaced. */
function readDefine(access: () => unknown): string {
  try {
    const v = access();
    return typeof v === "string" && v.length > 0 ? v : "unknown";
  } catch {
    return "unknown";
  }
}

const COMMIT_SHA    = readDefine(() => __COMMIT_SHA__);
const COMMIT_SHORT  = readDefine(() => __COMMIT_SHORT__);
const GIT_BRANCH    = readDefine(() => __GIT_BRANCH__);
const BUILD_TIME    = readDefine(() => __BUILD_TIME__);
const FRONTEND_BUILD_ID = readDefine(() => __FRONTEND_BUILD_ID__);

export interface CheckpointMarkers {
  checkpoint1: boolean;
  checkpoint2: boolean;
  checkpoint2_5: boolean;
  checkpoint3: boolean;
  dataParityApi: boolean;
  reportGradeFacade: boolean;
  providerImportCompat: boolean;
}

export interface BuildInfo {
  app: string;
  environment: string;
  commitSha: string;
  commitShort: string;
  branch: string;
  buildTime: string;
  bootTime: string;
  deploymentId: string;
  apiBuildId: string;
  frontendBuildId: string;
  frontendBundleFile: string;
  frontendBundleHash: string;
  nodeEnv: string;
  checkpointMarkers: CheckpointMarkers;
}

function safeEnv(key: string): string {
  const v = process.env[key];
  return typeof v === "string" && v.length > 0 ? v : "unknown";
}

export function getBuildInfo(): BuildInfo {
  const nodeEnv = safeEnv("NODE_ENV");
  const replitDeployment = process.env["REPLIT_DEPLOYMENT"] ?? "";
  const environment =
    replitDeployment === "1" || nodeEnv === "production" ? "production" : "development";

  const deploymentId = safeEnv("REPLIT_DEPLOYMENT_ID");

  const apiBuildId =
    COMMIT_SHORT !== "unknown"
      ? `api-${COMMIT_SHORT}-${BUILD_TIME.slice(0, 10)}`
      : "unknown";

  const frontendBundleFile = safeEnv("FRONTEND_BUNDLE_FILE");
  const frontendBundleHash =
    frontendBundleFile !== "unknown"
      ? (frontendBundleFile.match(/index-([^.]+)\.js$/)?.[1] ?? "unknown")
      : "unknown";

  return {
    app: "marketscanner",
    environment,
    commitSha: COMMIT_SHA,
    commitShort: COMMIT_SHORT,
    branch: GIT_BRANCH,
    buildTime: BUILD_TIME,
    bootTime: BOOT_TIME_ISO,
    deploymentId,
    apiBuildId,
    frontendBuildId: FRONTEND_BUILD_ID,
    frontendBundleFile,
    frontendBundleHash,
    nodeEnv,
    checkpointMarkers: {
      checkpoint1: true,
      checkpoint2: true,
      checkpoint2_5: true,
      checkpoint3: true,
      dataParityApi: true,
      reportGradeFacade: true,
      providerImportCompat: true,
    },
  };
}
