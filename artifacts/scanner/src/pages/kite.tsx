import { useEffect, useMemo, useRef, useState } from "react";
import { applySnapshot, applyTick, type IdentifiedTick } from "@/lib/liveTickStream";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, AlertCircle, CheckCircle2, Download, ExternalLink, LogOut, RefreshCw } from "lucide-react";
import { Seo } from "@/components/seo";

const MIRROR_URL_KEY = "kite.mirrorSourceUrl";

interface KiteStatus {
  credentialsConfigured: boolean;
  apiKeyPreview: string | null;
  loggedIn: boolean;
  userId: string | null;
  userName: string | null;
  loginTime: string | null;
  expiresAt: string | null;
  feed: {
    running: boolean;
    connected: boolean;
    subscribed: number;
    liveQuotes: number;
    lastConnectAt: string | null;
    lastDisconnectAt: string | null;
    lastError: string | null;
  };
}

/**
 * Exchange-qualified storage identity (e.g. "NSE:EQUITY:RELIANCE") comes from
 * IdentifiedTick. Keying client state by `symbol` would re-collapse an NSE and
 * a BSE listing of the same symbol into one row, so both stream events are
 * reduced through the shared pure reducers in lib/liveTickStream.
 */
interface LiveTick extends IdentifiedTick {
  ltp: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  changePercent?: number;
}

const API = (path: string) => `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api${path}`;

function fmtTs(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { hour12: false, timeZone: "Asia/Kolkata" }) + " IST";
}

/**
 * Turn a /api/kite/status response into a KiteStatus, or throw.
 *
 * A non-OK response body is an ERROR, never data. Accepting the 401 JSON error
 * body as data left `feed` undefined and every `s.feed.*` read crashed the
 * page. Pure and exported so the failure modes are directly testable.
 */
export function parseKiteStatus(ok: boolean, httpStatus: number, body: unknown): KiteStatus {
  if (!ok) {
    throw new Error(
      httpStatus === 401 || httpStatus === 403
        ? "AUTH_REQUIRED"
        : `KITE_STATUS_HTTP_${httpStatus}`,
    );
  }
  const b = body as Partial<KiteStatus> | null;
  if (!b || typeof b !== "object" || !b.feed || typeof b.feed !== "object") {
    throw new Error("KITE_STATUS_MALFORMED");
  }
  return b as KiteStatus;
}

