/**
 * Owner-only Strategy Control (Task #105; v2 rule language Task #113).
 *
 * One unified catalog drives BOTH the live F&O auto-engine allow-list AND the
 * Backtest Lab selectable list, and lets the owner define new custom strategies
 * (v2 three-layer rule language) that appear on both surfaces.
 *
 * Honesty / safety:
 *   - Toggling a strategy OFF only NARROWS what the engine may emit — it never
 *     bypasses a safety gate or the dev/prod paper-trading isolation.
 *   - A freshly-defined custom strategy is engine-DISABLED until opted in.
 *   - All state is owner-only and DB-persisted (survives restart).
 *   - The builder's "rule summary" is a transparent, deterministic restatement
 *     of the conditions each layer enforces — NOT a fabricated live evaluation.
 *
 * Consumes only the generated typed client — no fabricated data.
 */
import { useMemo, useState } from "react";
import {
  useGetStrategyCatalog,
  useSetStrategyEngineSelection,
  useUpsertCustomStrategy,
  useDeleteCustomStrategy,
  StrategyFeatureKey,
  StrategyConditionOp,
  StrategyConditionOperandType,
  StrategyDirectionMode,
  StrategyEmaKey,
  StrategyRuleBlockType,
  StrategyRuleBlockCmp,
  StrategyRuleBlockOrder,
  StrategyRuleBlockDir,
  StrategyRuleBlockSide,
  StrategyRuleBlockMode,
  StrategyRuleGroupLogic,
  StrategyStopConfigType,
  StrategyStopConfigSource,
  type StrategyCatalogEntry,
  type StrategyRuleBlock,
  type StrategyRuleGroup,
  type StrategySideRules,
  type StrategyExecutionConfig,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle,
  Loader2,
  Plus,
  Trash2,
  Beaker,
  Cpu,
  ShieldCheck,
} from "lucide-react";

const FEATURE_OPTIONS = Object.values(StrategyFeatureKey);
const EMA_OPTIONS = Object.values(StrategyEmaKey);
const OP_OPTIONS = Object.values(StrategyConditionOp);
const OP_LABEL: Record<string, string> = { gt: ">", lt: "<", gte: "≥", lte: "≤" };

const SLUG_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

// ---------------------------------------------------------------------------
// Block palette + factories (mirror the server's v2 RuleBlock union)
// ---------------------------------------------------------------------------

const BLOCK_LABEL: Record<string, string> = {
  price_vs_ema: "Price vs EMA",
  ema_stack: "EMA stack",
  ema_cross: "EMA cross",
  ema_slope: "EMA slope",
  ema_pullback: "EMA pullback",
  ema_distance_max: "Max EMA distance",
  price_vs_vwap: "Price vs VWAP",
  vwap_cross: "VWAP cross",
  vwap_distance_max: "Max VWAP distance",
  fib_zone: "Fib zone",
  fvg: "Fair-value gap (SMC)",
  bos: "Break of structure (SMC)",
  choch: "Change of character (SMC)",
  liquidity_sweep: "Liquidity sweep (SMC)",
  order_block: "Order block (SMC)",
  displacement: "Displacement candle (SMC)",
  compare: "Compare (advanced)",
};

const BLOCK_TYPE_OPTIONS = Object.values(StrategyRuleBlockType);

