/**
 * Portfolio Analyser — persistence layer (Phase 2).
 *
 * Bridges the client-side `RawHolding` working model with the DB-backed,
 * per-user (ownerKey-scoped) portfolio CRUD API. Pure mappers are exported for
 * unit testing; the `usePortfolios` hook wires the generated async client
 * functions into React Query.
 *
 * Privacy: every endpoint is gated server-side to the logged-in user's
 * `ownerKey`. There is no public/shared access — unauthenticated reads return
 * empty and writes are rejected 403 by the server.
 */
import { useCallback, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listPortfolios,
  getPortfolio,
  createPortfolio,
  updatePortfolio,
  deletePortfolio,
  replacePortfolioHoldings,
  type Portfolio,
  type PortfolioHolding,
  type PortfolioHoldingInput,
  type PortfolioListResponse,
  type PortfolioSummary,
} from "@workspace/api-client-react";
import type { RawHolding } from "./types";

const str = (v: string | null | undefined): string | undefined => {
  const t = (v ?? "").trim();
  return t.length ? t : undefined;
};

const numOrUndef = (v: number | null | undefined): number | undefined =>
  v != null && Number.isFinite(v) ? v : undefined;

/** Map a DB-loaded holding back into the client `RawHolding` working model. */
export function holdingToRaw(h: PortfolioHolding): RawHolding {
  return {
    symbol: h.symbol,
    name: (h.name ?? "").trim() || h.symbol,
    exchange: str(h.exchange),
    sector: str(h.sector),
    purchaseDate: str(h.purchaseDate),
    qty: h.qty,
    rate: h.rate,
    isin: str(h.isin),
    broker: str(h.broker),
    tag: str(h.tag),
    notes: str(h.notes),
    dividendReceived: numOrUndef(h.dividendReceived),
    realisedPnl: numOrUndef(h.realisedPnl),
  };
}

/**
 * Map a client `RawHolding` into the API holding-input shape. Live-market and
 * advisory fields (targetPrice/stopLoss) are intentionally NOT persisted — only
 * user-supplied book-keeping figures are stored.
 */
export function rawToInput(h: RawHolding): PortfolioHoldingInput {
  return {
    symbol: h.symbol.trim().toUpperCase(),
    name: str(h.name) ?? null,
    exchange: str(h.exchange) ?? null,
    sector: str(h.sector) ?? null,
    purchaseDate: str(h.purchaseDate) ?? null,
    qty: h.qty,
    rate: h.rate,
    isin: str(h.isin) ?? null,
    broker: str(h.broker) ?? null,
    tag: str(h.tag) ?? null,
    notes: str(h.notes) ?? null,
    dividendReceived: numOrUndef(h.dividendReceived) ?? null,
    realisedPnl: numOrUndef(h.realisedPnl) ?? null,
  };
}

export const PORTFOLIO_LIST_KEY = ["portfolios", "list"] as const;
const portfolioKey = (id: string) => ["portfolios", "detail", id] as const;

export interface UsePortfoliosResult {
  list: PortfolioSummary[];
  listLoading: boolean;
  listError: boolean;
  /** True when the list query resolved (so the UI can distinguish "loading" from "no portfolios"). */
  listReady: boolean;
  defaultId: string | null;
  loadPortfolio: (id: string) => Promise<Portfolio>;
  create: (
    name: string,
    holdings: RawHolding[],
    isDefault: boolean,
    benchmark?: string | null,
  ) => Promise<Portfolio>;
  rename: (id: string, name: string) => Promise<Portfolio>;
  setDefault: (id: string) => Promise<Portfolio>;
  /** Persist the chosen benchmark index for a saved portfolio (follows the user across devices). */
  setBenchmark: (id: string, benchmark: string | null) => Promise<Portfolio>;
  remove: (id: string) => Promise<void>;
  saveHoldings: (id: string, holdings: RawHolding[]) => Promise<Portfolio>;
  saving: boolean;
}

export function usePortfolios(): UsePortfoliosResult {
  const qc = useQueryClient();

  const listQuery = useQuery<PortfolioListResponse>({
    queryKey: PORTFOLIO_LIST_KEY,
    queryFn: () => listPortfolios(),
    staleTime: 30_000,
  });

  const invalidateList = useCallback(() => {
    void qc.invalidateQueries({ queryKey: PORTFOLIO_LIST_KEY });
  }, [qc]);

  const loadPortfolio = useCallback(
    (id: string) =>
      qc.fetchQuery({ queryKey: portfolioKey(id), queryFn: () => getPortfolio(id) }),
    [qc],
  );

  const createMut = useMutation({
    mutationFn: (body: {
      name: string;
      holdings: RawHolding[];
      isDefault: boolean;
      benchmark?: string | null;
    }) =>
      createPortfolio({
        name: body.name,
        isDefault: body.isDefault,
        benchmark: body.benchmark ?? null,
        holdings: body.holdings.map(rawToInput),
      }),
    onSuccess: () => invalidateList(),
  });

  const patchMut = useMutation({
    mutationFn: (body: {
      id: string;
      name?: string;
      isDefault?: boolean;
      benchmark?: string | null;
    }) =>
      updatePortfolio(body.id, {
        name: body.name,
        isDefault: body.isDefault,
        benchmark: body.benchmark,
      }),
    onSuccess: portfolio => {
      qc.setQueryData(portfolioKey(portfolio.id), portfolio);
      invalidateList();
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deletePortfolio(id),
    onSuccess: () => invalidateList(),
  });

  const saveMut = useMutation({
    mutationFn: (body: { id: string; holdings: RawHolding[] }) =>
      replacePortfolioHoldings(body.id, { holdings: body.holdings.map(rawToInput) }),
    onSuccess: portfolio => {
      qc.setQueryData(portfolioKey(portfolio.id), portfolio);
      invalidateList();
    },
  });

  const list = listQuery.data?.items ?? [];
  const defaultId = useMemo(() => list.find(p => p.isDefault)?.id ?? null, [list]);

  return {
    list,
    listLoading: listQuery.isLoading,
    listError: listQuery.isError,
    listReady: listQuery.isSuccess,
    defaultId,
    loadPortfolio,
    create: (name, holdings, isDefault, benchmark) =>
      createMut.mutateAsync({ name, holdings, isDefault, benchmark }),
    rename: (id, name) => patchMut.mutateAsync({ id, name }),
    setDefault: id => patchMut.mutateAsync({ id, isDefault: true }),
    setBenchmark: (id, benchmark) => patchMut.mutateAsync({ id, benchmark }),
    remove: async id => {
      await deleteMut.mutateAsync(id);
    },
    saveHoldings: (id, holdings) => saveMut.mutateAsync({ id, holdings }),
    saving: createMut.isPending || patchMut.isPending || saveMut.isPending || deleteMut.isPending,
  };
}
