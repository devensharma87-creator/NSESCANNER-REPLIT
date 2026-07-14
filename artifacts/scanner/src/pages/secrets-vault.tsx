import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KeyRound, ShieldCheck, RefreshCw, CheckCircle2, XCircle, Loader2, Eye, EyeOff } from "lucide-react";
import { Seo } from "@/components/seo";

interface VaultKey {
  key: string;
  label: string;
  group: string;
  hint: string;
  configured: boolean;
  masked: string | null;
  appliedToRuntime: boolean;
}

const base = import.meta.env.BASE_URL;

export default function SecretsVaultPage() {
  const [keys, setKeys] = useState<VaultKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [show, setShow] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pollRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`${base}api/secrets-vault/status`, { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { keys: VaultKey[] };
      setKeys(j.keys);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "fetch failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [load]);

  const dirtyKeys = Object.entries(drafts).filter(([, v]) => v.trim().length > 0);

  async function save() {
    if (dirtyKeys.length === 0) return;
    setSaving(true);
    setErr(null);
    setNotice(null);
    try {
      const secrets: Record<string, string> = {};
      for (const [k, v] of dirtyKeys) secrets[k] = v.trim();
      const r = await fetch(`${base}api/secrets-vault/set`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secrets }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { ok: boolean; changed: string[]; restarting: boolean };
      setDrafts({});
      if (j.restarting) {
        setRestarting(true);
        setNotice(`Saved ${j.changed.length} key(s). API server is restarting to apply them (~25s)…`);
        // Poll until the API is back, then reload status.
        pollRef.current = window.setInterval(async () => {
          try {
            const ping = await fetch(`${base}api/auth/status`, { credentials: "include" });
            if (ping.ok) {
              if (pollRef.current) window.clearInterval(pollRef.current);
              pollRef.current = null;
              setRestarting(false);
              setNotice("Secrets applied. API server is back online.");
              void load();
            }
          } catch {
            /* still restarting */
          }
        }, 3000);
      } else {
        void load();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  const groups = [...new Set(keys.map((k) => k.group))];

  return (
    <div className="container mx-auto px-4 py-6 max-w-3xl" data-testid="secrets-vault-page">
      <Seo title="Secrets Vault" description="Owner-only credential intake" noindex />
      <div className="flex items-center gap-3 mb-1">
        <KeyRound className="h-6 w-6 text-primary" aria-hidden />
        <h1 className="text-2xl font-bold">Secrets Vault</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Paste credentials here instead of sharing them in chat. Values are written to a
        git-ignored server env file (chmod 600) and are never displayed again — only a
        masked tail. Saving restarts the API server to apply changes.
      </p>

      {notice && (
        <div
          className="mb-4 rounded border border-emerald-600/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-500 flex items-center gap-2"
          data-testid="secrets-vault-notice"
        >
          {restarting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
          {notice}
        </div>
      )}
      {err && (
        <div className="mb-4 rounded border border-rose-600/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-500 flex items-center gap-2" data-testid="secrets-vault-error">
          <XCircle className="h-4 w-4" aria-hidden /> {err}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading vault status…
        </div>
      ) : (
        groups.map((group) => (
          <Card key={group} className="mb-4" data-testid={`secrets-group-${group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> {group}
              </CardTitle>
              <CardDescription>Leave a field blank to keep its current value.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {keys
                .filter((k) => k.group === group)
                .map((k) => (
                  <div key={k.key} className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label htmlFor={`input-${k.key}`} className="text-sm font-medium">
                        {k.label} <span className="text-xs text-muted-foreground font-mono">({k.key})</span>
                      </label>
                      {k.configured ? (
                        <Badge variant="outline" className="border-emerald-600 text-emerald-600" data-testid={`secret-status-${k.key}`}>
                          SET {k.masked}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="border-amber-600 text-amber-600" data-testid={`secret-status-${k.key}`}>
                          NOT SET
                        </Badge>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Input
                        id={`input-${k.key}`}
                        data-testid={`secret-input-${k.key}`}
                        type={show[k.key] ? "text" : "password"}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={k.configured ? `Currently ${k.masked} — paste to replace` : k.hint}
                        value={drafts[k.key] ?? ""}
                        onChange={(e) => setDrafts((d) => ({ ...d, [k.key]: e.target.value }))}
                        disabled={saving || restarting}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={show[k.key] ? "Hide value" : "Show value"}
                        onClick={() => setShow((s) => ({ ...s, [k.key]: !s[k.key] }))}
                      >
                        {show[k.key] ? <EyeOff className="h-4 w-4" aria-hidden /> : <Eye className="h-4 w-4" aria-hidden />}
                      </Button>
                    </div>
                  </div>
                ))}
            </CardContent>
          </Card>
        ))
      )}

      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} disabled={saving || restarting || dirtyKeys.length === 0} data-testid="secrets-vault-save-btn">
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" aria-hidden /> : null}
          Save {dirtyKeys.length > 0 ? `${dirtyKeys.length} key(s)` : ""} & apply
        </Button>
        <Button variant="outline" onClick={() => void load()} disabled={loading || restarting} data-testid="secrets-vault-refresh-btn">
          <RefreshCw className="h-4 w-4 mr-2" aria-hidden /> Refresh status
        </Button>
      </div>

      <p className="text-xs text-muted-foreground mt-6">
        After saving Kite keys, go to <a href={`${base}kite`} className="underline text-primary">Live Feed</a> and
        use "Reconnect Zerodha" — your Kite app's Redirect URL must point to{" "}
        <code className="font-mono">{window.location.origin}{base}api/kite/callback</code>.
      </p>
    </div>
  );
}
