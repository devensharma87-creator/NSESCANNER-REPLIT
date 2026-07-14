import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Save, Search, X } from "lucide-react";
import {
  searchChartInstruments,
  getSearchChartInstrumentsQueryKey,
  type ChartInstrument,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import type { RawHolding } from "@/lib/portfolio/types";
import { fmtINR } from "./format";

/** Debounce a fast-changing value so we don't fire a search on every keystroke. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return v;
}

/** Render a number field as an editable string (blank = unset), never "0"/"NaN". */
function numToStr(n: number | undefined): string {
  return n != null && Number.isFinite(n) ? String(n) : "";
}

interface FormState {
  symbol: string;
  name: string;
  sector: string;
  exchange: string;
  date: string;
  qty: string;
  rate: string;
  broker: string;
  tag: string;
  isin: string;
  dividendReceived: string;
  realisedPnl: string;
  manualCmp: string;
  notes: string;
}

function fromHolding(h: RawHolding): FormState {
  return {
    symbol: h.symbol,
    name: h.name ?? "",
    sector: h.sector ?? "",
    exchange: h.exchange ?? "",
    date: h.purchaseDate ?? "",
    qty: numToStr(h.qty),
    rate: numToStr(h.rate),
    broker: h.broker ?? "",
    tag: h.tag ?? "",
    isin: h.isin ?? "",
    dividendReceived: numToStr(h.dividendReceived),
    realisedPnl: numToStr(h.realisedPnl),
    manualCmp: numToStr(h.manualCmp),
    notes: h.notes ?? "",
  };
}

/**
 * Edit every field of a single holding. CMP is special-cased: it is read-only
 * (auto-fetched) for scrips with a live quote, and only editable as a manual
 * fallback for scrips the data providers can't price. Advisory fields
 * (targetPrice/stopLoss) are preserved untouched — they are never editable here.
 */
export function EditHoldingModal({
  open,
  onOpenChange,
  holding,
  liveCmp,
  liveAvailable,
  existingSymbols = [],
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** The holding being edited, or null when nothing is selected. */
  holding: RawHolding | null;
  /** The genuinely-fetched live CMP, shown read-only when a live quote exists. */
  liveCmp: number | null;
  /** True when a live quote resolved — manual CMP entry is then disabled. */
  liveAvailable: boolean;
  /** Symbols of OTHER holdings (excluding the one being edited), for dedupe. */
  existingSymbols?: string[];
  onSave: (originalSymbol: string, updated: RawHolding) => void;
}) {
  const [f, setF] = useState<FormState>(() =>
    holding ? fromHolding(holding) : fromHolding({ symbol: "", name: "", qty: 0, rate: 0 }),
  );
  const [err, setErr] = useState<string | null>(null);

  // Re-seed the form whenever a new holding is opened for editing.
  const originalSymbol = holding?.symbol ?? "";
  useEffect(() => {
    if (open && holding) {
      setF(fromHolding(holding));
      setErr(null);
      setPicked(true);
      setSymbolOpen(false);
    }
  }, [open, holding]);

  const ownedSet = useMemo(
    () => new Set(existingSymbols.map(s => s.trim().toUpperCase())),
    [existingSymbols],
  );

  // ----- Live instrument autocomplete for the "Symbol" field (mirrors Add) -----
  const [symbolOpen, setSymbolOpen] = useState(false);
  const [picked, setPicked] = useState(true);
  const symbolBoxRef = useRef<HTMLDivElement>(null);
  const debouncedSymbol = useDebounced(f.symbol.trim(), 250);
  const searchQ = useQuery({
    enabled: open && symbolOpen && !picked && debouncedSymbol.length >= 1,
    queryKey: getSearchChartInstrumentsQueryKey({ q: debouncedSymbol || undefined }),
    queryFn: () => searchChartInstruments({ q: debouncedSymbol || undefined }),
    staleTime: 60_000,
  });
  const instruments: ChartInstrument[] = searchQ.data?.instruments ?? [];

  useEffect(() => {
    if (!open) setSymbolOpen(false);
  }, [open]);

  useEffect(() => {
    if (!open || !symbolOpen) return;
    function onDown(e: MouseEvent) {
      if (symbolBoxRef.current && !symbolBoxRef.current.contains(e.target as Node)) {
        setSymbolOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, symbolOpen]);

  function pickInstrument(inst: ChartInstrument) {
    setF(prev => ({
      ...prev,
      symbol: inst.symbol,
      name: prev.name.trim() ? prev.name : inst.name,
      sector: prev.sector.trim() ? prev.sector : inst.type,
      exchange: prev.exchange.trim() ? prev.exchange : (inst.exchange ?? prev.exchange),
    }));
    setPicked(true);
    setSymbolOpen(false);
    setErr(null);
  }

  function up<K extends keyof FormState>(key: K, value: string) {
    setF(prev => ({ ...prev, [key]: value }));
  }

  function submit() {
    if (!holding) return;
    const symbol = f.symbol.trim().toUpperCase();
    const qty = Number(f.qty);
    const rate = Number(f.rate);
    if (!symbol) return setErr("Symbol is required.");
    if (ownedSet.has(symbol)) return setErr(`Another holding already uses ${symbol}.`);
    if (!Number.isFinite(qty) || qty <= 0) return setErr("Qty must be a positive number.");
    if (!Number.isFinite(rate) || rate < 0) return setErr("Rate must be zero or positive.");

    // Manual CMP only applies (and is only editable) when there is no live quote.
    let manualCmp: number | undefined;
    if (liveAvailable) {
      // Preserve any previously-stored manual price untouched; it stays unused
      // while a live quote is available.
      manualCmp = holding.manualCmp;
    } else if (f.manualCmp.trim()) {
      const m = Number(f.manualCmp);
      if (!Number.isFinite(m) || m <= 0) return setErr("Manual CMP must be a positive number.");
      manualCmp = m;
    } else {
      manualCmp = undefined;
    }

    setErr(null);
    const updated: RawHolding = {
      symbol,
      name: f.name.trim() || symbol,
      sector: f.sector.trim() || undefined,
      exchange: f.exchange.trim() || undefined,
      purchaseDate: f.date.trim() || undefined,
      qty,
      rate,
      broker: f.broker.trim() || undefined,
      tag: f.tag.trim() || undefined,
      isin: f.isin.trim() || undefined,
      notes: f.notes.trim() || undefined,
      dividendReceived: f.dividendReceived.trim() ? Number(f.dividendReceived) : undefined,
      realisedPnl: f.realisedPnl.trim() ? Number(f.realisedPnl) : undefined,
      manualCmp,
      // Advisory fields are never edited here — carry them through unchanged.
      targetPrice: holding.targetPrice,
      stopLoss: holding.stopLoss,
    };
    onSave(originalSymbol, updated);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="edit-holding-modal">
        <DialogHeader>
          <DialogTitle>Edit Holding</DialogTitle>
          <DialogDescription>
            Update any field for this holding. Changes stay in this session until you save the
            portfolio.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label className="text-[11px] font-medium text-muted-foreground">Symbol</label>
          <div ref={symbolBoxRef} className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search symbol — type e.g. tata, hdfc, reliance…"
              value={f.symbol}
              onChange={e => {
                up("symbol", e.target.value);
                setPicked(false);
                setSymbolOpen(true);
              }}
              onFocus={() => setSymbolOpen(true)}
              autoComplete="off"
              className="pl-8 pr-8 font-mono uppercase"
              data-testid="edit-symbol"
            />
            {f.symbol && (
              <button
                type="button"
                onClick={() => {
                  up("symbol", "");
                  setPicked(false);
                  setSymbolOpen(true);
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear symbol"
              >
                <X className="h-4 w-4" />
              </button>
            )}
            {symbolOpen && !picked && debouncedSymbol.length >= 1 && (
              <div
                className="absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-lg"
                data-testid="edit-symbol-results"
              >
                {searchQ.isLoading && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>
                )}
                {!searchQ.isLoading && searchQ.isError && (
                  <div className="px-3 py-2 text-xs text-amber-400">
                    Search unavailable — you can still type the exact symbol manually.
                  </div>
                )}
                {!searchQ.isLoading && !searchQ.isError && instruments.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    No matching instrument. Type the exact NSE symbol to keep it.
                  </div>
                )}
                {instruments.map(inst => {
                  const owned = ownedSet.has(inst.symbol.toUpperCase());
                  return (
                    <button
                      key={`${inst.segment}:${inst.exchange ?? ""}:${inst.symbol}`}
                      type="button"
                      onClick={() => pickInstrument(inst)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
                      data-testid={`edit-result-${inst.symbol}`}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="flex items-center gap-1.5">
                          <span className="font-mono font-semibold">{inst.symbol}</span>
                          {owned && (
                            <span className="rounded bg-amber-500/15 px-1 text-[9px] font-medium uppercase text-amber-500">
                              In portfolio
                            </span>
                          )}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">{inst.name}</span>
                      </span>
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {inst.exchange ? `${inst.exchange} · ${inst.type}` : inst.type}
                      </Badge>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Name">
              <Input value={f.name} onChange={e => up("name", e.target.value)} data-testid="edit-name" />
            </Field>
            <Field label="Sector">
              <Input value={f.sector} onChange={e => up("sector", e.target.value)} data-testid="edit-sector" />
            </Field>
            <Field label="Exchange">
              <Input value={f.exchange} onChange={e => up("exchange", e.target.value)} data-testid="edit-exchange" />
            </Field>
            <Field label="Purchase date">
              <Input type="date" value={f.date} onChange={e => up("date", e.target.value)} data-testid="edit-date" />
            </Field>
            <Field label="Qty">
              <Input type="number" value={f.qty} onChange={e => up("qty", e.target.value)} data-testid="edit-qty" />
            </Field>
            <Field label="Avg rate (₹)">
              <Input type="number" value={f.rate} onChange={e => up("rate", e.target.value)} data-testid="edit-rate" />
            </Field>

            {/* CMP — read-only when live, editable manual fallback otherwise. */}
            <Field
              label={liveAvailable ? "CMP (live)" : "CMP (manual)"}
              span2={false}
            >
              {liveAvailable ? (
                <div
                  className="flex h-9 items-center rounded-md border border-border bg-muted/40 px-3 font-mono text-sm text-muted-foreground"
                  title="Live quote — auto-fetched and not editable."
                  data-testid="edit-cmp-live"
                >
                  {liveCmp != null ? fmtINR(liveCmp, 2) : "live"}
                </div>
              ) : (
                <Input
                  type="number"
                  placeholder="Enter price (no live quote)"
                  value={f.manualCmp}
                  onChange={e => up("manualCmp", e.target.value)}
                  data-testid="edit-manual-cmp"
                />
              )}
            </Field>
            <Field label="ISIN">
              <Input value={f.isin} onChange={e => up("isin", e.target.value)} data-testid="edit-isin" />
            </Field>
            <Field label="Broker">
              <Input value={f.broker} onChange={e => up("broker", e.target.value)} data-testid="edit-broker" />
            </Field>
            <Field label="Tag">
              <Input value={f.tag} onChange={e => up("tag", e.target.value)} data-testid="edit-tag" />
            </Field>
            <Field label="Dividend received (₹)">
              <Input
                type="number"
                value={f.dividendReceived}
                onChange={e => up("dividendReceived", e.target.value)}
                data-testid="edit-dividend"
              />
            </Field>
            <Field label="Realised P&L (₹)">
              <Input
                type="number"
                value={f.realisedPnl}
                onChange={e => up("realisedPnl", e.target.value)}
                data-testid="edit-realised"
              />
            </Field>
          </div>

          <Field label="Notes" span2>
            <Input value={f.notes} onChange={e => up("notes", e.target.value)} data-testid="edit-notes" />
          </Field>

          {liveAvailable && (
            <p className="text-[10px] text-muted-foreground">
              A live quote is available for this scrip, so CMP is fetched automatically and cannot be
              set manually.
            </p>
          )}

          {err && (
            <p className="flex items-center gap-1 text-[11px] text-red-400" data-testid="edit-error">
              <AlertTriangle className="h-3 w-3" /> {err}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={submit} data-testid="confirm-edit">
              <Save className="mr-1 h-3.5 w-3.5" /> Save changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label,
  children,
  span2 = false,
}: {
  label: string;
  children: React.ReactNode;
  span2?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-1 ${span2 ? "col-span-2" : ""}`}>
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