function defaultBlock(type: StrategyRuleBlock["type"]): StrategyRuleBlock {
  switch (type) {
    case "price_vs_ema":
      return { type, ema: StrategyEmaKey.ema20, cmp: StrategyRuleBlockCmp.above };
    case "ema_stack":
      return { type, order: StrategyRuleBlockOrder.bull };
    case "ema_cross":
      return { type, fast: StrategyEmaKey.ema9, slow: StrategyEmaKey.ema20, dir: StrategyRuleBlockDir.golden };
    case "ema_slope":
      return { type, ema: StrategyEmaKey.ema20, dir: StrategyRuleBlockDir.rising, lookback: 5 };
    case "ema_pullback":
      return { type, ema: StrategyEmaKey.ema20, side: StrategyRuleBlockSide.bull, tolPct: 0.5 };
    case "ema_distance_max":
      return { type, ema: StrategyEmaKey.ema20, maxPct: 2 };
    case "price_vs_vwap":
      return { type, cmp: StrategyRuleBlockCmp.above };
    case "vwap_cross":
      return { type, dir: StrategyRuleBlockDir.reclaim };
    case "vwap_distance_max":
      return { type, maxPct: 1 };
    case "fib_zone":
      return { type, side: StrategyRuleBlockSide.bull, lo: 0.382, hi: 0.618, swingSpan: 8 };
    case "fvg":
      return { type, side: StrategyRuleBlockSide.bull, mode: StrategyRuleBlockMode.present };
    case "bos":
      return { type, dir: StrategyRuleBlockDir.up };
    case "choch":
      return { type, dir: StrategyRuleBlockDir.up };
    case "liquidity_sweep":
      return { type, side: StrategyRuleBlockSide.buy };
    case "order_block":
      return { type, side: StrategyRuleBlockSide.demand, mode: StrategyRuleBlockMode.test };
    case "displacement":
      return { type, dir: StrategyRuleBlockDir.up };
    case "compare":
      return {
        type,
        left: StrategyFeatureKey.close,
        op: StrategyConditionOp.gt,
        right: { type: StrategyConditionOperandType.feature, feature: StrategyFeatureKey.ema20 },
      };
    default:
      return { type: StrategyRuleBlockType.price_vs_ema, ema: StrategyEmaKey.ema20, cmp: StrategyRuleBlockCmp.above };
  }
}

/** Deterministic human restatement of a block — the transparent reasoning surface. */
function blockSummary(b: StrategyRuleBlock): string {
  switch (b.type) {
    case "price_vs_ema":
      return `Price ${b.cmp} ${b.ema}`;
    case "ema_stack":
      return `EMA stack ${b.order === "bull" ? "bullish (9>20>50)" : "bearish (9<20<50)"}`;
    case "ema_cross":
      return `${b.fast}/${b.slow} ${b.dir} cross`;
    case "ema_slope":
      return `${b.ema} ${b.dir} over ${b.lookback ?? "?"} bars`;
    case "ema_pullback":
      return `Pullback to ${b.ema} (${b.side}, ±${b.tolPct ?? "?"}%)`;
    case "ema_distance_max":
      return `|price − ${b.ema}| ≤ ${b.maxPct ?? "?"}%`;
    case "price_vs_vwap":
      return `Price ${b.cmp} VWAP`;
    case "vwap_cross":
      return `VWAP ${b.dir}`;
    case "vwap_distance_max":
      return `|price − VWAP| ≤ ${b.maxPct ?? "?"}%`;
    case "fib_zone":
      return `In ${b.side} fib ${b.lo ?? "?"}–${b.hi ?? "?"} (swing ${b.swingSpan ?? "?"})`;
    case "fvg":
      return `${b.side} fair-value gap ${b.mode ?? "present"}`;
    case "bos":
      return `Break of structure ${b.dir ?? "up"}`;
    case "choch":
      return `Change of character ${b.dir ?? "up"}`;
    case "liquidity_sweep":
      return `${b.side === "sell" ? "Sell-side" : "Buy-side"} liquidity sweep`;
    case "order_block":
      return `${b.side ?? "demand"} order block ${b.mode ?? "test"}`;
    case "displacement":
      return `Displacement candle ${b.dir ?? "up"}`;
    case "compare": {
      const rhs = b.right?.type === "value" ? String(b.right.value ?? 0) : (b.right?.feature ?? "?");
      return `${b.left} ${OP_LABEL[b.op ?? "gt"] ?? b.op} ${rhs}`;
    }
    default:
      return b.type;
  }
}

function groupSummary(g: StrategyRuleGroup): string {
  if (g.blocks.length === 0) return "any (layer disabled)";
  const join = g.logic === "AND" ? " AND " : " OR ";
  return g.blocks.map(blockSummary).join(join);
}

// ---------------------------------------------------------------------------
// Builder state
// ---------------------------------------------------------------------------

interface BuilderState {
  slug: string;
  name: string;
  category: string;
  description: string;
  direction: StrategyDirectionMode;
  baseConfidence: number;
  execution: StrategyExecutionConfig;
  bull: StrategySideRules;
  bear: StrategySideRules;
}

