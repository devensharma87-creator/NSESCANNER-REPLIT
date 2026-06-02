import { useRef, useState } from "react";
import { Download, Upload, AlertTriangle, Plus } from "lucide-react";
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
  const [tab, setTab] = useState<Tab>("csv");
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [csvText, setCsvText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const [m, setM] = useState({ symbol: "", name: "", sector: "", qty: "", rate: "", date: "" });
  const [manualErr, setManualErr] = useState<string | null>(null);

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
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="Symbol (e.g. RELIANCE)"
                value={m.symbol}
                onChange={e => setM({ ...m, symbol: e.target.value })}
                data-testid="manual-symbol"
              />
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
