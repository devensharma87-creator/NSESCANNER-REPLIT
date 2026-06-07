import { useEffect, useRef, useState } from "react";
import { Download, Upload, AlertTriangle, Plus } from "lucide-react";
import {
  useSearchChartInstruments,
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
import { buildCsvTemplate, parsePortfolioCsv } from "@/lib/portfolio/csv";
import type { RawHolding, ParseResult } from "@/lib/portfolio/types";

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
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onImport: (holdings: RawHolding[]) => void;
  onAddOne: (holding: RawHolding) => void;
}) {
  const [tab, setTab] = useState<Tab>("manual");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [csvText, setCsvText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const [m, setM] = useState({ symbol: "", name: "", sector: "", qty: "", rate: "", date: "" });
  const [manualErr, setManualErr] = useState<string | null>(null);

  // --- Symbol typeahead (reuses the chart instrument search) ---
  const [symQuery, setSymQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchBoxRef = useRef<HTMLDivElement>(null);

  // Always present the single-stock form first each time the modal opens.
  useEffect(() => {
    if (open) {
      setTab("manual");
      setSearchOpen(false);
    }
  }, [open]);

  // Debounce the symbol query so we don't hit search on every keystroke.
  useEffect(() => {
    const id = setTimeout(() => setSymQuery(m.symbol.trim()), 200);
    return () => clearTimeout(id);
  }, [m.symbol]);

  // Close the suggestion list on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (searchBoxRef.current && !searchBoxRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const searchQ = useSearchChartInstruments(
    { q: symQuery || undefined, segment: "equity" },
    {
      query: {
        enabled: open && tab === "manual" && searchOpen && symQuery.length >= 1,
        staleTime: 60_000,
        queryKey: getSearchChartInstrumentsQueryKey({ q: symQuery || undefined, segment: "equity" }),
      },
    },
  );
  const symResults: ChartInstrument[] = searchQ.data?.instruments ?? [];

  function pickInstrument(inst: ChartInstrument) {
    setM(prev => ({ ...prev, symbol: inst.symbol, name: prev.name.trim() || inst.name }));
    setSearchOpen(false);
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
            <div className="relative" ref={searchBoxRef}>
              <Input
                placeholder="Symbol — start typing to search (e.g. RELIANCE)"
                value={m.symbol}
                onChange={e => {
                  setM({ ...m, symbol: e.target.value });
                  setSearchOpen(true);
                }}
                onFocus={() => {
                  if (m.symbol.trim()) setSearchOpen(true);
                }}
                autoComplete="off"
                data-testid="manual-symbol"
              />
              {searchOpen && symQuery.length >= 1 && (
                <div
                  className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border border-border bg-popover shadow-lg"
                  data-testid="manual-symbol-suggestions"
                >
                  {searchQ.isLoading && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>
                  )}
                  {!searchQ.isLoading && symResults.length === 0 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground">
                      No match — you can still add “{m.symbol.trim().toUpperCase()}” manually.
                    </div>
                  )}
                  {symResults.map(inst => (
                    <button
                      type="button"
                      key={`${inst.segment}:${inst.symbol}`}
                      onClick={() => pickInstrument(inst)}
                      className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/50"
                      data-testid={`sym-result-${inst.symbol}`}
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="font-mono text-sm font-semibold">{inst.symbol}</span>
                        <span className="max-w-[260px] truncate text-[11px] text-muted-foreground">
                          {inst.name}
                        </span>
                      </span>
                      <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {inst.type}
                      </span>
                    </button>
                  ))}
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
              <Input
                type="date"
                value={m.date}
                onChange={e => setM({ ...m, date: e.target.value })}
                data-testid="manual-date"
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