function emptyGroup(): StrategyRuleGroup {
  return { logic: StrategyRuleGroupLogic.AND, blocks: [] };
}
function emptySide(): StrategySideRules {
  return { market: emptyGroup(), setup: emptyGroup() };
}

function emptyBuilder(): BuilderState {
  return {
    slug: "",
    name: "",
    category: "Custom",
    description: "",
    direction: StrategyDirectionMode.BOTH,
    baseConfidence: 60,
    execution: {
      stop: { type: StrategyStopConfigType.atr, atrMult: 1.5 },
      target1R: 1,
      target2R: 2,
    },
    bull: { market: emptyGroup(), setup: { logic: StrategyRuleGroupLogic.AND, blocks: [defaultBlock("price_vs_ema")] } },
    bear: emptySide(),
  };
}

function sideEmpty(s: StrategySideRules): boolean {
  return s.market.blocks.length === 0 && s.setup.blocks.length === 0;
}

export default function StrategyControlPage() {
  const { toast } = useToast();
  const catalogQuery = useGetStrategyCatalog();
  const refetch = catalogQuery.refetch;

  const setEngine = useSetStrategyEngineSelection({
    mutation: {
      onSuccess: () => {
        toast({ title: "Engine selection saved" });
        void refetch();
        setPending({});
      },
      onError: () => toast({ title: "Failed to save engine selection", variant: "destructive" }),
    },
  });
  const upsertCustom = useUpsertCustomStrategy({
    mutation: {
      onSuccess: () => {
        toast({ title: "Custom strategy saved" });
        void refetch();
        setBuilder(emptyBuilder());
        setShowBuilder(false);
      },
      onError: () => toast({ title: "Failed to save custom strategy", variant: "destructive" }),
    },
  });
  const deleteCustom = useDeleteCustomStrategy({
    mutation: {
      onSuccess: () => {
        toast({ title: "Custom strategy deleted" });
        void refetch();
      },
      onError: () => toast({ title: "Failed to delete strategy", variant: "destructive" }),
    },
  });

  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [showBuilder, setShowBuilder] = useState(false);
  const [builder, setBuilder] = useState<BuilderState>(emptyBuilder());

  const data = catalogQuery.data;
  const entries = useMemo(() => data?.entries ?? [], [data]);

  const engineEntries = entries.filter((e) => e.engineSelectable);
  const backtestEntries = entries.filter((e) => e.surfaces.includes("backtest"));
  const customEntries = entries.filter((e) => e.kind === "CUSTOM");

  const effectiveEnabled = (e: StrategyCatalogEntry): boolean =>
    e.id in pending ? pending[e.id]! : e.engineEnabled;

  const dirty = Object.keys(pending).length > 0;

  const saveEngine = () => {
    const items = engineEntries.map((e) => ({ strategyId: e.id, enabled: effectiveEnabled(e) }));
    setEngine.mutate({ data: { items } });
  };

  // ---- Builder validation -------------------------------------------------
  const builderErrors: string[] = [];
  if (!SLUG_RE.test(builder.slug)) builderErrors.push("slug must be lowercase words separated by underscores");
  if (builder.name.trim().length < 2) builderErrors.push("name is required");
  if (builder.category.trim().length < 2) builderErrors.push("category is required");
  if (sideEmpty(builder.bull) && sideEmpty(builder.bear))
    builderErrors.push("add at least one bull or bear rule block");
  if (!(builder.execution.target2R > builder.execution.target1R))
    builderErrors.push("target 2 must be greater than target 1");
  const builderValid = builderErrors.length === 0;

  const submitBuilder = () => {
    if (!builderValid) return;
    upsertCustom.mutate({
      data: {
        slug: builder.slug,
        name: builder.name.trim(),
        category: builder.category.trim(),
        description: builder.description.trim(),
        direction: builder.direction,
        baseConfidence: builder.baseConfidence,
        execution: builder.execution,
        bull: builder.bull,
        bear: builder.bear,
      },
    });
  };

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      <header className="space-y-1">
        <div className="flex items-center gap-2">
          <Cpu className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold tracking-tight">Strategy Control</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          Owner-only. One catalog drives both the live F&amp;O engine allow-list and the Backtest
          Lab. Disabling a strategy only narrows what the engine may emit — it never bypasses any
          safety gate or dev/prod isolation.
        </p>
      </header>

      {catalogQuery.isLoading ? (
        <Card>
          <CardContent className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading strategy catalog…
          </CardContent>
        </Card>
      ) : catalogQuery.isError ? (
        <Card className="border-destructive/40">
          <CardContent className="flex items-center gap-2 py-8 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" /> Failed to load the strategy catalog.
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ---- Live engine allow-list ---- */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldCheck className="h-4 w-4 text-primary" /> Live Engine Allow-list
                  </CardTitle>
                  <CardDescription>
                    {data?.engineGatingActive
                      ? "Active — the engine is narrowed to your selection."
                      : "Legacy mode — all built-in setups on, no custom strategies (default)."}
                  </CardDescription>
                </div>
                <Button size="sm" onClick={saveEngine} disabled={!dirty || setEngine.isPending}>
                  {setEngine.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {engineEntries.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{e.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {e.kind === "CUSTOM" ? "Custom" : "Built-in"}
                      </Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {e.category}
                      </Badge>
                    </div>
                    {e.description ? (
                      <p className="text-xs text-muted-foreground truncate">{e.description}</p>
                    ) : null}
                  </div>
                  <Switch
                    checked={effectiveEnabled(e)}
                    onCheckedChange={(v) => setPending((p) => ({ ...p, [e.id]: v }))}
                    data-testid={`engine-toggle-${e.id}`}
                  />
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Note: the always-on BASELINE fallback lane is intentionally not listed here — it can
                never be disabled.
              </p>
            </CardContent>
          </Card>

          {/* ---- Backtest selectable list (same catalog) ---- */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Beaker className="h-4 w-4 text-primary" /> Backtest Lab Strategies
              </CardTitle>
              <CardDescription>
                The same catalog — these strategies are selectable in the Backtest Lab. Custom
                strategies appear here automatically.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {backtestEntries.map((e) => (
                <Badge key={e.id} variant="outline" className="gap-1">
                  {e.name}
                  {e.kind === "CUSTOM" ? <span className="text-[9px] text-primary">●</span> : null}
                </Badge>
              ))}
            </CardContent>
          </Card>

          {/* ---- Custom strategies ---- */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Custom Strategies</CardTitle>
                  <CardDescription>
                    v2 three-layer rule language (market → setup → execution/risk). Backtestable on
                    real history and runnable live once enabled above.
                  </CardDescription>
                </div>
                <Button
                  size="sm"
                  variant={showBuilder ? "secondary" : "default"}
                  onClick={() => setShowBuilder((s) => !s)}
                >
                  <Plus className="h-4 w-4" /> New
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {customEntries.length === 0 ? (
                <p className="text-sm text-muted-foreground">No custom strategies defined yet.</p>
              ) : (
                <div className="space-y-2">
                  {customEntries.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center justify-between gap-3 rounded border p-2"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{e.name}</span>
                          <Badge variant="secondary" className="text-[10px]">
                            {e.category}
                          </Badge>
                          <Badge
                            variant={e.engineEnabled ? "default" : "outline"}
                            className="text-[10px]"
                          >
                            {e.engineEnabled ? "Engine ON" : "Engine OFF"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground font-mono truncate">{e.id}</p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteCustom.mutate({ id: e.id })}
                        disabled={deleteCustom.isPending}
                        data-testid={`delete-custom-${e.id}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {showBuilder ? (
                <>
                  <Separator />
                  <StrategyBuilder
                    builder={builder}
                    setBuilder={setBuilder}
                    errors={builderErrors}
                    valid={builderValid}
                    pending={upsertCustom.isPending}
                    onSubmit={submitBuilder}
                  />
                </>
              ) : null}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Block editor
// ---------------------------------------------------------------------------

function MiniSelect<T extends string>({
  value,
  options,
  onChange,
  width = "w-28",
  label,
}: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  width?: string;
  label?: (v: T) => string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger className={`${width} h-8`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {label ? label(o) : o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NumberField({
  value,
  onChange,
  step = "1",
  width = "w-20",
}: {
  value: number | undefined;
  onChange: (v: number) => void;
  step?: string;
  width?: string;
}) {
  return (
    <Input
      type="number"
      step={step}
      className={`${width} h-8`}
      value={value ?? 0}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

function BlockEditor({
  block,
  onChange,
  onRemove,
}: {
  block: StrategyRuleBlock;
  onChange: (b: StrategyRuleBlock) => void;
  onRemove: () => void;
}) {
  const patch = (p: Partial<StrategyRuleBlock>) => onChange({ ...block, ...p });
  const b = block;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded border bg-muted/30 p-2">
      <MiniSelect
        value={b.type}
        options={BLOCK_TYPE_OPTIONS}
        onChange={(t) => onChange(defaultBlock(t))}
        width="w-40"
        label={(t) => BLOCK_LABEL[t] ?? t}
      />

      {b.type === "price_vs_ema" ? (
        <>
          <MiniSelect value={b.cmp ?? StrategyRuleBlockCmp.above} options={Object.values(StrategyRuleBlockCmp)} onChange={(v) => patch({ cmp: v })} width="w-20" />
          <MiniSelect value={b.ema ?? StrategyEmaKey.ema20} options={EMA_OPTIONS} onChange={(v) => patch({ ema: v })} width="w-24" />
        </>
      ) : null}

      {b.type === "ema_stack" ? (
        <MiniSelect value={b.order ?? StrategyRuleBlockOrder.bull} options={Object.values(StrategyRuleBlockOrder)} onChange={(v) => patch({ order: v })} width="w-24" />
      ) : null}

      {b.type === "ema_cross" ? (
        <>
          <MiniSelect value={b.fast ?? StrategyEmaKey.ema9} options={EMA_OPTIONS} onChange={(v) => patch({ fast: v })} width="w-24" />
          <MiniSelect value={b.slow ?? StrategyEmaKey.ema20} options={EMA_OPTIONS} onChange={(v) => patch({ slow: v })} width="w-24" />
          <MiniSelect value={b.dir ?? StrategyRuleBlockDir.golden} options={[StrategyRuleBlockDir.golden, StrategyRuleBlockDir.death]} onChange={(v) => patch({ dir: v })} width="w-24" />
        </>
      ) : null}

      {b.type === "ema_slope" ? (
        <>
          <MiniSelect value={b.ema ?? StrategyEmaKey.ema20} options={EMA_OPTIONS} onChange={(v) => patch({ ema: v })} width="w-24" />
          <MiniSelect value={b.dir ?? StrategyRuleBlockDir.rising} options={[StrategyRuleBlockDir.rising, StrategyRuleBlockDir.falling]} onChange={(v) => patch({ dir: v })} width="w-24" />
          <Label className="text-xs">lookback</Label>
          <NumberField value={b.lookback} onChange={(v) => patch({ lookback: v })} />
        </>
      ) : null}

      {b.type === "ema_pullback" ? (
        <>
          <MiniSelect value={b.ema ?? StrategyEmaKey.ema20} options={EMA_OPTIONS} onChange={(v) => patch({ ema: v })} width="w-24" />
          <MiniSelect value={b.side ?? StrategyRuleBlockSide.bull} options={Object.values(StrategyRuleBlockSide)} onChange={(v) => patch({ side: v })} width="w-24" />
          <Label className="text-xs">tol %</Label>
          <NumberField value={b.tolPct} step="0.1" onChange={(v) => patch({ tolPct: v })} />
        </>
      ) : null}

      {b.type === "ema_distance_max" ? (
        <>
          <MiniSelect value={b.ema ?? StrategyEmaKey.ema20} options={EMA_OPTIONS} onChange={(v) => patch({ ema: v })} width="w-24" />
          <Label className="text-xs">max %</Label>
          <NumberField value={b.maxPct} step="0.1" onChange={(v) => patch({ maxPct: v })} />
        </>
      ) : null}

      {b.type === "price_vs_vwap" ? (
        <MiniSelect value={b.cmp ?? StrategyRuleBlockCmp.above} options={Object.values(StrategyRuleBlockCmp)} onChange={(v) => patch({ cmp: v })} width="w-20" />
      ) : null}

      {b.type === "vwap_cross" ? (
        <MiniSelect value={b.dir ?? StrategyRuleBlockDir.reclaim} options={[StrategyRuleBlockDir.reclaim, StrategyRuleBlockDir.reject]} onChange={(v) => patch({ dir: v })} width="w-24" />
      ) : null}

      {b.type === "vwap_distance_max" ? (
        <>
          <Label className="text-xs">max %</Label>
          <NumberField value={b.maxPct} step="0.1" onChange={(v) => patch({ maxPct: v })} />
        </>
      ) : null}

      {b.type === "fib_zone" ? (
        <>
          <MiniSelect value={b.side ?? StrategyRuleBlockSide.bull} options={Object.values(StrategyRuleBlockSide)} onChange={(v) => patch({ side: v })} width="w-24" />
          <Label className="text-xs">lo</Label>
          <NumberField value={b.lo} step="0.001" onChange={(v) => patch({ lo: v })} />
          <Label className="text-xs">hi</Label>
          <NumberField value={b.hi} step="0.001" onChange={(v) => patch({ hi: v })} />
          <Label className="text-xs">swing</Label>
          <NumberField value={b.swingSpan} onChange={(v) => patch({ swingSpan: v })} />
        </>
      ) : null}

      {b.type === "fvg" ? (
        <>
          <MiniSelect value={b.side ?? StrategyRuleBlockSide.bull} options={[StrategyRuleBlockSide.bull, StrategyRuleBlockSide.bear]} onChange={(v) => patch({ side: v })} width="w-24" />
          <MiniSelect value={b.mode ?? StrategyRuleBlockMode.present} options={[StrategyRuleBlockMode.present, StrategyRuleBlockMode.fill, StrategyRuleBlockMode.retest]} onChange={(v) => patch({ mode: v })} width="w-24" />
        </>
      ) : null}

      {b.type === "bos" || b.type === "choch" || b.type === "displacement" ? (
        <MiniSelect value={b.dir ?? StrategyRuleBlockDir.up} options={[StrategyRuleBlockDir.up, StrategyRuleBlockDir.down]} onChange={(v) => patch({ dir: v })} width="w-24" />
      ) : null}

      {b.type === "liquidity_sweep" ? (
        <MiniSelect value={b.side ?? StrategyRuleBlockSide.buy} options={[StrategyRuleBlockSide.buy, StrategyRuleBlockSide.sell]} onChange={(v) => patch({ side: v })} width="w-24" />
      ) : null}

      {b.type === "order_block" ? (
        <>
          <MiniSelect value={b.side ?? StrategyRuleBlockSide.demand} options={[StrategyRuleBlockSide.demand, StrategyRuleBlockSide.supply]} onChange={(v) => patch({ side: v })} width="w-24" />
          <MiniSelect value={b.mode ?? StrategyRuleBlockMode.test} options={[StrategyRuleBlockMode.present, StrategyRuleBlockMode.test]} onChange={(v) => patch({ mode: v })} width="w-24" />
        </>
      ) : null}

      {b.type === "compare" ? (
        <>
          <MiniSelect value={b.left ?? StrategyFeatureKey.close} options={FEATURE_OPTIONS} onChange={(v) => patch({ left: v })} width="w-24" />
          <MiniSelect value={b.op ?? StrategyConditionOp.gt} options={OP_OPTIONS} onChange={(v) => patch({ op: v })} width="w-16" label={(o) => OP_LABEL[o] ?? o} />
          <MiniSelect
            value={b.right?.type ?? StrategyConditionOperandType.feature}
            options={Object.values(StrategyConditionOperandType)}
            onChange={(v) =>
              patch({
                right:
                  v === StrategyConditionOperandType.feature
                    ? { type: StrategyConditionOperandType.feature, feature: StrategyFeatureKey.ema20 }
                    : { type: StrategyConditionOperandType.value, value: 0 },
              })
            }
            width="w-24"
          />
          {b.right?.type === StrategyConditionOperandType.value ? (
            <NumberField value={b.right.value} step="0.01" width="w-24" onChange={(v) => patch({ right: { type: StrategyConditionOperandType.value, value: v } })} />
          ) : (
            <MiniSelect
              value={b.right?.feature ?? StrategyFeatureKey.ema20}
              options={FEATURE_OPTIONS}
              onChange={(v) => patch({ right: { type: StrategyConditionOperandType.feature, feature: v } })}
              width="w-24"
            />
          )}
        </>
      ) : null}

      <Button size="icon" variant="ghost" className="ml-auto" onClick={onRemove}>
        <Trash2 className="h-3 w-3 text-destructive" />
      </Button>
    </div>
  );
}

function GroupEditor({
  title,
  hint,
  group,
  onChange,
}: {
  title: string;
  hint: string;
  group: StrategyRuleGroup;
  onChange: (g: StrategyRuleGroup) => void;
}) {
  const updateBlock = (i: number, b: StrategyRuleBlock) =>
    onChange({ ...group, blocks: group.blocks.map((x, idx) => (idx === i ? b : x)) });
  const removeBlock = (i: number) =>
    onChange({ ...group, blocks: group.blocks.filter((_, idx) => idx !== i) });
  const addBlock = () => onChange({ ...group, blocks: [...group.blocks, defaultBlock("price_vs_ema")] });

  return (
    <div className="space-y-2 rounded border p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Label className="text-sm">{title}</Label>
          <p className="text-[11px] text-muted-foreground">{hint}</p>
        </div>
        <div className="flex items-center gap-2">
          <MiniSelect
            value={group.logic}
            options={Object.values(StrategyRuleGroupLogic)}
            onChange={(v) => onChange({ ...group, logic: v })}
            width="w-20"
          />
          <Button size="sm" variant="outline" onClick={addBlock}>
            <Plus className="h-3 w-3" /> Block
          </Button>
        </div>
      </div>
      {group.blocks.length === 0 ? (
        <p className="text-xs text-muted-foreground">No blocks — this layer passes through (disabled).</p>
      ) : (
        <div className="space-y-2">
          {group.blocks.map((b, i) => (
            <BlockEditor key={i} block={b} onChange={(nb) => updateBlock(i, nb)} onRemove={() => removeBlock(i)} />
          ))}
        </div>
      )}
    </div>
  );
}

function SideEditor({
  title,
  side,
  onChange,
}: {
  title: string;
  side: StrategySideRules;
  onChange: (s: StrategySideRules) => void;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-sm font-semibold">{title} side</Label>
      <GroupEditor
        title="Market layer"
        hint="Regime / context gates that must hold before any setup is considered."
        group={side.market}
        onChange={(g) => onChange({ ...side, market: g })}
      />
      <GroupEditor
        title="Setup layer"
        hint="The entry trigger conditions themselves."
        group={side.setup}
        onChange={(g) => onChange({ ...side, setup: g })}
      />
      <div className="rounded bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground">
        <span className="font-medium">Summary:</span> Market [{groupSummary(side.market)}] → Setup [
        {groupSummary(side.setup)}]
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

function StrategyBuilder({
  builder,
  setBuilder,
  errors,
  valid,
  pending,
  onSubmit,
}: {
  builder: BuilderState;
  setBuilder: React.Dispatch<React.SetStateAction<BuilderState>>;
  errors: string[];
  valid: boolean;
  pending: boolean;
  onSubmit: () => void;
}) {
  const set = <K extends keyof BuilderState>(k: K, v: BuilderState[K]) =>
    setBuilder((b) => ({ ...b, [k]: v }));
  const setExec = (p: Partial<StrategyExecutionConfig>) =>
    setBuilder((b) => ({ ...b, execution: { ...b.execution, ...p } }));

  const stop = builder.execution.stop;

  return (
    <div className="space-y-4">
      {/* Identity */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Slug (id = CUSTOM_&lt;slug&gt;)</Label>
          <Input
            value={builder.slug}
            placeholder="e.g. momentum_pop"
            onChange={(e) => set("slug", e.target.value)}
            data-testid="builder-slug"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Name</Label>
          <Input value={builder.name} onChange={(e) => set("name", e.target.value)} data-testid="builder-name" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Category</Label>
          <Input value={builder.category} onChange={(e) => set("category", e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Direction</Label>
          <MiniSelect
            value={builder.direction}
            options={Object.values(StrategyDirectionMode)}
            onChange={(v) => set("direction", v)}
            width="w-full"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Description</Label>
        <Textarea value={builder.description} rows={2} onChange={(e) => set("description", e.target.value)} />
      </div>

      {/* Execution / risk layer */}
      <div className="rounded border p-3 space-y-3">
        <Label className="text-sm font-semibold">Execution &amp; risk layer</Label>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">Stop type</Label>
            <MiniSelect
              value={stop.type}
              options={Object.values(StrategyStopConfigType)}
              onChange={(v) =>
                setExec({
                  stop:
                    v === StrategyStopConfigType.atr
                      ? { type: StrategyStopConfigType.atr, atrMult: stop.atrMult ?? 1.5 }
                      : v === StrategyStopConfigType.smc
                        ? { type: StrategyStopConfigType.smc, source: stop.source ?? StrategyStopConfigSource.fvg, bufferAtrMult: stop.bufferAtrMult ?? 0.25 }
                        : { type: StrategyStopConfigType.swing, swingSpan: stop.swingSpan ?? 10, bufferAtrMult: stop.bufferAtrMult ?? 0.25 },
                })
              }
              width="w-full"
            />
          </div>
          {stop.type === StrategyStopConfigType.atr ? (
            <div className="space-y-1">
              <Label className="text-xs">Stop × ATR</Label>
              <NumberField value={stop.atrMult} step="0.1" width="w-full" onChange={(v) => setExec({ stop: { type: StrategyStopConfigType.atr, atrMult: v } })} />
            </div>
          ) : stop.type === StrategyStopConfigType.smc ? (
            <>
              <div className="space-y-1">
                <Label className="text-xs">SMC anchor</Label>
                <MiniSelect
                  value={stop.source ?? StrategyStopConfigSource.fvg}
                  options={Object.values(StrategyStopConfigSource)}
                  onChange={(v) => setExec({ stop: { type: StrategyStopConfigType.smc, source: v, bufferAtrMult: stop.bufferAtrMult ?? 0.25 } })}
                  width="w-full"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Buffer × ATR</Label>
                <NumberField value={stop.bufferAtrMult} step="0.05" width="w-full" onChange={(v) => setExec({ stop: { type: StrategyStopConfigType.smc, source: stop.source ?? StrategyStopConfigSource.fvg, bufferAtrMult: v } })} />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1">
                <Label className="text-xs">Swing span</Label>
                <NumberField value={stop.swingSpan} width="w-full" onChange={(v) => setExec({ stop: { type: StrategyStopConfigType.swing, swingSpan: v, bufferAtrMult: stop.bufferAtrMult ?? 0.25 } })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Buffer × ATR</Label>
                <NumberField value={stop.bufferAtrMult} step="0.05" width="w-full" onChange={(v) => setExec({ stop: { type: StrategyStopConfigType.swing, swingSpan: stop.swingSpan ?? 10, bufferAtrMult: v } })} />
              </div>
            </>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Base confidence</Label>
            <NumberField value={builder.baseConfidence} width="w-full" onChange={(v) => set("baseConfidence", v)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="space-y-1">
            <Label className="text-xs">Target 1 (R)</Label>
            <NumberField value={builder.execution.target1R} step="0.25" width="w-full" onChange={(v) => setExec({ target1R: v })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Target 2 (R)</Label>
            <NumberField value={builder.execution.target2R} step="0.25" width="w-full" onChange={(v) => setExec({ target2R: v })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Min RR (optional)</Label>
            <NumberField value={builder.execution.minRR} step="0.25" width="w-full" onChange={(v) => setExec({ minRR: v })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Max stop × ATR (optional)</Label>
            <NumberField value={builder.execution.maxStopAtrMult} step="0.25" width="w-full" onChange={(v) => setExec({ maxStopAtrMult: v })} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Max entry dist × ATR (optional)</Label>
            <NumberField value={builder.execution.maxEntryDistanceAtrMult} step="0.25" width="w-full" onChange={(v) => setExec({ maxEntryDistanceAtrMult: v })} />
          </div>
        </div>
      </div>

      {/* Rule sides */}
      <SideEditor title="Bull" side={builder.bull} onChange={(s) => set("bull", s)} />
      <SideEditor title="Bear" side={builder.bear} onChange={(s) => set("bear", s)} />

      {errors.length > 0 ? (
        <ul className="text-xs text-destructive list-disc pl-5">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}

      <Button onClick={onSubmit} disabled={!valid || pending} data-testid="builder-submit">
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save strategy"}
      </Button>
    </div>
  );
}
