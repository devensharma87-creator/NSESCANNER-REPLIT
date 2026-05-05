/**
 * Admin page — owner-only. Single-screen subscriber management:
 *   - Top: KPI strip (total / pending / active / expired / suspended counts)
 *   - List: every account, newest first, with inline approve/edit/suspend/delete
 *   - Edit drawer: subscription dates, amount, payment ref, notes, allowed tabs
 *
 * No external state machine — the form just PATCHes /admin/users/:id and
 * re-fetches the list. Optimistic UI is intentionally avoided so what you see
 * is always what the server returned.
 */
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ShieldCheck, Users, Clock, CheckCircle2, XCircle, AlertCircle, Trash2, Edit, RefreshCw } from "lucide-react";
import {
  adminListUsers,
  adminUpdateUser,
  adminDeleteUser,
  ALLOWED_TAB_KEYS,
  type AdminUserRow,
  type AllowedTabKey,
  type UserStatus,
} from "@/lib/auth-api";

const TAB_LABELS: Record<AllowedTabKey, string> = {
  HOME: "Home",
  SCANNER: "Scanner",
  DEEP_SCAN: "Deep Scan",
  FNO: "F & O Intraday",
  STRATEGIES: "Strategies",
  OPTION_CHAIN: "Option Chain",
  OI_LAB: "OI Lab",
  PREMARKET: "Pre / Post",
  WATCHLIST: "Watchlist",
  SECTORS: "Sectors",
  FLOWS: "FII / DII",
  STOCKS_TO_WATCH: "To Watch",
  NEWS: "Market Info",
  LEARN: "Learn",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function rupees(paise: number | null): string {
  if (paise == null) return "—";
  return `Rs. ${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
function dateInputValue(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toISOString().slice(0, 10);
}
function statusTone(s: UserStatus): string {
  return ({
    pending:   "bg-amber-500/15 text-amber-500 border-amber-500/40",
    active:    "bg-emerald-500/15 text-emerald-500 border-emerald-500/40",
    expired:   "bg-red-500/15 text-red-500 border-red-500/40",
    suspended: "bg-zinc-500/15 text-zinc-400 border-zinc-500/40",
  } as const)[s];
}

export default function AdminPage() {
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminUserRow | null>(null);

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const r = await adminListUsers();
      setUsers(r.users);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, []);

  const counts = useMemo(() => {
    const c = { total: 0, pending: 0, active: 0, expired: 0, suspended: 0 };
    for (const u of users ?? []) {
      c.total++;
      c[u.effectiveStatus]++;
    }
    return c;
  }, [users]);

  return (
    <div className="w-full max-w-none px-4 lg:px-6 2xl:px-8 py-6 space-y-6">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Subscriber Administration</h1>
            <p className="text-sm text-muted-foreground">Approve, extend, suspend, and grant tab access to subscriber accounts.</p>
          </div>
        </div>
        <Button variant="outline" onClick={() => void reload()} disabled={loading} data-testid="button-reload-users">
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </header>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {([
          { k: "total",     label: "Total",     v: counts.total,     icon: Users,        tone: "text-foreground" },
          { k: "pending",   label: "Pending",   v: counts.pending,   icon: Clock,        tone: "text-amber-500" },
          { k: "active",    label: "Active",    v: counts.active,    icon: CheckCircle2, tone: "text-emerald-500" },
          { k: "expired",   label: "Expired",   v: counts.expired,   icon: AlertCircle,  tone: "text-red-500" },
          { k: "suspended", label: "Suspended", v: counts.suspended, icon: XCircle,      tone: "text-zinc-400" },
        ] as const).map(c => {
          const Icon = c.icon;
          return (
            <Card key={c.k}>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <div className="text-xs font-mono uppercase text-muted-foreground tracking-wider">{c.label}</div>
                  <div className="text-2xl font-bold font-mono mt-1">{c.v}</div>
                </div>
                <Icon className={`h-7 w-7 ${c.tone}`} />
              </CardContent>
            </Card>
          );
        })}
      </div>

      {error && (
        <Card className="border-red-500/40">
          <CardContent className="p-4 text-sm text-red-500">{error}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All accounts</CardTitle>
          <CardDescription>{users?.length ?? 0} subscriber{(users?.length ?? 0) === 1 ? "" : "s"}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading && !users && <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>}
          {users && users.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">No subscribers yet. Share the sign-up link to start onboarding.</div>}
          {users && users.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                  <tr className="border-b">
                    <th className="text-left p-3">Name / Email / Phone</th>
                    <th className="text-left p-3">Status</th>
                    <th className="text-left p-3">Subscription</th>
                    <th className="text-left p-3">Payment</th>
                    <th className="text-left p-3">Tabs ({ALLOWED_TAB_KEYS.length})</th>
                    <th className="text-right p-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id} className="border-b hover:bg-muted/20" data-testid={`user-row-${u.id}`}>
                      <td className="p-3 align-top">
                        <div className="font-semibold">{u.fullName}</div>
                        <div className="text-xs text-muted-foreground font-mono">{u.email}</div>
                        {u.phone && <div className="text-xs text-muted-foreground">{u.phone}</div>}
                        <div className="text-[10px] text-muted-foreground/70 font-mono mt-1">Joined {fmtDateTime(u.createdAt)}</div>
                      </td>
                      <td className="p-3 align-top">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${statusTone(u.effectiveStatus)}`}>
                          {u.effectiveStatus.toUpperCase()}
                        </span>
                        {u.status !== u.effectiveStatus && (
                          <div className="text-[10px] text-muted-foreground mt-1">(set: {u.status})</div>
                        )}
                      </td>
                      <td className="p-3 align-top text-xs">
                        <div>From: {fmtDate(u.subscriptionStartedAt)}</div>
                        <div>Until: {fmtDate(u.subscriptionExpiresAt)}</div>
                      </td>
                      <td className="p-3 align-top text-xs">
                        <div>{rupees(u.amountPaise)}</div>
                        <div className="text-muted-foreground">{u.paidAt ? fmtDate(u.paidAt) : "not recorded"}</div>
                        {u.paymentRef && <div className="text-[10px] font-mono text-muted-foreground truncate max-w-[160px]" title={u.paymentRef}>{u.paymentRef}</div>}
                      </td>
                      <td className="p-3 align-top text-xs">
                        {u.allowedTabs.length === 0 ? (
                          <span className="text-muted-foreground">none</span>
                        ) : (
                          <div className="flex flex-wrap gap-1 max-w-[260px]">
                            {u.allowedTabs.map(t => (
                              <Badge key={t} variant="outline" className="text-[10px] px-1.5 py-0">{TAB_LABELS[t]}</Badge>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="p-3 align-top text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="outline" onClick={() => setEditing(u)} data-testid={`button-edit-${u.id}`}>
                            <Edit className="h-3.5 w-3.5 mr-1" /> Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-500 hover:text-red-500 hover:bg-red-500/10"
                            onClick={async () => {
                              if (!confirm(`Permanently delete ${u.email}? This cannot be undone.`)) return;
                              try { await adminDeleteUser(u.id); await reload(); }
                              catch (err) { alert(err instanceof Error ? err.message : "delete failed"); }
                            }}
                            data-testid={`button-delete-${u.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {editing && (
        <EditUserDialog
          user={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await reload(); }}
        />
      )}
    </div>
  );
}

function EditUserDialog({ user, onClose, onSaved }: {
  user: AdminUserRow;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [status, setStatus] = useState<UserStatus>(user.status);
  const [startedAt, setStartedAt] = useState<string>(dateInputValue(user.subscriptionStartedAt));
  const [expiresAt, setExpiresAt] = useState<string>(dateInputValue(user.subscriptionExpiresAt));
  const [amountRupees, setAmountRupees] = useState<string>(user.amountPaise == null ? "5500" : String(user.amountPaise / 100));
  const [paidAt, setPaidAt] = useState<string>(dateInputValue(user.paidAt));
  const [paymentRef, setPaymentRef] = useState<string>(user.paymentRef ?? "");
  const [notes, setNotes] = useState<string>(user.notes ?? "");
  const [allowedTabs, setAllowedTabs] = useState<AllowedTabKey[]>(user.allowedTabs);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function quickApprove() {
    // Sensible defaults: today + 1 year, all tabs, status active.
    const today = new Date().toISOString().slice(0, 10);
    const oneYear = new Date();
    oneYear.setFullYear(oneYear.getFullYear() + 1);
    setStatus("active");
    setStartedAt(today);
    setExpiresAt(oneYear.toISOString().slice(0, 10));
    setPaidAt(today);
    if (!amountRupees) setAmountRupees("5500");
    setAllowedTabs([...ALLOWED_TAB_KEYS]);
  }

  function toggleTab(t: AllowedTabKey) {
    setAllowedTabs(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);
  }
  function selectAllTabs() { setAllowedTabs([...ALLOWED_TAB_KEYS]); }
  function selectNoTabs() { setAllowedTabs([]); }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const amtNum = amountRupees.trim() === "" ? null : Number(amountRupees);
      if (amtNum != null && (!Number.isFinite(amtNum) || amtNum < 0)) {
        throw new Error("Amount must be a non-negative number");
      }
      await adminUpdateUser(user.id, {
        status,
        subscriptionStartedAt: startedAt ? new Date(startedAt).toISOString() : null,
        subscriptionExpiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        amountPaise: amtNum == null ? null : Math.round(amtNum * 100),
        paidAt: paidAt ? new Date(paidAt).toISOString() : null,
        paymentRef: paymentRef.trim() || null,
        notes: notes.trim() || null,
        allowedTabs,
      });
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit account — {user.fullName}</DialogTitle>
          <DialogDescription className="font-mono text-xs">{user.email}{user.phone ? ` · ${user.phone}` : ""}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          {user.status === "pending" && (
            <div className="col-span-2">
              <Button onClick={quickApprove} variant="outline" className="w-full border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10" data-testid="button-quick-approve">
                <CheckCircle2 className="h-4 w-4 mr-2" /> Quick approve — Rs 5,500 / 1 year / all 10 tabs
              </Button>
            </div>
          )}

          <div className="space-y-1">
            <Label>Status</Label>
            <select
              value={status}
              onChange={e => setStatus(e.target.value as UserStatus)}
              className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              data-testid="select-status"
            >
              <option value="pending">Pending</option>
              <option value="active">Active</option>
              <option value="suspended">Suspended</option>
              <option value="expired">Expired</option>
            </select>
          </div>
          <div className="space-y-1">
            <Label>Amount paid (Rs.)</Label>
            <Input type="number" inputMode="decimal" value={amountRupees} onChange={e => setAmountRupees(e.target.value)} placeholder="5500" data-testid="input-amount" />
          </div>

          <div className="space-y-1">
            <Label>Subscription start</Label>
            <Input type="date" value={startedAt} onChange={e => setStartedAt(e.target.value)} data-testid="input-started-at" />
          </div>
          <div className="space-y-1">
            <Label>Subscription expires</Label>
            <Input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} data-testid="input-expires-at" />
          </div>

          <div className="space-y-1">
            <Label>Paid on</Label>
            <Input type="date" value={paidAt} onChange={e => setPaidAt(e.target.value)} data-testid="input-paid-at" />
          </div>
          <div className="space-y-1">
            <Label>Payment reference</Label>
            <Input value={paymentRef} onChange={e => setPaymentRef(e.target.value)} placeholder="UPI txn id / bank ref / cheque #" data-testid="input-payment-ref" />
          </div>

          <div className="col-span-2 space-y-1">
            <Label>Internal notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Anything you want to remember about this account…" data-testid="input-notes" />
          </div>

          <div className="col-span-2 space-y-2">
            <div className="flex items-center justify-between">
              <Label>Allowed tabs</Label>
              <div className="flex gap-2 text-xs">
                <button type="button" onClick={selectAllTabs} className="text-primary hover:underline" data-testid="link-tabs-all">Select all</button>
                <button type="button" onClick={selectNoTabs} className="text-muted-foreground hover:underline" data-testid="link-tabs-none">None</button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-3 border border-border rounded">
              {ALLOWED_TAB_KEYS.map(t => {
                const checked = allowedTabs.includes(t);
                return (
                  <label key={t} className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm ${checked ? "bg-primary/10 border border-primary/30" : "border border-transparent hover:bg-muted/40"}`}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleTab(t)}
                      className="h-4 w-4"
                      data-testid={`checkbox-tab-${t}`}
                    />
                    <span>{TAB_LABELS[t]}</span>
                  </label>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground leading-snug">Only the tabs ticked above will appear in this subscriber's navigation. Anything else returns 403 even via direct URL.</p>
          </div>

          {error && <div className="col-span-2 text-sm text-red-500">{error}</div>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saving} data-testid="button-save-user">
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
