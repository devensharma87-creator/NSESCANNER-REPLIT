import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Upload, AlertTriangle, Plus, Search, X } from "lucide-react";
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
import { buildCsvTemplate, parsePortfolioCsv } from "@/lib/portfolio/csv";
import type { RawHolding, ParseResult } from "@/lib/portfolio/types";

/** Debounce a fast-changing value so we don't fire a search on every keystroke. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return v;
}

function downloadTemplate() {
  const blob = new Blob([buildCsvTemplate()], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "portfolio-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

type Tab = "csv" | "manual";

export function UploadModal({
  open,
  onOpenChange,
  onImport,
  onAddOne,
  existingSymbols = [],
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImport: (holdings: RawHolding[]) => void;
  onAddOne: (holding: RawHolding) => void;
  /** Symbols already in the working portfolio, used to flag duplicates in autocomplete. */
  existingSymbols?: string[];
}) {
  const ownedSet = useMemo(
    () => new Set(existingSymbols.map(s => s.trim().toUpperCase())),
    [existingSymbols],
  );
  const [tab, setTab] = useState<Tab>("csv");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [csvText, setCsvText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const [m, setM] = useState({ symbol: "", name: "", sector: "", qty: "", rate: "", date: "" });
  const [manualErr, setManualErr] = useState<string | null>(null);

  // ----- Live instrument autocomplete for the manual "Symbol" field -----
  // Mirrors the Charting page: debounced free-text search against the central
  // instrument master (Kite-backed) so typing "tata" surfaces TATASTEEL,
  // TATAMOTORS, … and selecting one stores the canonical NSE symbol.
  const [symbolOpen, setSymbolOpen] = useState(false);
  const [picked, setPicked] = useState(false);
  const symbolBoxRef = useRef<HTMLDivElement>(null);
  const debouncedSymbol = useDebounced(m.symbol.trim(), 250);
  const searchQ = useQuery({
    enabled: tab === "manual" && symbolOpen && debouncedSymbol.length >= 1,
    queryKey: getSearchChartInstrumentsQueryKey({ q: debouncedSymbol || undefined }),
    queryFn: () => searchChartInstruments({ q: debouncedSymbol || undefined }),
    staleTime: 60_000,
  });
  const instruments: ChartInstrument[] = searchQ.data?.instruments ?? [];

  // Force-close the suggestion list whenever the search box is not actually
  // mounted/visible (modal closed or not on the manual tab) so no stale
  // dropdown state survives a tab switch.
  useEffect(() => {
    if (!open || tab !== "manual") setSymbolOpen(false);
  }, [open, tab]);

  // Close the suggestion list when clicking outside the search box. Scoped to
  // the live manual-tab state so the document listener is never left attached
  // after the input unmounts.
  useEffect(() => {
    if (!open || tab !== "manual" || !symbolOpen) return;
    function onDown(e: MouseEvent) {
      if (symbolBoxRef.current && !symbolBoxRef.current.contains(e.target as Node)) {
        setSymbolOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, tab, symbolOpen]);

  function pickInstrument(inst: ChartInstrument) {
    setM(prev => ({
      ...prev,
      symbol: inst.symbol,
      // Only auto-fill the name if the user hasn't typed their own.
      name: prev.name.trim() ? prev.name : inst.name,
      sector: prev.sector.trim() ? prev.sector : inst.type,
    }));
    setPicked(true);
    setSymbolOpen(false);
    setManualErr(null);
  }

  function handleText(text: string) {
    setCsvText(text);
    setParsed(text.trim() ? parsePortfolioCsv(text) : null);
  }

  async function handleFile(file: File) {
    const text = await file.text();
    handleText(text);
  }

  function confirmImport() {
    if (parsed && parsed.holdings.length > 0) {
      onImport(parsed.holdings);
      reset();
      onOpenChange(false);
    }
  }

  function reset() {
    setParsed(null);
    setCsvText("");
    if (fileRef.current) fileRef.current.value = "";
  }

  function submitManual() {
    const qty = Number(m.qty);
    const rate = Number(m.rate);
    if (!m.symbol.trim()) return setManualErr("Symbol is required.");
    if (!Number.isFinite(qty) || qty <= 0) return setManualErr("Qty must be a positive number.");
    if (!Number.isFinite(rate) || rate <= 0) return setManualErr("Rate must be a positive number.");
    setManualErr(null);
    onAddOne({
      symbol: m.symbol.trim().toUpperCase(),
      name: m.name.trim() || m.symbol.trim().toUpperCase(),
      sector: m.sector.trim() || undefined,
      qty,
      rate,
      purchaseDate: m.date || undefined,
    });
    setM({ symbol: "", name: "", sector: "", qty: "", rate: "", date: "" });
    setPicked(false);
    setSymbolOpen(false);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="upload-modal">
        <DialogHeader>
          <DialogTitle>Add Holdings</DialogTitle>
          <DialogDescription>
            Import a CSV or add a single holding. Data stays in this browser session only — nothing
            is uploaded or saved to any database.
          </DialogDescription>
        </DialogHeader>

        <div className="mb-3 flex gap-1 rounded-md bg-muted/40 p-1 text-xs">
          <button
            className={`flex-1 rounded px-2 py-1 ${tab === "csv" ? "bg-background font-medium" : "text-muted-foreground"}`}
            onClick={() => setTab("csv")}
            data-testid="tab-csv"
          >
            CSV Import
          </button>
          <button
            className={`flex-1 rounded px-2 py-1 ${tab === "manual" ? "bg-background font-medium" : "text-muted-foreground"}`}
            onClick={() => setTab("manual")}
            data-testid="tab-manual"
          >
            Add Manually
          </button>
        </div>

        {tab === "csv" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={downloadTemplate} data-testid="download-template">
                <Download className="mr-1 h-3.5 w-3.5" /> Template
              </Button>
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                <Upload className="mr-1 h-3.5 w-3.5" /> Choose file
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                }}
                data-testid="csv-file-input"
              />
            </div>

            <textarea
              value={csvText}
              onChange={e => handleText(e.target.value)}
              placeholder="…or paste CSV rows here (Symbol, Date of Purchase, Qty, Rate, …)"
              className="h-28 w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[11px]"
              data-testid="csv-textarea"
            />

            {parsed && (
              <div className="space-y-2 text-xs" data-testid="parse-summary">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-emerald-400">
                    {parsed.holdings.length} valid
                  </span>
                  {parsed.errors.length > 0 && (
                    <span className="rounded bg-red-500/15 px-2 py-0.5 text-red-400">
                      {parsed.errors.length} error(s)
                    </span>
                  )}
                  {parsed.duplicateSymbols.length > 0 && (
                    <span className="rounded bg-amber-500/15 px-2 py-0.5 text-amber-400">
                      dupes: {parsed.duplicateSymbols.join(", ")}
                    </span>
                  )}
                </div>
                {parsed.errors.length > 0 && (
                  <ul className="max-h-24 space-y-0.5 overflow-y-auto text-[11px] text-red-400">
                    {parsed.errors.slice(0, 20).map((er, i) => (
                      <li key={i} className="flex items-start gap-1">
                        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                        Row {er.rowNumber}
                        {er.field ? ` · ${er.field}` : ""}: {er.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={confirmImport}
                disabled={!parsed || parsed.holdings.length === 0}
                data-testid="confirm-import"
              >
                Import {parsed?.holdings.length ?? 0}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div ref={symbolBoxRef} className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search symbol — type e.g. tata, hdfc, reliance…"
                value={m.symbol}
                onChange={e => {
                  setM({ ...m, symbol: e.target.value });
                  setPicked(false);
                  setSymbolOpen(true);
                }}
                onFocus={() => setSymbolOpen(true)}
                autoComplete="off"
                className="pl-8 pr-8 font-mono uppercase"
                data-testid="manual-symbol"
              />
              {m.symbol && (
                <button
                  type="button"
                  onClick={() => {
                    setM({ ...m, symbol: "" });
                    setPicked(false);
                    setSymbolOpen(true);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Clear symbol"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              {symbolOpen && debouncedSymbol.length >= 1 && !picked && (
                <div
                  className="absolute z-50 mt-1 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-lg max-h-64"
                  data-testid="manual-symbol-results"
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
                      No matching instrument. Type the exact NSE symbol to add it anyway.
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
                        data-testid={`manual-result-${inst.symbol}`}
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="flex items-center gap-1.5">
                            <span className="font-mono font-semibold">{inst.symbol}</span>
                            {owned && (
                              <span
                                className="rounded bg-amber-500/15 px-1 text-[9px] font-medium uppercase text-amber-500"
                                data-testid={`manual-owned-${inst.symbol}`}
                              >
                                In portfolio
                              </span>
                            )}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">{inst.name}</span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-0.5">
                          <Badge variant="outline" className="text-[10px]">
                            {inst.exchange ? `${inst.exchange} · ${inst.type}` : inst.type}
                          </Badge>
                          <span className="text-[9px] uppercase tracking-wide text-muted-foreground">
                            {inst.source === "kite_master" ? "Kite master" : "Curated"}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Name (optional)"
                value={m.name}
                onChange={e => setM({ ...m, name: e.target.value })}
              />
              <Input
                placeholder="Sector (optional)"
                value={m.sector}
                onChange={e => setM({ ...m, sector: e.target.value })}
              />
              <Input
                type="date"
                value={m.date}
                onChange={e => setM({ ...m, date: e.target.value })}
                data-testid="manual-date"
              />
              <Input
                type="number"
                placeholder="Qty"
                value={m.qty}
                onChange={e => setM({ ...m, qty: e.target.value })}
                data-testid="manual-qty"
              />
              <Input
                type="number"
                placeholder="Avg rate (₹)"
                value={m.rate}
                onChange={e => setM({ ...m, rate: e.target.value })}
                data-testid="manual-rate"
              />
            </div>
            {manualErr && (
              <p className="flex items-center gap-1 text-[11px] text-red-400">
                <AlertTriangle className="h-3 w-3" /> {manualErr}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={submitManual} data-testid="confirm-manual">
                <Plus className="mr-1 h-3.5 w-3.5" /> Add holding
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
