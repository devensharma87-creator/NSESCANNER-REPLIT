import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import {
  useRunGlobalScreener,
  useListGlobalScreenerPresets,
  useListGlobalScreenerPresetLibrary,
  useCreateGlobalScreenerPreset,
  useUpdateGlobalScreenerPreset,
  useDeleteGlobalScreenerPreset,
  useAcknowledgeGlobalScreenerPresetAlerts,
  useRunGlobalScreenerPresetNow,
  getListGlobalScreenerPresetsQueryKey,
  getListGlobalScreenerPresetLibraryQueryKey,
  type GlobalAssetClass,
  type GlobalTimeframe,
  type GlobalScreenerBody,
  type GlobalScreenerPreset,
  type GlobalCuratedScreenerPreset,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Filter as FilterIcon, ArrowUpRight, ArrowDownRight,
  ArrowUp, ArrowDown, Save, Trash2, Pencil, BookmarkCheck,
  Bell, BellOff, Play, AlertCircle, Sparkles, GitFork,
} from "lucide-react";

const ASSET_CLASSES: { id: GlobalAssetClass; label: string }[] = [
  { id: "crypto",    label: "Crypto" },
  { id: "commodity", label: "Commodities" },
  { id: "forex",     label: "Forex" },
  { id: "equity",    label: "Equities" },
  { id: "index",     label: "Indices" },
];

const TIMEFRAMES: GlobalTimeframe[] = ["15m", "1h", "4h", "1d"];

const AUTO_RUN_OPTIONS: Array<{ value: string; label: string; min: number | null }> = [
  { value: "off", label: "Off",      min: null },
  { value: "1",   label: "1 min",    min: 1 },
  { value: "5",   label: "5 min",    min: 5 },
  { value: "15",  label: "15 min",   min: 15 },
  { value: "30",  label: "30 min",   min: 30 },
  { value: "60",  label: "1 hour",   min: 60 },
];

