import { useEffect, useMemo, useRef, useState } from "react";
import { useGetOptionChain, usePostOptionStrategyCustom, getGetOptionChainQueryKey } from "@workspace/api-client-react";
import type {
  OptionChainResponse,
  CustomStrategyResponse,
  CustomLegSpec,
  CustomScenarioSpec,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Trash2, AlertCircle, Sparkles, RefreshCw } from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis, Tooltip,
  CartesianGrid, ReferenceLine,
} from "recharts";

interface LegDraft {
  /** Stable client-side id so React keys survive reordering. */
  id: string;
  action: "BUY" | "SELL";
  optionType: "CE" | "PE";
  strike: number;
  lots: number;
  /** Empty string = use chain's mid/LTP. */
  premiumOverride: string;
  /** Empty string = use chain IV (or BS solver). User enters as %, e.g. "18.5". */
  ivOverridePct: string;
}

const fmt = (n: number | null | undefined, d = 2): string =>
  n == null || !Number.isFinite(n) ? "—"
    : n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });

const fmtRupees = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—"
    : (n >= 0 ? "+₹" : "−₹") + Math.abs(n).toLocaleString("en-IN", { maximumFractionDigits: 0 });

const fmtPct = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(1)}%`;

const fmtSigned = (n: number | null | undefined, d = 2): string =>
  n == null || !Number.isFinite(n) ? "—" : (n >= 0 ? "+" : "") + n.toFixed(d);

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Free-form strategy builder.
 *
 * Reuses the server-side `buildCustomStrategy` (which itself reuses every
 * helper from `optionStrategies.ts`) so there is exactly **zero** duplicated
 * Black-Scholes / payoff / Greeks math on the client. The UI is just a
 * leg-editor + scenario-slider over a single mutation call.
 */
export function StrategyBuilder({ underlying }: { underlying: string }) {
  const chainQ = useGetOptionChain(
    underlying,
    {},
    {
      query: {
        enabled: !!underlying,
        refetchInterval: 30_000,
        staleTime: 25_000,
        queryKey: getGetOptionChainQueryKey(underlying, {}),
      },
    },
  );
  const chain = chainQ.data as OptionChainResponse | undefined;

  const strikes = useMemo(() => chain?.rows.map(r => r.strike) ?? [], [chain]);
  const atmStrike = chain?.atmStrike;
  const lotSize = chain?.lotSize ?? 1;

  // ── Leg editor state ─────────────────────────────────────────────────
  // Seed with a single ATM long call once the chain loads, so the builder
  // is never empty + the user can immediately see a payoff and tweak.
  const [legs, setLegs] = useState<LegDraft[]>([]);
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (atmStrike == null || strikes.length === 0) return;
    seededRef.current = true;
    setLegs([{
      id: makeId(),
      action: "BUY",
      optionType: "CE",
      strike: atmStrike,
      lots: 1,
      premiumOverride: "",
      ivOverridePct: "",
    }]);
  }, [atmStrike, strikes.length]);

  // Reset leg editor whenever the underlying changes — strikes from the old
  // chain won't exist on the new chain and would 400 the build call.
  const lastUnderlying = useRef(underlying);
  useEffect(() => {
    if (lastUnderlying.current !== underlying) {
      lastUnderlying.current = underlying;
      setLegs([]);
      seededRef.current = false;
    }
  }, [underlying]);

  // ── Scenario sliders ──────────────────────────────────────────────────
  const [spotShiftPct, setSpotShiftPct] = useState(0);
  const [ivShiftPct, setIvShiftPct] = useState(0);
  const [daysPassed, setDaysPassed] = useState(0);

  // ── Mutation: rebuild snapshot whenever legs or scenario change ──────
  const buildMut = usePostOptionStrategyCustom({
    mutation: { retry: false },
  });

  // Build a normalized leg list for the API. Skip incomplete drafts.
  const apiLegs: CustomLegSpec[] = useMemo(() => {
    return legs
      .filter(l => Number.isFinite(l.strike) && l.strike > 0 && l.lots > 0)
      .map(l => {
        const premOverride = l.premiumOverride.trim();
        const ivOverride = l.ivOverridePct.trim();
        const premiumOverride = premOverride !== "" && Number.isFinite(parseFloat(premOverride))
          ? parseFloat(premOverride) : null;
        const ivOverrideNum = ivOverride !== "" && Number.isFinite(parseFloat(ivOverride))
          ? parseFloat(ivOverride) / 100 : null; // user enters %, server expects decimal
        return {
          strike: l.strike,
          optionType: l.optionType,
          action: l.action,
          lots: l.lots,
          premiumOverride,
          ivOverride: ivOverrideNum,
        };
      });
  }, [legs]);

  // Debounce the call so dragging a slider doesn't spam the server.
  // 300ms is short enough to feel instant, long enough to coalesce a
  // sweep of slider movements.
  const [debouncedKey, setDebouncedKey] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedKey(k => k + 1), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(apiLegs), spotShiftPct, ivShiftPct, daysPassed, underlying]);

  const [snapshot, setSnapshot] = useState<CustomStrategyResponse | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  // Monotonic request id — protects against out-of-order responses (a slow
  // older request finishing AFTER a newer one would otherwise overwrite the
  // fresher snapshot). We also bump on `underlying` change so a stale chain's
  // response can't ever land on the new symbol.
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (apiLegs.length === 0) {
      reqIdRef.current += 1; // invalidate any in-flight call
      setSnapshot(null);
      setBuildError(null);
      return;
    }
    const myId = ++reqIdRef.current;
    const scenarios: CustomScenarioSpec[] = [{
      spotShiftPct, ivShiftPct, daysPassed,
    }];
    buildMut.mutate({
      underlying,
      data: { legs: apiLegs, scenarios },
    }, {
      onSuccess: (data) => {
        if (myId !== reqIdRef.current) return; // stale response — drop
        setSnapshot(data as CustomStrategyResponse);
        setBuildError(null);
      },
      onError: (err: unknown) => {
        if (myId !== reqIdRef.current) return; // stale response — drop
        const msg = (err as { body?: { error?: string }; message?: string })?.body?.error
          ?? (err as Error)?.message
          ?? "Builder request failed.";
        setBuildError(msg);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedKey]);

  // Reset snapshot immediately on underlying change so the user never sees
  // stale numbers from the previous symbol while the new chain loads.
  useEffect(() => {
    reqIdRef.current += 1;
    setSnapshot(null);
    setBuildError(null);
  }, [underlying]);

  // ── Leg mutators ─────────────────────────────────────────────────────
  const addLeg = () => {
    if (legs.length >= 8) return;
    if (atmStrike == null) return;
    setLegs(prev => [...prev, {
      id: makeId(),
      action: "BUY",
      optionType: "CE",
      strike: atmStrike,
      lots: 1,
      premiumOverride: "",
      ivOverridePct: "",
    }]);
  };
  const removeLeg = (id: string) => setLegs(prev => prev.filter(l => l.id !== id));
  const updateLeg = (id: string, patch: Partial<LegDraft>) =>
    setLegs(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l));

  if (chainQ.isLoading) {
    return <Skeleton className="h-[400px] w-full" />;
  }
  if (!chain) {
    return (
      <Card className="border-signal-strong-sell/30">
        <CardContent className="p-4 text-sm font-mono">
          <div className="flex items-center gap-2 text-signal-strong-sell">
            <AlertCircle className="w-4 h-4" />
            <span className="font-bold uppercase">Chain unavailable for {underlying}</span>
          </div>
          <p className="text-muted-foreground mt-2 text-[12px]">
            The strategy builder needs a live option chain to populate strikes.
            Check Live Feed page if Kite session has expired.
          </p>
        </CardContent>
      </Card>
    );
  }

  const snap = snapshot?.snapshot;
  const scenario = snapshot?.scenarios?.[0] ?? null;

  return (
    <div className="space-y-4">
      {/* ── Spot / lot info ─────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-mono">
          <span className="text-muted-foreground">UNDERLYING</span>
          <span className="font-bold">{chain.underlying}</span>
          <span className="text-muted-foreground">SPOT</span>
          <span className="font-bold tabular-nums">₹{fmt(chain.spot, 2)}</span>
          <span className="text-muted-foreground">EXPIRY</span>
          <span className="font-bold">{chain.expiry}</span>
          <span className="text-muted-foreground">LOT SIZE</span>
          <span className="font-bold tabular-nums">{lotSize}</span>
          <span className="text-muted-foreground">DAYS LEFT</span>
          <span className="font-bold tabular-nums">{snapshot?.daysToExpiry ?? "—"}</span>
          {snapshot?.ivContext && (
            <Badge
              variant="outline"
              className={`font-mono text-[10px] ml-auto ${
                snapshot.ivContext === "HIGH" ? "border-signal-strong-sell/40 text-signal-strong-sell"
                : snapshot.ivContext === "LOW" ? "border-signal-strong-buy/40 text-signal-strong-buy"
                : "text-muted-foreground"
              }`}
            >
              IV {snapshot.ivContext}
            </Badge>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* ── LEFT: leg editor ──────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-3">
          <Card>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-mono uppercase font-bold text-muted-foreground">
                  Legs ({legs.length}/8)
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={addLeg}
                  disabled={legs.length >= 8}
                  className="h-7 text-[10px] font-mono"
                >
                  <Plus className="w-3 h-3 mr-1" /> Add Leg
                </Button>
              </div>

              {legs.length === 0 && (
                <div className="text-[11px] text-muted-foreground font-mono py-3 text-center">
                  No legs — click "Add Leg" to start building.
                </div>
              )}

              {legs.map((leg, i) => (
                <LegRow
                  key={leg.id}
                  index={i}
                  leg={leg}
                  strikes={strikes}
                  onChange={patch => updateLeg(leg.id, patch)}
                  onRemove={() => removeLeg(leg.id)}
                />
              ))}
            </CardContent>
          </Card>

          {/* ── Scenario sliders ───────────────────────────────────── */}
          <Card>
            <CardContent className="p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-[11px] font-mono uppercase font-bold text-muted-foreground">
                  What-if scenario
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => { setSpotShiftPct(0); setIvShiftPct(0); setDaysPassed(0); }}
                  className="h-6 text-[10px] font-mono text-muted-foreground"
                >
                  <RefreshCw className="w-3 h-3 mr-1" /> Reset
                </Button>
              </div>
              <SliderRow
                label="Spot move"
                unit="%"
                value={spotShiftPct}
                min={-20}
                max={20}
                step={0.5}
                onChange={setSpotShiftPct}
              />
              <SliderRow
                label="IV shift"
                unit="%"
                value={ivShiftPct}
                min={-50}
                max={50}
                step={1}
                onChange={setIvShiftPct}
              />
              <SliderRow
                label="Days passed"
                unit="d"
                value={daysPassed}
                min={0}
                max={Math.max(1, snapshot?.daysToExpiry ?? 30)}
                step={1}
                onChange={setDaysPassed}
              />
              {scenario && (
                <div className="bg-secondary/30 rounded p-2 text-[11px] font-mono space-y-1 mt-2">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground uppercase tracking-wider text-[10px]">Scenario MTM</span>
                    <span className={`font-bold tabular-nums ${scenario.totalPnl >= 0 ? "text-signal-strong-buy" : "text-signal-strong-sell"}`}>
                      {fmtRupees(scenario.totalPnl)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Spot @ scenario</span>
                    <span className="tabular-nums">₹{fmt(scenario.newSpot, 2)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* ── RIGHT: snapshot ───────────────────────────────────────── */}
        <div className="lg:col-span-3 space-y-3">
          {buildError && (
            <Card className="border-signal-strong-sell/30">
              <CardContent className="p-3 text-[12px] font-mono">
                <div className="flex items-center gap-2 text-signal-strong-sell mb-1">
                  <AlertCircle className="w-4 h-4" />
                  <span className="font-bold uppercase">Builder error</span>
                </div>
                <p className="text-muted-foreground">{buildError}</p>
              </CardContent>
            </Card>
          )}

          {!snap && !buildError && (
            <Card>
              <CardContent className="p-6 text-center text-[12px] font-mono text-muted-foreground">
                <Sparkles className="w-6 h-6 mx-auto mb-2 opacity-40" />
                Add at least one leg to see the payoff.
              </CardContent>
            </Card>
          )}

          {snap && snapshot && (
            <>
              {/* Headline metrics */}
              <Card>
                <CardContent className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Stat
                    label="Net Cost"
                    value={fmtRupees(snap.perLot.netDebit)}
                    sub={snap.netDebit >= 0 ? "Debit / lot" : "Credit / lot"}
                  />
                  <Stat
                    label="Max Profit"
                    value={snap.maxProfit == null ? "Unlimited" : fmtRupees(snap.maxProfit)}
                    tone="buy"
                  />
                  <Stat
                    label="Max Loss"
                    value={snap.maxLoss == null ? "Unlimited" : fmtRupees(snap.maxLoss)}
                    tone="sell"
                  />
                  <Stat
                    label="POP"
                    value={fmtPct(snap.pop)}
                    sub={snap.dist?.probabilisticRr != null ? `R:R ${fmt(snap.dist.probabilisticRr, 2)}` : undefined}
                  />
                </CardContent>
              </Card>

              {/* Payoff chart */}
              <Card>
                <CardContent className="p-3">
                  <div className="text-[10px] font-mono uppercase text-muted-foreground mb-1">
                    Payoff at expiry
                  </div>
                  <PayoffMini snap={snap} spot={snapshot.spot} />
                  {snap.breakevens.length > 0 && (
                    <div className="text-[10px] font-mono text-muted-foreground mt-1">
                      Breakeven{snap.breakevens.length > 1 ? "s" : ""}:{" "}
                      <span className="text-foreground tabular-nums">
                        {snap.breakevens.map(b => `₹${fmt(b, 2)}`).join("  ·  ")}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Net Greeks + margin */}
              <Card>
                <CardContent className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
                  <Stat small label="Net Δ" value={fmtSigned(snap.netGreeks.delta, 3)} />
                  <Stat small label="Net Γ" value={fmtSigned(snap.netGreeks.gamma, 4)} />
                  <Stat small label="Net Vega" value={fmtSigned(snap.netGreeks.vega, 3)} sub="per 1% IV" />
                  <Stat small label="Net Θ" value={fmtSigned(snap.netGreeks.theta, 3)} sub="per day" />
                  <Stat
                    small
                    label="Margin"
                    value={`₹${fmt(snap.marginRequired, 0)}`}
                    sub="Per lot, est."
                  />
                  <Stat
                    small
                    label="ROC"
                    value={fmtPct(snap.returnOnCapital)}
                    sub="EV / margin"
                  />
                  <Stat
                    small
                    label="Avg IV"
                    value={`${(snap.avgLegIv * 100).toFixed(1)}%`}
                  />
                  <Stat
                    small
                    label="Quote"
                    value={snap.legQuality}
                    tone={snap.legQuality === "POOR" ? "sell" : snap.legQuality === "TIGHT" ? "buy" : undefined}
                  />
                </CardContent>
              </Card>

              {snapshot.warnings.length > 0 && (
                <Card className="border-amber-500/30">
                  <CardContent className="p-2 text-[10px] font-mono text-amber-400">
                    {snapshot.warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function LegRow({
  index, leg, strikes, onChange, onRemove,
}: {
  index: number;
  leg: LegDraft;
  strikes: number[];
  onChange: (patch: Partial<LegDraft>) => void;
  onRemove: () => void;
}) {
  const sideTone = leg.action === "BUY"
    ? "border-signal-strong-buy/40 text-signal-strong-buy"
    : "border-signal-strong-sell/40 text-signal-strong-sell";
  return (
    <div className="border border-border rounded p-2 space-y-1.5 bg-card/50">
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-mono text-muted-foreground w-5">#{index + 1}</span>
        <select
          value={leg.action}
          onChange={e => onChange({ action: e.target.value as "BUY" | "SELL" })}
          className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border bg-card ${sideTone}`}
        >
          <option value="BUY">BUY</option>
          <option value="SELL">SELL</option>
        </select>
        <select
          value={leg.optionType}
          onChange={e => onChange({ optionType: e.target.value as "CE" | "PE" })}
          className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border border-border bg-card"
        >
          <option value="CE">CE</option>
          <option value="PE">PE</option>
        </select>
        <select
          value={leg.strike}
          onChange={e => onChange({ strike: parseFloat(e.target.value) })}
          className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border bg-card flex-1 min-w-0"
        >
          {strikes.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <Input
          type="number"
          min={1}
          value={leg.lots}
          onChange={e => {
            const n = parseInt(e.target.value, 10);
            if (Number.isFinite(n) && n > 0) onChange({ lots: n });
          }}
          className="h-6 w-14 text-[10px] font-mono px-1.5"
          aria-label="Lots"
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          onClick={onRemove}
          className="h-6 w-6 text-muted-foreground hover:text-signal-strong-sell"
        >
          <Trash2 className="w-3 h-3" />
        </Button>
      </div>
      <div className="flex items-center gap-1.5 text-[10px] font-mono">
        <span className="text-muted-foreground w-12">Premium</span>
        <Input
          type="number"
          step="0.05"
          min={0}
          placeholder="auto (chain)"
          value={leg.premiumOverride}
          onChange={e => onChange({ premiumOverride: e.target.value })}
          className="h-6 w-24 text-[10px] font-mono px-1.5"
        />
        <span className="text-muted-foreground w-8">IV</span>
        <Input
          type="number"
          step="0.1"
          min={0}
          placeholder="auto %"
          value={leg.ivOverridePct}
          onChange={e => onChange({ ivOverridePct: e.target.value })}
          className="h-6 w-20 text-[10px] font-mono px-1.5"
        />
        <span className="text-muted-foreground text-[9px]">% (e.g. 18.5)</span>
      </div>
    </div>
  );
}

