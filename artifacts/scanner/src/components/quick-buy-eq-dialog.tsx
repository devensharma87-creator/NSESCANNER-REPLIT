/**
 * Reusable owner-only "buy this stock now" dialog. Mirrors the inline
 * ManualBuyEqDialog inside paper-trading.tsx but accepts a
 * `defaultSymbol` so it can be pre-filled from the scanner / deep-scan
 * Buy button. Posts to /paper/positions/eq/manual exactly like the
 * dashboard one, so all server-side gates (DD caps, heat, sanity etc)
 * still apply.
 */
import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE}api${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const body = await r.json();
      if (body?.error) msg = String(body.error);
    } catch { /* ignore */ }
    throw new Error(msg);
  }
  return (await r.json()) as T;
}

const inrDec = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n);

interface BuyResult {
  id: string;
  symbol: string;
  qty: number;
  entryPrice: number;
  stopPrice: number;
  target1Price: number;
  target2Price: number;
  capitalDeployed: number;
}

export function QuickBuyEqDialog({
  open, onClose, defaultSymbol = "", onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  defaultSymbol?: string;
  onSuccess?: (result: BuyResult) => void;
}) {
  const { toast } = useToast();
  const [symbol, setSymbol] = useState(defaultSymbol);
  const [qty, setQty] = useState("");
  // Re-prime symbol whenever the dialog reopens with a new default.
  useEffect(() => {
    if (open) {
      setSymbol(defaultSymbol);
      setQty("");
    }
  }, [open, defaultSymbol]);

  const mutation = useMutation({
    mutationFn: async (payload: { symbol: string; qty?: number }) =>
      api<BuyResult>(`/paper/positions/eq/manual`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (result) => {
      toast({
        title: "Buy filled",
        description: `${result.symbol} × ${result.qty} @ ${inrDec(result.entryPrice)} (stop ${inrDec(result.stopPrice)})`,
      });
      setSymbol("");
      setQty("");
      onSuccess?.(result);
      onClose();
    },
    onError: (err: unknown) => {
      toast({
        title: "Buy rejected",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    },
  });

  if (!open) return null;
  const cleanSymbol = symbol.trim().toUpperCase();
  const qtyParsed = qty.trim() === "" ? undefined : Number(qty);
  const qtyValid = qtyParsed === undefined || (Number.isFinite(qtyParsed) && qtyParsed > 0 && Number.isInteger(qtyParsed));
  const valid = cleanSymbol.length > 0 && qtyValid;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-xl"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-label="Buy stock"
      >
        <h2 className="text-lg font-semibold mb-1">Buy {cleanSymbol || "stock"} (Equity paper)</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Bypasses the STRONG_BUY / score / sector / volume gates that the auto
          swing tick uses, but still respects every capital safety check
          (stop-sanity, drawdown caps, max concurrent, balance, heat cap).
          Stop &amp; targets are auto-computed from ATR(14) / 20-bar swing low.
        </p>
        <div className="space-y-3">
          <label className="block text-xs uppercase tracking-wider text-muted-foreground">Symbol (NSE)</label>
          <input
            type="text"
            value={symbol}
            onChange={e => setSymbol(e.target.value)}
            placeholder="e.g. COFORGE"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="input-quickbuy-symbol"
            autoFocus
          />
          <label className="block text-xs uppercase tracking-wider text-muted-foreground">Quantity (optional)</label>
          <input
            type="number"
            inputMode="numeric"
            value={qty}
            onChange={e => setQty(e.target.value)}
            placeholder="Leave blank for auto-sizing (account_value / slots)"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            data-testid="input-quickbuy-qty"
            min="1"
            step="1"
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => valid && mutation.mutate({
                symbol: cleanSymbol,
                ...(qtyParsed !== undefined ? { qty: qtyParsed } : {}),
              })}
              disabled={!valid || mutation.isPending}
              data-testid="button-quickbuy-confirm"
            >
              {mutation.isPending ? "Placing…" : "Buy"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