function intervalToOption(min: number | null | undefined): string {
  if (min == null) return "off";
  const exact = AUTO_RUN_OPTIONS.find((o) => o.min === min);
  return exact ? exact.value : "off";
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

type Hit = {
  symbol: string;
  displayName: string;
  assetClass: string;
  price: number | null;
  changePct: number | null;
  volume: number | null;
  rsi14: number | null;
  trend: "up" | "down" | "mixed" | null;
  matched: string[];
};

type SortKey = "symbol" | "price" | "changePct" | "volume" | "rsi14";
type SortDir = "asc" | "desc";

function num(s: string): number | undefined {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : undefined;
}

function strFromNum(v: number | null | undefined): string {
  return v === undefined || v === null ? "" : String(v);
}

export function ScreenerPage() {
  const qc = useQueryClient();
  const { toast } = useToast();

  const [classes, setClasses] = useState<Set<GlobalAssetClass>>(
    new Set(["crypto", "commodity", "forex", "equity", "index"]),
  );
  const [timeframe, setTimeframe] = useState<GlobalTimeframe>("1h");
  const [minChange, setMinChange] = useState<string>("");
  const [maxChange, setMaxChange] = useState<string>("");
  const [minVolume, setMinVolume] = useState<string>("");
  const [minRsi, setMinRsi] = useState<string>("");
  const [maxRsi, setMaxRsi] = useState<string>("");
  const [breakout, setBreakout] = useState<string>("");
  const [breakdown, setBreakdown] = useState<string>("");
  const [min1d, setMin1d] = useState<string>("");
  const [min1w, setMin1w] = useState<string>("");
  const [trendUp, setTrendUp] = useState(false);
  const [trendDown, setTrendDown] = useState(false);
  const [stUp, setStUp] = useState(false);
  const [stDown, setStDown] = useState(false);
  const [sma50Above, setSma50Above] = useState(false);
  const [sma50Below, setSma50Below] = useState(false);
  const [sma200Above, setSma200Above] = useState(false);
  const [sma200Below, setSma200Below] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "changePct", dir: "desc" });

  // Preset UI state — inline name input + active preset highlight.
  const [presetName, setPresetName] = useState("");
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const screener = useRunGlobalScreener();

  // Poll so background-scheduler alerts surface without a manual reload.
  const presetsQuery = useListGlobalScreenerPresets({
    query: {
      queryKey: getListGlobalScreenerPresetsQueryKey(),
      refetchOnWindowFocus: true,
      refetchInterval: 20_000,
    },
  });

  // Curated, read-only "Examples" library. Static server-side, so fetch
  // once and never refetch.
  const libraryQuery = useListGlobalScreenerPresetLibrary({
    query: {
      queryKey: getListGlobalScreenerPresetLibraryQueryKey(),
      staleTime: Infinity,
      refetchOnWindowFocus: false,
    },
  });

  const invalidatePresets = () =>
    qc.invalidateQueries({ queryKey: getListGlobalScreenerPresetsQueryKey() });

  const createPreset = useCreateGlobalScreenerPreset({
    mutation: {
      onSuccess: (row) => {
        invalidatePresets();
        setActivePresetId(row.id);
        setPresetName("");
        toast({ title: "Preset saved", description: `"${row.name}" is ready to one-click.` });
      },
      onError: (err: unknown) => {
        toast({
          title: "Could not save preset",
          description: (err as Error)?.message ?? "Please try a different name.",
          variant: "destructive",
        });
      },
    },
  });

  const updatePreset = useUpdateGlobalScreenerPreset({
    mutation: {
      onSuccess: () => {
        invalidatePresets();
        setRenamingId(null);
        setRenameValue("");
      },
      onError: (err: unknown) => {
        toast({
          title: "Rename failed",
          description: (err as Error)?.message ?? "Pick a unique name.",
          variant: "destructive",
        });
      },
    },
  });

  const deletePreset = useDeleteGlobalScreenerPreset({
    mutation: {
      onSuccess: (_data, vars) => {
        invalidatePresets();
        if (activePresetId === vars.id) setActivePresetId(null);
      },
    },
  });

  const acknowledgeAlerts = useAcknowledgeGlobalScreenerPresetAlerts({
    mutation: { onSuccess: () => invalidatePresets() },
  });

  const runPresetNow = useRunGlobalScreenerPresetNow({
    mutation: {
      onSuccess: () => {
        invalidatePresets();
        toast({ title: "Preset run triggered", description: "Refreshing in a moment…" });
      },
      onError: (err: unknown) => {
        toast({
          title: "Run failed",
          description: (err as Error)?.message ?? "Could not run preset.",
          variant: "destructive",
        });
      },
    },
  });

  function buildBody(): GlobalScreenerBody {
    return {
      assetClasses: Array.from(classes),
      timeframe,
      filters: {
        minChangePct: num(minChange),
        maxChangePct: num(maxChange),
        minVolume: num(minVolume),
        minRsi14: num(minRsi),
        maxRsi14: num(maxRsi),
        breakoutLookback: num(breakout),
        breakdownLookback: num(breakdown),
        min1dChangePct: num(min1d),
        min1wChangePct: num(min1w),
        trendUp: trendUp || undefined,
        trendDown: trendDown || undefined,
        requireSupertrendUp: stUp || undefined,
        requireSupertrendDown: stDown || undefined,
        priceAboveSma50: sma50Above || undefined,
        priceBelowSma50: sma50Below || undefined,
        priceAboveSma200: sma200Above || undefined,
        priceBelowSma200: sma200Below || undefined,
      },
      limit: 25,
    };
  }

  function run() {
    screener.mutate({ data: buildBody() });
  }

  // Replay a screener body (saved preset or curated example) into the form
  // and re-run. Pass null for activeId when the body shouldn't highlight a
  // sidebar row (e.g. curated apply, ad-hoc edits).
  function applyBody(body: GlobalScreenerBody, activeId: string | null) {
    setClasses(new Set(body.assetClasses));
    setTimeframe(body.timeframe ?? "1h");
    const f = body.filters ?? {};
    setMinChange(strFromNum(f.minChangePct));
    setMaxChange(strFromNum(f.maxChangePct));
    setMinVolume(strFromNum(f.minVolume));
    setMinRsi(strFromNum(f.minRsi14));
    setMaxRsi(strFromNum(f.maxRsi14));
    setBreakout(strFromNum(f.breakoutLookback));
    setBreakdown(strFromNum(f.breakdownLookback));
    setMin1d(strFromNum(f.min1dChangePct));
    setMin1w(strFromNum(f.min1wChangePct));
    setTrendUp(!!f.trendUp);
    setTrendDown(!!f.trendDown);
    setStUp(!!f.requireSupertrendUp);
    setStDown(!!f.requireSupertrendDown);
    setSma50Above(!!f.priceAboveSma50);
    setSma50Below(!!f.priceBelowSma50);
    setSma200Above(!!f.priceAboveSma200);
    setSma200Below(!!f.priceBelowSma200);
    setActivePresetId(activeId);
    screener.mutate({ data: body });
  }

  function applyPreset(preset: GlobalScreenerPreset) {
    applyBody(preset.body, preset.id);
  }

  // Fork = create a personal, editable copy of a curated example. Apply
  // the body first so once the create succeeds and onSuccess marks the
  // new row active, the form actually matches it (otherwise Update would
  // overwrite the new preset with whatever filters were on screen).
  function onForkCuratedPreset(p: GlobalCuratedScreenerPreset) {
    applyBody(p.body, null);
    createPreset.mutate({ data: { name: p.name, body: p.body } });
  }

  function onApplyCuratedPreset(p: GlobalCuratedScreenerPreset) {
    applyBody(p.body, null);
  }

  function onSavePreset() {
    const name = presetName.trim();
    if (!name) {
      toast({ title: "Name required", description: "Give your preset a short, memorable name." });
      return;
    }
    if (classes.size === 0) {
      toast({ title: "Pick at least one asset class first" });
      return;
    }
    createPreset.mutate({ data: { name, body: buildBody() } });
  }

  function onUpdateActivePreset() {
    if (!activePresetId) return;
    updatePreset.mutate({ id: activePresetId, data: { body: buildBody() } });
    toast({ title: "Preset updated" });
  }

  function onCommitRename(id: string) {
    const next = renameValue.trim();
    if (!next) { setRenamingId(null); return; }
    updatePreset.mutate({ id, data: { name: next } });
  }

  // Toast once per (presetId, lastNewHitsAt) pair. Prime on first load so
  // pre-existing alerts don't blast toasts on mount.
  const seenAlertKeysRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);
  useEffect(() => {
    if (presetsQuery.data == null) return;
    const items = presetsQuery.data.items;
    if (!primedRef.current) {
      for (const p of items) {
        if (p.lastNewHitsAt && p.lastNewHits.length > 0) {
          seenAlertKeysRef.current.add(`${p.id}:${p.lastNewHitsAt}`);
        }
      }
      primedRef.current = true;
      return;
    }
    for (const p of items) {
      if (!p.lastNewHitsAt || p.lastNewHits.length === 0) continue;
      const key = `${p.id}:${p.lastNewHitsAt}`;
      if (seenAlertKeysRef.current.has(key)) continue;
      seenAlertKeysRef.current.add(key);
      const symbols = p.lastNewHits.map((h) => h.symbol).slice(0, 4).join(", ");
      const more = p.lastNewHits.length > 4 ? ` (+${p.lastNewHits.length - 4} more)` : "";
      toast({
        title: `${p.lastNewHits.length} new hit${p.lastNewHits.length === 1 ? "" : "s"}: ${p.name}`,
        description: `${symbols}${more}`,
      });
    }
  }, [presetsQuery.data, toast]);

  // Clear "active preset" highlight whenever the user edits filter inputs so
  // the indicator reflects whether the form still matches the saved version.
  useEffect(() => {
    if (activePresetId == null) return;
    setActivePresetId(null);
    // We intentionally only depend on filter inputs (not activePresetId)
    // so the effect runs on the next user mutation, not on apply.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    timeframe, minChange, maxChange, minVolume, minRsi, maxRsi, breakout,
    breakdown, min1d, min1w, trendUp, trendDown, stUp, stDown,
    sma50Above, sma50Below, sma200Above, sma200Below,
  ]);

  const hits: Hit[] = useMemo(() => {
    const rows = (screener.data?.hits ?? []).slice() as Hit[];
    const mul = sort.dir === "asc" ? 1 : -1;
    const get = (h: Hit): number | string => {
      switch (sort.key) {
        case "symbol":    return h.symbol;
        case "price":     return h.price ?? Number.NEGATIVE_INFINITY;
        case "changePct": return h.changePct ?? Number.NEGATIVE_INFINITY;
        case "volume":    return h.volume ?? Number.NEGATIVE_INFINITY;
        case "rsi14":     return h.rsi14 ?? Number.NEGATIVE_INFINITY;
      }
    };
    rows.sort((a, b) => {
      const va = get(a), vb = get(b);
      if (typeof va === "string" && typeof vb === "string") return va.localeCompare(vb) * mul;
      return ((va as number) - (vb as number)) * mul;
    });
    return rows;
  }, [screener.data, sort]);

  function onSort(k: SortKey) {
    setSort(prev => prev.key === k ? { key: k, dir: prev.dir === "asc" ? "desc" : "asc" } : { key: k, dir: k === "symbol" ? "asc" : "desc" });
  }

  const presets = presetsQuery.data?.items ?? [];
  const library = libraryQuery.data?.items ?? [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <FilterIcon className="h-5 w-5 text-primary" /> Screener
        </h1>
        <p className="text-sm text-muted-foreground">
          Find movers across the global universe by % change, volume, RSI, breakouts, trend, and price-vs-MA.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[16rem_1fr] gap-4">
        {/* My Presets sidebar */}
        <Card className="p-3 space-y-3 h-fit lg:sticky lg:top-4">
          <div className="flex items-center justify-between">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">My presets</Label>
            <Badge variant="outline" className="text-[10px]">{presets.length}</Badge>
          </div>

          <div className="space-y-1.5">
            <Input
              placeholder="Preset name…"
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              className="h-8 text-sm"
              data-testid="input-preset-name"
            />
            <div className="flex gap-1.5">
              <Button
                size="sm"
                onClick={onSavePreset}
                disabled={createPreset.isPending || !presetName.trim()}
                className="flex-1 h-8"
                data-testid="button-save-preset"
              >
                {createPreset.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                Save
              </Button>
              {activePresetId && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onUpdateActivePreset}
                  disabled={updatePreset.isPending}
                  className="h-8"
                  title="Overwrite active preset with current filters"
                  data-testid="button-update-preset"
                >
                  Update
                </Button>
              )}
            </div>
          </div>

          <div className="border-t -mx-3" />

          {presetsQuery.isLoading ? (
            <div className="text-xs text-muted-foreground py-2">Loading…</div>
          ) : presets.length === 0 ? (
            <div className="text-xs text-muted-foreground py-2 leading-snug">
              No saved presets yet. Configure your filters and hit <span className="font-medium">Save</span> to build a one-click library — or fork an example below to get started.
            </div>
          ) : (
            <ul className="space-y-1.5" data-testid="list-presets">
              {presets.map((p) => (
                <PresetRow
                  key={p.id}
                  preset={p}
                  active={activePresetId === p.id}
                  isRenaming={renamingId === p.id}
                  renameValue={renameValue}
                  setRenameValue={setRenameValue}
                  onStartRename={() => { setRenamingId(p.id); setRenameValue(p.name); }}
                  onCancelRename={() => { setRenamingId(null); setRenameValue(""); }}
                  onCommitRename={() => onCommitRename(p.id)}
                  onApply={() => applyPreset(p)}
                  onDelete={() => deletePreset.mutate({ id: p.id })}
                  onIntervalChange={(min) => updatePreset.mutate({ id: p.id, data: { autoRunIntervalMin: min } })}
                  onAcknowledge={() => acknowledgeAlerts.mutate({ id: p.id })}
                  onRunNow={() => runPresetNow.mutate({ id: p.id })}
                  intervalUpdating={updatePreset.isPending}
                  runNowPending={runPresetNow.isPending}
                />
              ))}
            </ul>
          )}

          {/* Examples — read-only curated starter library. Fork creates an
              editable personal copy in "My presets". */}
          <div className="border-t -mx-3" />
          <div className="flex items-center justify-between">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1">
              <Sparkles className="h-3 w-3" /> Examples
            </Label>
            <Badge variant="outline" className="text-[10px]">{library.length}</Badge>
          </div>
          {libraryQuery.isLoading ? (
            <div className="text-xs text-muted-foreground py-2">Loading…</div>
          ) : library.length === 0 ? null : (
            <ul className="space-y-1.5" data-testid="list-curated-presets">
              {library.map((p) => (
                <CuratedPresetRow
                  key={p.slug}
                  preset={p}
                  onApply={() => onApplyCuratedPreset(p)}
                  onFork={() => onForkCuratedPreset(p)}
                  forkPending={createPreset.isPending}
                />
              ))}
            </ul>
          )}
        </Card>

        {/* Filter form + results */}
        <div className="space-y-4 min-w-0">
          <Card className="p-4 space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <div>
                <Label className="text-xs text-muted-foreground">Asset classes</Label>
                <div className="flex items-center gap-2 mt-1">
                  {ASSET_CLASSES.map((c) => (
                    <label key={c.id} className="flex items-center gap-1.5 text-sm cursor-pointer">
                      <Checkbox
                        checked={classes.has(c.id)}
                        onCheckedChange={(v) => {
                          setClasses((prev) => {
                            const next = new Set(prev);
                            if (v) next.add(c.id); else next.delete(c.id);
                            return next;
                          });
                        }}
                        data-testid={`check-class-${c.id}`}
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Timeframe</Label>
                <div className="flex items-center gap-1 mt-1">
                  {TIMEFRAMES.map((tf) => (
                    <Button
                      key={tf}
                      size="sm"
                      variant={timeframe === tf ? "default" : "outline"}
                      onClick={() => setTimeframe(tf)}
                      className="h-7 px-2 text-xs"
                      data-testid={`btn-screener-tf-${tf}`}
                    >{tf}</Button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <NumField label="Min Δ% (live)"  value={minChange} onChange={setMinChange} placeholder="e.g. 2" />
              <NumField label="Max Δ% (live)"  value={maxChange} onChange={setMaxChange} placeholder="e.g. -2" />
              <NumField label="Min volume"     value={minVolume} onChange={setMinVolume} placeholder="e.g. 1000000" />
              <NumField label="Min RSI(14)"    value={minRsi} onChange={setMinRsi} placeholder="0-100" />
              <NumField label="Max RSI(14)"    value={maxRsi} onChange={setMaxRsi} placeholder="0-100" />
              <NumField label="Min 1d Δ%"      value={min1d} onChange={setMin1d} placeholder="e.g. 5 or -5" />
              <NumField label="Min 1w Δ%"      value={min1w} onChange={setMin1w} placeholder="e.g. 10" />
              <NumField label="Breakout look-back (bars)"  value={breakout} onChange={setBreakout} placeholder="e.g. 20" />
              <NumField label="Breakdown look-back (bars)" value={breakdown} onChange={setBreakdown} placeholder="e.g. 20" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Trend (EMA cascade)</Label>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <Checkbox checked={trendUp} onCheckedChange={(v) => { setTrendUp(!!v); if (v) setTrendDown(false); }} data-testid="check-trendup" />
                    Trend up (EMA 20 &gt; 50 &gt; 200)
                  </label>
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <Checkbox checked={trendDown} onCheckedChange={(v) => { setTrendDown(!!v); if (v) setTrendUp(false); }} data-testid="check-trenddown" />
                    Trend down (EMA 20 &lt; 50 &lt; 200)
                  </label>
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <Checkbox checked={stUp} onCheckedChange={(v) => { setStUp(!!v); if (v) setStDown(false); }} data-testid="check-stup" />
                    Supertrend up
                  </label>
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <Checkbox checked={stDown} onCheckedChange={(v) => { setStDown(!!v); if (v) setStUp(false); }} data-testid="check-stdown" />
                    Supertrend down
                  </label>
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Price vs moving average</Label>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <Checkbox checked={sma50Above} onCheckedChange={(v) => { setSma50Above(!!v); if (v) setSma50Below(false); }} data-testid="check-sma50-above" />
                    Price &gt; SMA50
                  </label>
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <Checkbox checked={sma50Below} onCheckedChange={(v) => { setSma50Below(!!v); if (v) setSma50Above(false); }} data-testid="check-sma50-below" />
                    Price &lt; SMA50
                  </label>
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <Checkbox checked={sma200Above} onCheckedChange={(v) => { setSma200Above(!!v); if (v) setSma200Below(false); }} data-testid="check-sma200-above" />
                    Price &gt; SMA200
                  </label>
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <Checkbox checked={sma200Below} onCheckedChange={(v) => { setSma200Below(!!v); if (v) setSma200Above(false); }} data-testid="check-sma200-below" />
                    Price &lt; SMA200
                  </label>
                </div>
              </div>
            </div>

            <div>
              <Button onClick={run} disabled={screener.isPending || classes.size === 0} data-testid="button-run-screener">
                {screener.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Run screener
              </Button>
            </div>
          </Card>

          {screener.error && (
            <Card className="p-3 text-sm text-destructive">
              Screener failed: {(screener.error as Error)?.message ?? "unknown error"}
            </Card>
          )}

          {screener.data && (
            <Card className="overflow-hidden">
              <div className="px-4 py-2 border-b text-xs text-muted-foreground">
                {hits.length} hits · evaluated {screener.data.evaluatedCandidates} candidates
                {screener.data.indicatorEvaluated && " · indicators applied"}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <SortHeader label="Symbol" k="symbol" current={sort} onChange={onSort} />
                      <th className="text-left px-3 py-2 font-medium">Name</th>
                      <th className="text-left px-3 py-2 font-medium">Class</th>
                      <SortHeader label="Price" k="price" current={sort} onChange={onSort} align="right" />
                      <SortHeader label="Δ%" k="changePct" current={sort} onChange={onSort} align="right" />
                      <SortHeader label="Volume" k="volume" current={sort} onChange={onSort} align="right" />
                      <SortHeader label="RSI 14" k="rsi14" current={sort} onChange={onSort} align="right" />
                      <th className="text-left px-3 py-2 font-medium">Matched</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hits.map((h) => {
                      const up = (h.changePct ?? 0) >= 0;
                      return (
                        <tr key={h.symbol} className="border-t hover:bg-accent/30" data-testid={`hit-${h.symbol}`}>
                          <td className="px-3 py-2 font-mono">
                            <Link href={`/i/${h.symbol}`} className="text-primary hover:underline" data-testid={`link-symbol-${h.symbol}`}>{h.symbol}</Link>
                          </td>
                          <td className="px-3 py-2">{h.displayName}</td>
                          <td className="px-3 py-2"><Badge variant="outline" className="text-xs">{h.assetClass}</Badge></td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{h.price?.toLocaleString(undefined, { maximumFractionDigits: 4 }) ?? "—"}</td>
                          <td className={`px-3 py-2 text-right font-mono tabular-nums ${up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                            <span className="inline-flex items-center gap-0.5 justify-end">
                              {h.changePct != null && (up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />)}
                              {h.changePct != null ? `${h.changePct >= 0 ? "+" : ""}${h.changePct.toFixed(2)}%` : "—"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">{fmtVol(h.volume)}</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{h.rsi14 != null ? h.rsi14.toFixed(1) : "—"}</td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{h.matched.join(" · ")}</td>
                        </tr>
                      );
                    })}
                    {hits.length === 0 && (
                      <tr><td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">No matches.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function fmtVol(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || v === 0) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

function SortHeader(props: {
  label: string;
  k: SortKey;
  current: { key: SortKey; dir: SortDir };
  onChange: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = props.current.key === props.k;
  const Icon = active ? (props.current.dir === "asc" ? ArrowUp : ArrowDown) : null;
  return (
    <th className={`px-3 py-2 font-medium ${props.align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => props.onChange(props.k)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${active ? "text-foreground" : ""}`}
        data-testid={`sort-${props.k}`}
      >
        {props.label}
        {Icon && <Icon className="h-3 w-3" />}
      </button>
    </th>
  );
}

function PresetRow(props: {
  preset: GlobalScreenerPreset;
  active: boolean;
  isRenaming: boolean;
  renameValue: string;
  setRenameValue: (v: string) => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onCommitRename: () => void;
  onApply: () => void;
  onDelete: () => void;
  onIntervalChange: (min: number | null) => void;
  onAcknowledge: () => void;
  onRunNow: () => void;
  intervalUpdating: boolean;
  runNowPending: boolean;
}) {
  const { preset: p, active, isRenaming } = props;
  const newHitCount = p.lastNewHits.length;
  const hasAlerts = newHitCount > 0;
  const autoOn = p.autoRunIntervalMin != null;
  return (
    <li
      className={`group rounded border px-2 py-1.5 text-sm space-y-1 ${
        active ? "border-primary bg-primary/5" : hasAlerts ? "border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20" : "border-transparent hover:bg-accent/50"
      }`}
      data-testid={`preset-${p.id}`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        {isRenaming ? (
          <Input
            value={props.renameValue}
            onChange={(e) => props.setRenameValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") props.onCommitRename();
              if (e.key === "Escape") props.onCancelRename();
            }}
            onBlur={props.onCommitRename}
            autoFocus
            className="h-6 text-xs"
            data-testid={`input-rename-${p.id}`}
          />
        ) : (
          <>
            <button
              type="button"
              onClick={props.onApply}
              className="flex-1 min-w-0 text-left truncate flex items-center gap-1.5"
              title={`${p.body.assetClasses.join(", ")} · ${p.body.timeframe ?? "1h"}`}
              data-testid={`button-load-preset-${p.id}`}
            >
              {active && <BookmarkCheck className="h-3.5 w-3.5 text-primary shrink-0" />}
              <span className="truncate">{p.name}</span>
            </button>
            {hasAlerts && (
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="shrink-0 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium bg-amber-500/15 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25"
                    title={`${newHitCount} new hit${newHitCount === 1 ? "" : "s"} since last check`}
                    data-testid={`button-alerts-${p.id}`}
                  >
                    <Bell className="h-3 w-3" />
                    {newHitCount}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-72 p-2 space-y-1.5" data-testid={`popover-alerts-${p.id}`}>
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium flex items-center gap-1">
                      <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
                      New hits
                    </span>
                    <span className="text-muted-foreground">{formatRelative(p.lastNewHitsAt)}</span>
                  </div>
                  <ul className="space-y-1 max-h-64 overflow-auto">
                    {p.lastNewHits.map((h) => {
                      const up = (h.changePct ?? 0) >= 0;
                      return (
                        <li key={h.symbol} className="flex items-center justify-between gap-2 text-xs">
                          <Link href={`/i/${h.symbol}`} className="font-mono text-primary hover:underline truncate" data-testid={`alert-symbol-${p.id}-${h.symbol}`}>
                            {h.symbol}
                          </Link>
                          <span className="text-muted-foreground truncate flex-1">{h.displayName}</span>
                          <span className={`font-mono tabular-nums ${up ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                            {h.changePct != null ? `${h.changePct >= 0 ? "+" : ""}${h.changePct.toFixed(2)}%` : "—"}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  <Button
                    size="sm"
                    variant="outline"
                    className="w-full h-7 text-xs"
                    onClick={props.onAcknowledge}
                    data-testid={`button-ack-${p.id}`}
                  >
                    Mark as seen
                  </Button>
                </PopoverContent>
              </Popover>
            )}
            <button
              type="button"
              onClick={props.onStartRename}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground"
              title="Rename"
              data-testid={`button-rename-preset-${p.id}`}
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={props.onDelete}
              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
              title="Delete"
              data-testid={`button-delete-preset-${p.id}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
      {!isRenaming && (
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Select
            value={intervalToOption(p.autoRunIntervalMin)}
            onValueChange={(v) => {
              const opt = AUTO_RUN_OPTIONS.find((o) => o.value === v);
              if (opt) props.onIntervalChange(opt.min);
            }}
            disabled={props.intervalUpdating}
          >
            <SelectTrigger
              className="h-6 px-1.5 text-[11px] w-[88px] gap-1"
              data-testid={`select-autorun-${p.id}`}
            >
              <span className="inline-flex items-center gap-1">
                {autoOn ? <Bell className="h-3 w-3 text-primary" /> : <BellOff className="h-3 w-3" />}
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent>
              {AUTO_RUN_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value} className="text-xs" data-testid={`autorun-option-${p.id}-${o.value}`}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="truncate" title={p.lastRunError ?? undefined}>
            {p.lastRunError ? (
              <span className="text-destructive">err · {formatRelative(p.lastRunAt)}</span>
            ) : (
              <>last: {formatRelative(p.lastRunAt)}</>
            )}
          </span>
          <button
            type="button"
            onClick={props.onRunNow}
            disabled={props.runNowPending}
            className="ml-auto p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-50"
            title="Run now"
            data-testid={`button-run-now-${p.id}`}
          >
            {props.runNowPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          </button>
        </div>
      )}
    </li>
  );
}

function CuratedPresetRow(props: {
  preset: GlobalCuratedScreenerPreset;
  onApply: () => void;
  onFork: () => void;
  forkPending: boolean;
}) {
  const { preset: p } = props;
  const classChip =
    p.body.assetClasses.length === 1
      ? (ASSET_CLASSES.find((c) => c.id === p.body.assetClasses[0])?.label ?? p.body.assetClasses[0])
      : `${p.body.assetClasses.length} classes`;
  const tf = p.body.timeframe ?? "1h";
  return (
    <li
      className="group rounded border border-dashed border-muted-foreground/30 px-2 py-1.5 text-sm space-y-1 hover:bg-accent/30"
      data-testid={`curated-preset-${p.slug}`}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <button
          type="button"
          onClick={props.onApply}
          className="flex-1 min-w-0 text-left truncate"
          title={p.description}
          data-testid={`button-load-curated-${p.slug}`}
        >
          <span className="truncate">{p.name}</span>
        </button>
        <button
          type="button"
          onClick={props.onFork}
          disabled={props.forkPending}
          className="opacity-0 group-hover:opacity-100 inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
          title="Fork into My presets (editable copy)"
          data-testid={`button-fork-curated-${p.slug}`}
        >
          {props.forkPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <GitFork className="h-3 w-3" />}
          Fork
        </button>
      </div>
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Badge variant="outline" className="text-[10px] py-0 h-4 px-1">{classChip}</Badge>
        <Badge variant="outline" className="text-[10px] py-0 h-4 px-1">{tf}</Badge>
        <span className="ml-1 truncate" title={p.description}>{p.description}</span>
      </div>
    </li>
  );
}

function NumField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1"
        data-testid={`input-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
      />
    </div>
  );
}