function SliderRow({
  label, unit, value, min, max, step, onChange,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] font-mono">
        <span className="uppercase text-muted-foreground tracking-wider">{label}</span>
        <span className={`tabular-nums font-bold ${value > 0 ? "text-signal-strong-buy" : value < 0 ? "text-signal-strong-sell" : "text-foreground"}`}>
          {value > 0 ? "+" : ""}{value}{unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1 accent-primary cursor-pointer"
      />
      <div className="flex justify-between text-[9px] font-mono text-muted-foreground/60">
        <span>{min}{unit}</span>
        <span>0</span>
        <span>+{max}{unit}</span>
      </div>
    </div>
  );
}

function PayoffMini({ snap, spot }: { snap: NonNullable<CustomStrategyResponse["snapshot"]>; spot: number }) {
  const data = snap.payoff;
  return (
    <div className="h-[200px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 8 }}>
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="spot"
            type="number"
            domain={["dataMin", "dataMax"]}
            tick={{ fontSize: 10, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={(v: number) => v.toLocaleString("en-IN")}
          />
          <YAxis
            tick={{ fontSize: 10, fontFamily: "monospace", fill: "hsl(var(--muted-foreground))" }}
            tickFormatter={(v: number) => v >= 0 ? `+${(v / 1000).toFixed(0)}k` : `${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip
            contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", fontFamily: "monospace", fontSize: 11 }}
            formatter={(v: number) => [fmtRupees(v), "P&L"]}
            labelFormatter={(s: number) => `Spot ₹${fmt(s, 2)}`}
          />
          <ReferenceLine y={0} stroke="hsl(var(--border))" />
          <ReferenceLine x={spot} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" label={{ value: "Spot", position: "top", fontSize: 9, fill: "hsl(var(--muted-foreground))" }} />
          {snap.breakevens.map((b, i) => (
            <ReferenceLine key={i} x={b} stroke="hsl(var(--primary))" strokeDasharray="2 2" />
          ))}
          <defs>
            <linearGradient id="pnlGradPos" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--signal-strong-buy))" stopOpacity={0.4} />
              <stop offset="100%" stopColor="hsl(var(--signal-strong-buy))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="linear" dataKey="pnl" stroke="none" fill="url(#pnlGradPos)" isAnimationActive={false} />
          <Line type="linear" dataKey="pnl" stroke="hsl(var(--signal-strong-buy))" strokeWidth={1.6} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function Stat({
  label, value, tone, small, sub,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "buy" | "sell";
  small?: boolean;
  sub?: string;
}) {
  const cls = tone === "buy" ? "text-signal-strong-buy" : tone === "sell" ? "text-signal-strong-sell" : "text-foreground";
  return (
    <div className="bg-card p-2">
      <div className={`${small ? "text-[9px]" : "text-[10px]"} font-mono uppercase tracking-wider text-muted-foreground`}>{label}</div>
      <div className={`font-mono ${small ? "text-[12px]" : "text-sm"} font-bold tabular-nums mt-0.5 ${cls}`}>{value}</div>
      {sub && <div className="text-[9px] font-mono text-muted-foreground/70 mt-0.5 truncate" title={sub}>{sub}</div>}
    </div>
  );
}
