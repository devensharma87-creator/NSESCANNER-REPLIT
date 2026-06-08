/**
 * Owner-only Strategy Control (Task #105).
 *
 * One unified catalog drives BOTH the live F&O auto-engine allow-list AND the
 * Backtest Lab selectable list, and lets the owner define new config/parameter
 * driven custom strategies that appear on both surfaces.
 *
 * Honesty / safety:
 *   - Toggling a strategy OFF only NARROWS what the engine may emit — it never
 *     bypasses a safety gate or the dev/prod paper-trading isolation.
 *   - A freshly-defined custom strategy is engine-DISABLED until opted in.
 *   - All state is owner-only and DB-persisted (survives restart).
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
  type StrategyCatalogEntry,
  type StrategyCondition,
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
const OP_OPTIONS = Object.values(StrategyConditionOp);
const OP_LABEL: Record<string, string> = { gt: ">", lt: "<", gte: "≥", lte: "≤" };

function emptyCondition(): StrategyCondition {
  return {
    left: StrategyFeatureKey.close,
    op: StrategyConditionOp.gt,
    right: { type: StrategyConditionOperandType.feature, feature: StrategyFeatureKey.ema20 },
  };
}

const SLUG_RE = /^[a-z0-9]+(?:_[a-z0-9]+)*$/;

interface BuilderState {
  slug: string;
  name: string;
  category: string;
  description: string;
  baseConfidence: number;
  stopAtrMult: number;
  target1R: number;
  target2R: number;
  bull: StrategyCondition[];
  bear: StrategyCondition[];
}

function emptyBuilder(): BuilderState {
  return {
    slug: "",
    name: "",
    category: "Custom",
    description: "",
    baseConfidence: 60,
    stopAtrMult: 1.5,
    target1R: 1,
    target2R: 2,
    bull: [emptyCondition()],
    bear: [],
  };
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

  // Pending engine-toggle overrides keyed by strategy id (id -> desired enabled).
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
  if (builder.bull.length === 0 && builder.bear.length === 0)
    builderErrors.push("add at least one bull or bear condition");
  const builderValid = builderErrors.length === 0;

  const submitBuilder = () => {
    if (!builderValid) return;
    upsertCustom.mutate({
      data: {
        slug: builder.slug,
        name: builder.name.trim(),
        category: builder.category.trim(),
        description: builder.description.trim(),
        baseConfidence: builder.baseConfidence,
        params: {
          stopAtrMult: builder.stopAtrMult,
          target1R: builder.target1R,
          target2R: builder.target2R,
        },
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
                    Config/parameter-driven, backtestable on real history, and runnable live once
                    enabled above.
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
// Builder
// ---------------------------------------------------------------------------

function ConditionRows({
  title,
  conds,
  onChange,
}: {
  title: string;
  conds: StrategyCondition[];
  onChange: (next: StrategyCondition[]) => void;
}) {
  const update = (i: number, c: StrategyCondition) =>
    onChange(conds.map((x, idx) => (idx === i ? c : x)));
  const remove = (i: number) => onChange(conds.filter((_, idx) => idx !== i));
  const add = () => onChange([...conds, emptyCondition()]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm">{title} conditions (ALL must pass)</Label>
        <Button size="sm" variant="outline" onClick={add}>
          <Plus className="h-3 w-3" /> Add
        </Button>
      </div>
      {conds.length === 0 ? (
        <p className="text-xs text-muted-foreground">No conditions — this side is disabled.</p>
      ) : null}
      {conds.map((c, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <Select value={c.left} onValueChange={(v) => update(i, { ...c, left: v as StrategyCondition["left"] })}>
            <SelectTrigger className="w-28 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FEATURE_OPTIONS.map((f) => (
                <SelectItem key={f} value={f}>
                  {f}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={c.op} onValueChange={(v) => update(i, { ...c, op: v as StrategyCondition["op"] })}>
            <SelectTrigger className="w-16 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {OP_OPTIONS.map((o) => (
                <SelectItem key={o} value={o}>
                  {OP_LABEL[o] ?? o}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={c.right.type}
            onValueChange={(v) =>
              update(i, {
                ...c,
                right:
                  v === StrategyConditionOperandType.feature
                    ? { type: StrategyConditionOperandType.feature, feature: StrategyFeatureKey.ema20 }
                    : { type: StrategyConditionOperandType.value, value: 0 },
              })
            }
          >
            <SelectTrigger className="w-24 h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={StrategyConditionOperandType.feature}>feature</SelectItem>
              <SelectItem value={StrategyConditionOperandType.value}>value</SelectItem>
            </SelectContent>
          </Select>
          {c.right.type === StrategyConditionOperandType.feature ? (
            <Select
              value={c.right.feature ?? StrategyFeatureKey.ema20}
              onValueChange={(v) =>
                update(i, {
                  ...c,
                  right: { type: StrategyConditionOperandType.feature, feature: v as StrategyFeatureKey },
                })
              }
            >
              <SelectTrigger className="w-28 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FEATURE_OPTIONS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              type="number"
              className="w-28 h-8"
              value={c.right.value ?? 0}
              onChange={(e) =>
                update(i, {
                  ...c,
                  right: { type: StrategyConditionOperandType.value, value: Number(e.target.value) },
                })
              }
            />
          )}
          <Button size="icon" variant="ghost" onClick={() => remove(i)}>
            <Trash2 className="h-3 w-3 text-destructive" />
          </Button>
        </div>
      ))}
    </div>
  );
}

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

  return (
    <div className="space-y-4">
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
          <Label className="text-xs">Base confidence (0–100)</Label>
          <Input
            type="number"
            value={builder.baseConfidence}
            onChange={(e) => set("baseConfidence", Number(e.target.value))}
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Description</Label>
        <Textarea
          value={builder.description}
          rows={2}
          onChange={(e) => set("description", e.target.value)}
        />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Stop × ATR</Label>
          <Input
            type="number"
            step="0.1"
            value={builder.stopAtrMult}
            onChange={(e) => set("stopAtrMult", Number(e.target.value))}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Target 1 (R)</Label>
          <Input
            type="number"
            step="0.25"
            value={builder.target1R}
            onChange={(e) => set("target1R", Number(e.target.value))}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Target 2 (R)</Label>
          <Input
            type="number"
            step="0.25"
            value={builder.target2R}
            onChange={(e) => set("target2R", Number(e.target.value))}
          />
        </div>
      </div>

      <ConditionRows title="Bull" conds={builder.bull} onChange={(c) => set("bull", c)} />
      <ConditionRows title="Bear" conds={builder.bear} onChange={(c) => set("bear", c)} />

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
