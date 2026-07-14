import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  useListGlobalInstruments,
  getListGlobalInstrumentsQueryKey,
  type GlobalInstrument,
  type GlobalAssetClass,
} from "@workspace/api-client-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Search, Bitcoin, Coins, Banknote, LineChart, BarChart3 } from "lucide-react";

const ASSET_LABEL: Record<GlobalAssetClass, string> = {
  crypto: "Crypto",
  commodity: "Commodities",
  forex: "Forex",
  equity: "Equities",
  index: "Indices",
};

const ASSET_ORDER: GlobalAssetClass[] = ["crypto", "commodity", "forex", "equity", "index"];

const ASSET_ICON: Record<GlobalAssetClass, typeof Bitcoin> = {
  crypto: Bitcoin,
  commodity: Coins,
  forex: Banknote,
  equity: LineChart,
  index: BarChart3,
};

export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Cmd/Ctrl+K toggles. Don't hijack the shortcut while another modifier
      // (Alt/Shift) is held — that's commonly bound to other system actions.
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { open, setOpen };
}

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [, navigate] = useLocation();
  // Catalog of every instrument across every asset class. Cheap one-shot
  // fetch — the response is < 100 rows and rarely changes during a session,
  // so we let React Query cache it indefinitely instead of refetching.
  const { data, isLoading, isError } = useListGlobalInstruments(undefined, {
    query: {
      queryKey: getListGlobalInstrumentsQueryKey(),
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
  });
  const instruments: GlobalInstrument[] = data ?? [];

  const grouped = useMemo(() => {
    const map = new Map<GlobalAssetClass, GlobalInstrument[]>();
    for (const cls of ASSET_ORDER) map.set(cls, []);
    for (const inst of instruments) {
      const arr = map.get(inst.assetClass);
      if (arr) arr.push(inst);
    }
    return map;
  }, [instruments]);

  const select = (symbol: string) => {
    onOpenChange(false);
    // Defensive encode — current universe symbols are all safe ASCII, but
    // future additions (e.g. forex pairs with a `/`) shouldn't break the
    // URL.
    navigate(`/i/${encodeURIComponent(symbol)}`);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle className="sr-only">Search instruments</DialogTitle>
      <DialogDescription className="sr-only">
        Search any instrument by symbol or display name across every asset class.
      </DialogDescription>
      <CommandInput
        placeholder="Search any instrument by symbol or name…"
        data-testid="command-palette-input"
      />
      <CommandList data-testid="command-palette-list">
        <CommandEmpty>
          {/*
            Disambiguate three "no rows" scenarios so users on a slow or
            broken catalog fetch don't see a misleading "no instruments
            found" — they see "Loading…" or an explicit error instead.
          */}
          {isLoading
            ? "Loading instruments…"
            : isError
            ? "Couldn't load instruments. Please try again."
            : "No instruments found."}
        </CommandEmpty>
        {ASSET_ORDER.map((cls) => {
          const rows = grouped.get(cls) ?? [];
          if (rows.length === 0) return null;
          const Icon = ASSET_ICON[cls];
          return (
            <CommandGroup key={cls} heading={ASSET_LABEL[cls]}>
              {rows.map((inst) => (
                <CommandItem
                  key={inst.symbol}
                  // cmdk filters on the `value` prop. Including both the symbol
                  // and the display name lets a user type "bitcoin" and still
                  // match BTCUSDT, or type "GOLD" and match the metal.
                  value={`${inst.symbol} ${inst.displayName}`}
                  onSelect={() => select(inst.symbol)}
                  data-testid={`command-item-${inst.symbol}`}
                >
                  <Icon className="text-muted-foreground" />
                  <span className="font-mono text-sm">{inst.symbol}</span>
                  <span className="ml-2 text-sm text-muted-foreground truncate">
                    {inst.displayName}
                  </span>
                  <Badge variant="outline" className="ml-auto h-5 text-[10px]">
                    {ASSET_LABEL[cls]}
                  </Badge>
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
      </CommandList>
    </CommandDialog>
  );
}

export function CommandPaletteTrigger({ onClick }: { onClick: () => void }) {
  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform);
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-2 text-sm text-muted-foreground border rounded-md px-2 py-1 hover-elevate active-elevate-2 min-w-[180px]"
      data-testid="button-open-command-palette"
      aria-label="Search instruments"
    >
      <Search className="h-4 w-4" />
      <span className="hidden sm:inline">Search…</span>
      <kbd className="ml-auto hidden sm:inline-flex items-center gap-0.5 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
        {isMac ? "⌘" : "Ctrl"}K
      </kbd>
    </button>
  );
}