export default function KitePage() {
  const qc = useQueryClient();
  const [params, setParams] = useState<URLSearchParams>(() => new URLSearchParams(window.location.search));
  const [ticks, setTicks] = useState<Record<string, LiveTick>>({});

  const status = useQuery<KiteStatus>({
    queryKey: ["kite", "status"],
    /**
     * /api/kite/status is owner-gated and answers 401 with a JSON error body.
     * That body has no `feed`, so accepting it as data made every `s.feed.*`
     * read throw and crashed the whole page. A non-OK response is an ERROR,
     * never data — surface it honestly instead of rendering a half-object.
     */
    queryFn: async (): Promise<KiteStatus> => {
      const r = await fetch(API("/kite/status"));
      return parseKiteStatus(r.ok, r.status, r.ok ? await r.json() : null);
    },
    retry: false,
    refetchInterval: 5000,
  });

  const statusErrorCode =
    status.error instanceof Error ? status.error.message : status.error ? "UNKNOWN" : null;

  // SSE: subscribe to the live tick stream so the UI shows ticks arriving in real-time.
  useEffect(() => {
    if (!status.data?.feed?.running) return;
    const es = new EventSource(API("/kite/stream"));
    es.addEventListener("snapshot", (e: MessageEvent) => {
      try {
        // The snapshot arrives keyed by legacy display alias; applySnapshot
        // re-keys it by the exchange-qualified identity so it matches how
        // `tick` events are stored. Mixing keyings shows one instrument twice.
        setTicks(applySnapshot(JSON.parse(e.data) as Record<string, LiveTick>));
      } catch { /* ignore */ }
    });
    es.addEventListener("tick", (e: MessageEvent) => {
      try {
        const t = JSON.parse(e.data) as LiveTick;
        setTicks(prev => applyTick(prev, t));
      } catch { /* ignore */ }
    });
    es.onerror = () => { /* EventSource auto-reconnects */ };
    return () => es.close();
  }, [status.data?.feed?.running]);

  // Re-read query string after the OAuth callback redirect.
  useEffect(() => {
    const onPop = () => setParams(new URLSearchParams(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const loginBanner = useMemo(() => {
    const r = params.get("login");
    if (r === "success") return { type: "ok" as const, msg: "Login successful — live feed is now connected." };
    if (r === "failed") return { type: "err" as const, msg: `Login failed: ${params.get("reason") ?? "unknown error"}` };
    return null;
  }, [params]);

  const handleLogin = async () => {
    const r = await fetch(API("/kite/login-url"));
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(j.error ?? "Could not start login flow");
      return;
    }
    const { url } = await r.json();
    window.location.href = url;
  };

  const handleLogout = async () => {
    if (!confirm("Disconnect Kite and clear stored access token?")) return;
    await fetch(API("/kite/logout"), { method: "POST" });
    qc.invalidateQueries({ queryKey: ["kite"] });
    setTicks({});
  };

  // ── Force-refresh instruments ────────────────────────────────────────────
  // When Kite has an upstream outage on the bulk getInstruments endpoint
  // (ECONNRESET on the ~50k-row NFO dump), the wrapper in kiteAuth.ts puts
  // the failing exchange into an exponential cooldown (5 → 10 → 20 min ...)
  // and serves an empty cached list during the window. Symptoms: Option
  // Chain "Analytics fetch failed", OI Lab "no option-chain data", scanner
  // collapses to the curated 199-symbol fallback. This button clears the
  // cooldown maps and immediately re-pulls NSE / NFO / BFO.
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const handleRefreshInstruments = async () => {
    setRefreshBusy(true);
    setRefreshMsg(null);
    try {
      const r = await fetch(API("/kite/refresh-instruments"), { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) {
        setRefreshMsg({ type: "err", text: j.error ?? `Refresh failed (HTTP ${r.status})` });
      } else {
        const parts: string[] = [];
        for (const [ex, v] of Object.entries(j.results as Record<string, { count?: number; error?: string }>)) {
          if (typeof v.count === "number") parts.push(`${ex}: ${v.count.toLocaleString("en-IN")}`);
          else parts.push(`${ex}: ✗ ${v.error}`);
        }
        const allOk = Object.values(j.results as Record<string, { count?: number }>).every(v => typeof v.count === "number" && v.count > 0);
        setRefreshMsg({
          type: allOk ? "ok" : "err",
          text: allOk
            ? `Refreshed — ${parts.join(" · ")}. Option Chain & OI Lab should now load.`
            : `Partial — ${parts.join(" · ")}. Kite is still unstable; try again in a minute.`,
        });
      }
    } catch (e) {
      setRefreshMsg({ type: "err", text: (e as Error).message });
    } finally {
      setRefreshBusy(false);
    }
  };

  // ── Mirror-from-production ────────────────────────────────────────────────
  // Zerodha allows ONE Redirect URL per Connect app, so the daily login can
  // only complete on the production domain. This pulls the active session row
  // from the production server into this environment so dev mirrors prod.
  const [mirrorUrl, setMirrorUrl] = useState<string>(() => {
    try { return localStorage.getItem(MIRROR_URL_KEY) ?? "https://marketscannerbydev.in"; }
    catch { return "https://marketscannerbydev.in"; }
  });
  const [mirrorPassword, setMirrorPassword] = useState<string>("");
  const [mirrorBusy, setMirrorBusy] = useState(false);
  const [mirrorMsg, setMirrorMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    try { localStorage.setItem(MIRROR_URL_KEY, mirrorUrl); } catch { /* ignore */ }
  }, [mirrorUrl]);

  const handleMirror = async () => {
    setMirrorMsg(null);
    if (!mirrorUrl.trim() || !mirrorPassword) {
      setMirrorMsg({ type: "err", text: "Source URL and password are both required." });
      return;
    }
    setMirrorBusy(true);
    try {
      const r = await fetch(API("/kite/import-session"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceUrl: mirrorUrl.trim(), password: mirrorPassword }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        const head = j.error ?? `Import failed (HTTP ${r.status})`;
        const detail = typeof j.detail === "string" && j.detail.trim() ? ` — ${j.detail.slice(0, 300)}` : "";
        setMirrorMsg({ type: "err", text: `${head}${detail}` });
      } else {
        setMirrorPassword("");
        setMirrorMsg({
          type: "ok",
          text: `Imported session for ${j.userId ?? "?"}, expires ${fmtTs(j.expiresAt)}.`,
        });
        qc.invalidateQueries({ queryKey: ["kite"] });
      }
    } catch (e) {
      setMirrorMsg({ type: "err", text: (e as Error).message });
    } finally {
      setMirrorBusy(false);
    }
  };

  const sortedTicks = useMemo(() => {
    return Object.values(ticks).sort((a, b) => b.ts - a.ts);
  }, [ticks]);

  const tickRowsRef = useRef<HTMLDivElement>(null);

  const s = status.data;

  return (
    <div className="px-4 py-5 max-w-6xl mx-auto space-y-5">
      <Seo path="/kite" title="Zerodha Kite Live Feed" noindex />
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Live Data Feed — Zerodha Kite</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Real-time tick data for the watchlist & scanner. Zerodha invalidates the access token at ~06:00 IST every day, so a fresh login is required each trading session.
        </p>
      </div>

      {loginBanner && (
        <div className={`px-4 py-3 rounded-md border text-sm flex items-center gap-2 ${
          loginBanner.type === "ok"
            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
            : "bg-red-500/10 border-red-500/30 text-red-300"
        }`}>
          {loginBanner.type === "ok" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {loginBanner.msg}
        </div>
      )}

      {/* Credentials card */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Server Credentials</h2>
        {statusErrorCode ? (
          // Never claim the keys are missing when we simply could not read the
          // status. "Unknown" is the honest answer here.
          <div className="text-sm text-muted-foreground">
            <AlertCircle className="inline h-4 w-4 mr-1 text-amber-400" />
            Credential state unknown — status could not be read.
          </div>
        ) : !s ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : s.credentialsConfigured ? (
          <div className="text-sm text-foreground/90">
            <span className="text-emerald-400">●</span> API Key configured: <span className="font-mono">{s.apiKeyPreview}</span>
          </div>
        ) : (
          <div className="text-sm text-amber-400">
            <AlertCircle className="inline h-4 w-4 mr-1" />
            <span className="font-semibold">KITE_API_KEY</span> and <span className="font-semibold">KITE_API_SECRET</span> are not set.
            Subscribe at <a className="underline" href="https://developers.kite.trade" target="_blank" rel="noreferrer">developers.kite.trade</a> (₹2,000/month), create a Connect app, then add both values as secrets and restart the API server.
          </div>
        )}
      </section>

      {/* Login / status card */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Daily Session</h2>
        {statusErrorCode ? (
          <div className="space-y-2" data-testid="kite-status-error">
            <div className="text-sm text-amber-300 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                {statusErrorCode === "AUTH_REQUIRED"
                  ? "Owner sign-in required to read the Kite feed status. This page shows no feed data until you are signed in as the owner."
                  : statusErrorCode === "KITE_STATUS_MALFORMED"
                    ? "The Kite status response was not in the expected shape, so no feed state can be shown."
                    : `Kite status request failed (${statusErrorCode}).`}
              </span>
            </div>
            <button
              onClick={() => void status.refetch()}
              className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-foreground/5"
            >
              <RefreshCw className="h-3 w-3" /> Retry
            </button>
          </div>
        ) : !s ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : !s.loggedIn ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">No active session. Click below to authorise on Zerodha — you'll be redirected back automatically.</p>
            <button
              onClick={handleLogin}
              disabled={!s.credentialsConfigured}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              <ExternalLink className="h-4 w-4" /> Login to Kite
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div><span className="text-muted-foreground">User:</span> <span className="font-mono">{s.userId ?? "?"}</span> {s.userName ? `(${s.userName})` : ""}</div>
            <div><span className="text-muted-foreground">Login time:</span> {fmtTs(s.loginTime)}</div>
            <div><span className="text-muted-foreground">Token expires:</span> {fmtTs(s.expiresAt)}</div>
            <div className="md:col-span-2 flex gap-2 pt-2">
              <button
                onClick={handleLogin}
                className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-semibold hover:bg-foreground/5"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Re-login
              </button>
              <button
                onClick={handleLogout}
                className="inline-flex items-center gap-2 rounded-md border border-red-500/30 text-red-300 px-3 py-1.5 text-xs font-semibold hover:bg-red-500/10"
              >
                <LogOut className="h-3.5 w-3.5" /> Disconnect
              </button>
              <button
                onClick={handleRefreshInstruments}
                disabled={refreshBusy}
                className="inline-flex items-center gap-2 rounded-md border border-amber-500/30 text-amber-300 px-3 py-1.5 text-xs font-semibold hover:bg-amber-500/10 disabled:opacity-40"
                data-testid="button-refresh-instruments"
                title="Clears NFO/BFO/NSE instruments cooldown and re-pulls from Kite. Use when Option Chain / OI Lab show empty after a Kite outage."
              >
                <RefreshCw className={`h-3.5 w-3.5 ${refreshBusy ? "animate-spin" : ""}`} /> {refreshBusy ? "Refreshing…" : "Force-refresh instruments"}
              </button>
            </div>
            {refreshMsg && (
              <div className={`md:col-span-2 mt-2 px-3 py-2 rounded-md text-xs flex items-start gap-2 ${
                refreshMsg.type === "ok"
                  ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
                  : "bg-red-500/10 border border-red-500/30 text-red-300"
              }`}>
                {refreshMsg.type === "ok" ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" /> : <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
                <span className="break-words">{refreshMsg.text}</span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Mirror-from-production card */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">Mirror Session from Production</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Zerodha allows only one Redirect URL per Connect app, so the daily Kite login can only complete on the production domain.
          After you've logged in there, paste the production URL and the app password below to copy that live session into this environment — no Zerodha re-login needed, and your production session stays active.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-2 items-end">
          <label className="block">
            <span className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">Production URL</span>
            <input
              type="url"
              value={mirrorUrl}
              onChange={(e) => setMirrorUrl(e.target.value)}
              placeholder="https://marketscannerbydev.in"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
              autoComplete="off"
            />
          </label>
          <label className="block">
            <span className="block text-xs uppercase tracking-wider text-muted-foreground mb-1">App password</span>
            <input
              type="password"
              value={mirrorPassword}
              onChange={(e) => setMirrorPassword(e.target.value)}
              placeholder="APP_ACCESS_PASSWORD"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              autoComplete="current-password"
              onKeyDown={(e) => { if (e.key === "Enter" && !mirrorBusy) handleMirror(); }}
            />
          </label>
          <button
            onClick={handleMirror}
            disabled={mirrorBusy}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40 h-[38px]"
          >
            <Download className="h-4 w-4" /> {mirrorBusy ? "Importing…" : "Mirror"}
          </button>
        </div>
        {mirrorMsg && (
          <div className={`mt-3 px-3 py-2 rounded-md text-sm flex items-start gap-2 ${
            mirrorMsg.type === "ok"
              ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
              : "bg-red-500/10 border border-red-500/30 text-red-300"
          }`}>
            {mirrorMsg.type === "ok" ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" /> : <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />}
            <span className="break-words">{mirrorMsg.text}</span>
          </div>
        )}
      </section>

      {/* Feed card */}
      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">WebSocket Feed</h2>
        {!s?.feed ? null : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm mb-4">
            <Stat label="Running" value={s.feed.running ? "Yes" : "No"} ok={s.feed.running} />
            <Stat label="Connected" value={s.feed.connected ? "Yes" : "No"} ok={s.feed.connected} />
            <Stat label="Subscribed" value={String(s.feed.subscribed)} />
            <Stat label="Live Quotes" value={String(s.feed.liveQuotes)} />
          </div>
        )}
        {s?.feed?.lastError && (
          <div className="text-xs text-red-400 mb-3"><AlertCircle className="inline h-3 w-3 mr-1" />Last error: {s.feed.lastError}</div>
        )}

        <div ref={tickRowsRef} className="rounded-md border border-border max-h-[420px] overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 sticky top-0">
              <tr className="text-left">
                <th className="px-3 py-2 font-semibold">Symbol</th>
                <th className="px-3 py-2 font-semibold text-right">LTP</th>
                <th className="px-3 py-2 font-semibold text-right">Change %</th>
                <th className="px-3 py-2 font-semibold text-right">Open</th>
                <th className="px-3 py-2 font-semibold text-right">High</th>
                <th className="px-3 py-2 font-semibold text-right">Low</th>
                <th className="px-3 py-2 font-semibold text-right">Volume</th>
                <th className="px-3 py-2 font-semibold text-right">Tick Time</th>
              </tr>
            </thead>
            <tbody>
              {sortedTicks.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                    {statusErrorCode
                      ? "Feed state unavailable — the Kite status could not be read."
                      : s?.loggedIn
                        ? "Waiting for ticks… (markets closed?)"
                        : "Login above to start the feed."}
                  </td>
                </tr>
              ) : sortedTicks.map(t => (
                <tr key={t.canonicalInstrumentId} className="border-t border-border/60">
                  <td className="px-3 py-1.5 font-mono">
                    {t.symbol}
                    {t.exchange ? (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {t.exchange}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono">{t.ltp.toFixed(2)}</td>
                  <td className={`px-3 py-1.5 text-right font-mono ${
                    t.changePercent == null ? "" : t.changePercent >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}>
                    {t.changePercent == null ? "—" : `${t.changePercent >= 0 ? "+" : ""}${t.changePercent.toFixed(2)}%`}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{t.open?.toFixed(2) ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{t.high?.toFixed(2) ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{t.low?.toFixed(2) ?? "—"}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{t.volume != null ? t.volume.toLocaleString("en-IN") : "—"}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{new Date(t.ts).toLocaleTimeString("en-IN", { hour12: false })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4 text-xs text-muted-foreground space-y-2">
        <div className="flex items-center gap-2 text-foreground"><Activity className="h-4 w-4" /> Setup checklist</div>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Open a Zerodha trading account (if you don't already have one).</li>
          <li>Subscribe to <a className="underline" href="https://developers.kite.trade" target="_blank" rel="noreferrer">Kite Connect</a> — ₹2,000/month. Skip the Historical Data add-on; this app uses Yahoo for historicals.</li>
          <li>Create a "Connect" app. Set Redirect URL to <span className="font-mono break-all">{window.location.origin}{import.meta.env.BASE_URL.replace(/\/$/, "")}/api/kite/callback</span>.</li>
          <li>Copy the API Key and API Secret. Add them as <span className="font-mono">KITE_API_KEY</span> and <span className="font-mono">KITE_API_SECRET</span> secrets, then restart the API server.</li>
          <li>Click "Login to Kite" above each morning after 06:00 IST.</li>
        </ol>
      </section>
    </div>
  );
}

function Stat({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-background/40 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${ok === undefined ? "" : ok ? "text-emerald-400" : "text-red-400"}`}>{value}</div>
    </div>
  );
}
