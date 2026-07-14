/**
 * Secrets Vault — owner-only intake for API credentials.
 *
 * The owner pastes secrets (Kite, Telegram) in the UI instead of sharing them
 * in chat. Values are written to the server-local env file (git-ignored,
 * chmod 600) and NEVER echoed back — status responses expose only a masked
 * tail. After a successful write the process exits cleanly so the supervisor
 * restarts it with the new environment.
 *
 * Gated by `requireOwnerStrict`: no public-mode read bypass, ever.
 */
import { Router, type IRouter } from "express";
import fs from "fs";
import { requireOwnerStrict } from "../lib/userAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();
router.use("/secrets-vault", requireOwnerStrict);

const ENV_FILE = process.env["ENV_FILE_PATH"] ?? "/app/backend/.env";

const ALLOWED_KEYS: ReadonlyArray<{ key: string; label: string; group: string; hint: string }> = [
  { key: "KITE_API_KEY", label: "Kite API Key", group: "Zerodha Kite Connect", hint: "From developers.kite.trade app" },
  { key: "KITE_API_SECRET", label: "Kite API Secret", group: "Zerodha Kite Connect", hint: "From developers.kite.trade app" },
  { key: "TELEGRAM_BOT_TOKEN", label: "Telegram Bot Token", group: "Telegram (signals & urgent alerts)", hint: "From @BotFather" },
  { key: "TELEGRAM_CHAT_ID", label: "Telegram Chat ID", group: "Telegram (signals & urgent alerts)", hint: "Numeric chat/channel id" },
  { key: "PREPOST_TELEGRAM_BOT_TOKEN", label: "Pre/Post Bot Token", group: "Telegram (daily reports bot)", hint: "Dedicated daily-report bot (optional)" },
  { key: "PREPOST_TELEGRAM_CHAT_ID", label: "Pre/Post Chat ID", group: "Telegram (daily reports bot)", hint: "Chat id for daily reports (optional)" },
];
const ALLOWED_SET = new Set(ALLOWED_KEYS.map((k) => k.key));

function mask(value: string): string {
  if (value.length <= 7) return "••••";
  return `••••${value.slice(-4)}`;
}

function readEnvFile(): Map<string, string> {
  const map = new Map<string, string>();
  let raw = "";
  try {
    raw = fs.readFileSync(ENV_FILE, "utf8");
  } catch {
    return map;
  }
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && m[1] && m[2] !== undefined) map.set(m[1], m[2].replace(/^"(.*)"$/, "$1"));
  }
  return map;
}

function writeEnvKeys(updates: Map<string, string | null>): void {
  let raw = "";
  try {
    raw = fs.readFileSync(ENV_FILE, "utf8");
  } catch {
    raw = "";
  }
  const lines = raw.split("\n");
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const m = line.match(/^([A-Z0-9_]+)=/);
    const key = m?.[1];
    if (key && updates.has(key)) {
      seen.add(key);
      const v = updates.get(key);
      if (v !== null && v !== undefined) out.push(`${key}=${v}`);
      // null → drop the line (clear key)
    } else {
      out.push(line);
    }
  }
  for (const [key, v] of updates) {
    if (!seen.has(key) && v !== null) {
      if (out.length && out[out.length - 1] === "") out.pop();
      out.push(`${key}=${v}`);
    }
  }
  let text = out.join("\n");
  if (!text.endsWith("\n")) text += "\n";
  fs.writeFileSync(ENV_FILE, text, { mode: 0o600 });
  try {
    fs.chmodSync(ENV_FILE, 0o600);
  } catch {
    /* best-effort on non-posix */
  }
}

/** GET /secrets-vault/status — masked status only, never values. */
router.get("/secrets-vault/status", (_req, res) => {
  const fileVals = readEnvFile();
  const keys = ALLOWED_KEYS.map((meta) => {
    const fileVal = fileVals.get(meta.key) ?? "";
    const runtimeVal = process.env[meta.key] ?? "";
    const configured = fileVal.length > 0;
    return {
      key: meta.key,
      label: meta.label,
      group: meta.group,
      hint: meta.hint,
      configured,
      masked: configured ? mask(fileVal) : null,
      appliedToRuntime: configured ? runtimeVal === fileVal : runtimeVal.length === 0,
    };
  });
  res.json({ keys, envFile: ENV_FILE });
});

/** POST /secrets-vault/set — body { secrets: { KEY: "value" | "" } }.
 *  Empty string clears the key. Restarts the api-server on success. */
router.post("/secrets-vault/set", (req, res) => {
  const body = req.body as { secrets?: Record<string, unknown> } | undefined;
  const secrets = body?.secrets;
  if (!secrets || typeof secrets !== "object" || Array.isArray(secrets)) {
    res.status(400).json({ error: "bad_request", message: "Body must be { secrets: { KEY: value } }" });
    return;
  }
  const updates = new Map<string, string | null>();
  const rejected: string[] = [];
  for (const [key, rawVal] of Object.entries(secrets)) {
    if (!ALLOWED_SET.has(key)) {
      rejected.push(key);
      continue;
    }
    if (typeof rawVal !== "string") {
      rejected.push(key);
      continue;
    }
    const val = rawVal.trim();
    if (val.length > 500 || /[\n\r]/.test(val)) {
      rejected.push(key);
      continue;
    }
    updates.set(key, val.length === 0 ? null : val);
  }
  if (updates.size === 0) {
    res.status(400).json({ error: "no_valid_keys", rejected });
    return;
  }
  try {
    writeEnvKeys(updates);
  } catch (err) {
    logger.error({ err }, "secrets-vault: env file write failed");
    res.status(500).json({ error: "write_failed" });
    return;
  }
  const changed = [...updates.keys()];
  logger.info({ changed, rejected }, "secrets-vault: keys updated, scheduling restart");
  res.json({ ok: true, changed, rejected, restarting: true, restartEtaSec: 25 });
  // Exit AFTER the response flushes; supervisor (autorestart=true) brings the
  // process back with the fresh environment sourced from the env file.
  setTimeout(() => {
    logger.info("secrets-vault: exiting for env reload");
    process.exit(0);
  }, 700);
});

export default router;
