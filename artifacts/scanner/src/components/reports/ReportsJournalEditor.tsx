import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Pencil, Tag, X, Check, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { JournalFilter } from "@/lib/reportsView";

const BASE = import.meta.env.BASE_URL;

export type JournalSegment = "FNO" | "EQUITY";

export interface JournalPatchResult {
  id: string;
  journal: string | null;
  tags: string[];
}

/**
 * PATCH the journal/tags for a single closed paper trade. Uses ONLY the
 * existing endpoints with the existing { journal, tags } contract — no new
 * fields are ever sent.
 */
async function patchTradeJournal(
  segment: JournalSegment,
  tradeId: string,
  body: { journal: string | null; tags: string[] },
): Promise<JournalPatchResult> {
  const seg = segment === "FNO" ? "fo" : "eq";
  const r = await fetch(
    `${BASE}api/paper/trades/${seg}/${encodeURIComponent(tradeId)}/journal`,
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const j = await r.json();
      if (j?.error) msg = String(j.error);
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return (await r.json()) as JournalPatchResult;
}

function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function parseTagInput(raw: string): string[] {
  return raw
    .split(",")
    .map(normalizeTag)
    .filter((t) => t.length > 0);
}

interface JournalEditorProps {
  segment: JournalSegment;
  tradeId: string;
  journal: string | null;
  tags: string[];
  /** Existing tags across the dataset, offered as quick-add chips. */
  suggestedTags?: readonly string[];
  /** Called with the persisted values so the parent can reflect the edit. */
  onSaved: (next: { journal: string | null; tags: string[] }) => void;
}

/**
 * Inline journal-note + tags editor for one closed paper trade. View / edit /
 * save / cancel with explicit saving, saved and error states. Read-and-annotate
 * only — never changes trading logic, scoring, entries, exits, stops, targets
 * or paper-trade execution.
 */
export function ReportsJournalEditor({
  segment,
  tradeId,
  journal,
  tags,
  suggestedTags = [],
  onSaved,
}: JournalEditorProps) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draftJournal, setDraftJournal] = useState(journal ?? "");
  const [draftTags, setDraftTags] = useState<string[]>(tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [justSaved, setJustSaved] = useState(false);

  const mutation = useMutation({
    mutationFn: (body: { journal: string | null; tags: string[] }) =>
      patchTradeJournal(segment, tradeId, body),
    onSuccess: (res) => {
      onSaved({ journal: res.journal, tags: res.tags ?? [] });
      setEditing(false);
      setJustSaved(true);
      setTagInput("");
      // Refresh the monthly report so other surfaces (e.g. Overview
      // performance tables) reflect the new note/tags on next read.
      const key = segment === "FNO" ? "fo" : "eq";
      void qc.invalidateQueries({ queryKey: ["paper", "report", key] });
      window.setTimeout(() => setJustSaved(false), 2500);
    },
  });

  const startEdit = () => {
    setDraftJournal(journal ?? "");
    setDraftTags(tags ?? []);
    setTagInput("");
    setJustSaved(false);
    mutation.reset();
    setEditing(true);
  };

  const cancelEdit = () => {
    setEditing(false);
    setTagInput("");
    mutation.reset();
  };

  const addTagsFromInput = () => {
    const parsed = parseTagInput(tagInput);
    if (parsed.length === 0) return;
    setDraftTags((prev) => {
      const next = [...prev];
      for (const t of parsed) if (!next.includes(t)) next.push(t);
      return next;
    });
    setTagInput("");
  };

  const addSuggested = (t: string) => {
    setDraftTags((prev) => (prev.includes(t) ? prev : [...prev, t]));
  };

  const removeTag = (t: string) => {
    setDraftTags((prev) => prev.filter((x) => x !== t));
  };

  const save = () => {
    const trimmed = draftJournal.trim();
    mutation.mutate({
      journal: trimmed.length > 0 ? trimmed : null,
      tags: draftTags,
    });
  };

  const availableSuggestions = useMemo(
    () => suggestedTags.filter((t) => !draftTags.includes(t)),
    [suggestedTags, draftTags],
  );

  if (!editing) {
    const hasNote = (journal ?? "").trim().length > 0;
    const hasTags = (tags ?? []).length > 0;
    return (
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            {hasNote ? (
              <p className="text-sm text-slate-200 whitespace-pre-wrap break-words">
                {journal}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground italic">
                No journal note yet.
              </p>
            )}
            {hasTags ? (
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <Badge
                    key={t}
                    variant="outline"
                    className="border-slate-600 text-slate-300 gap-1"
                  >
                    <Tag className="h-3 w-3" />
                    {t}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No tags.</p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {justSaved && (
              <span className="flex items-center gap-1 text-xs text-emerald-400">
                <Check className="h-3.5 w-3.5" /> Saved
              </span>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={startEdit}
              className="gap-1.5"
            >
              <Pencil className="h-3.5 w-3.5" />
              {hasNote || hasTags ? "Edit" : "Add note"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs uppercase tracking-wide text-muted-foreground">
          Journal note
        </label>
        <Textarea
          value={draftJournal}
          onChange={(e) => setDraftJournal(e.target.value)}
          placeholder="What did you learn from this trade? (review only)"
          rows={3}
          className="mt-1 resize-y"
          disabled={mutation.isPending}
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs uppercase tracking-wide text-muted-foreground">
          Tags
        </label>
        {draftTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {draftTags.map((t) => (
              <Badge
                key={t}
                variant="outline"
                className="border-slate-600 text-slate-200 gap-1"
              >
                {t}
                <button
                  type="button"
                  onClick={() => removeTag(t)}
                  disabled={mutation.isPending}
                  aria-label={`Remove tag ${t}`}
                  className="hover:text-rose-300"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Input
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === ",") {
                e.preventDefault();
                addTagsFromInput();
              }
            }}
            placeholder="Add a tag, then Enter"
            className="h-9"
            disabled={mutation.isPending}
          />
          <Button
            size="sm"
            variant="outline"
            onClick={addTagsFromInput}
            disabled={mutation.isPending || tagInput.trim().length === 0}
          >
            Add
          </Button>
        </div>
        {availableSuggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">
              Existing tags:
            </span>
            {availableSuggestions.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => addSuggested(t)}
                disabled={mutation.isPending}
                className="rounded-full border border-slate-700 bg-slate-800/50 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                + {t}
              </button>
            ))}
          </div>
        )}
      </div>

      {mutation.isError && (
        <div className="flex items-center gap-1.5 text-xs text-rose-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          {mutation.error instanceof Error
            ? mutation.error.message
            : "Could not save"}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={mutation.isPending} className="gap-1.5">
          {mutation.isPending ? (
            <>
              <Spinner className="h-3.5 w-3.5" /> Saving…
            </>
          ) : (
            "Save"
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={cancelEdit}
          disabled={mutation.isPending}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

interface FilterBarProps {
  availableTags: readonly string[];
  selectedTags: readonly string[];
  onToggleTag: (tag: string) => void;
  journalFilter: JournalFilter;
  onChangeJournalFilter: (f: JournalFilter) => void;
  showing: number;
  total: number;
  onClear: () => void;
}

const JOURNAL_FILTER_LABELS: Record<JournalFilter, string> = {
  ALL: "All",
  PRESENT: "With notes",
  MISSING: "Without notes",
};

/**
 * Controlled mistake/review filter bar. Tags shown are derived purely from the
 * trades on screen (never fabricated). Filtering is presentation-only.
 */
export function ReportsJournalFilterBar({
  availableTags,
  selectedTags,
  onToggleTag,
  journalFilter,
  onChangeJournalFilter,
  showing,
  total,
  onClear,
}: FilterBarProps) {
  const hasActive = selectedTags.length > 0 || journalFilter !== "ALL";
  return (
    <div className="px-6 pb-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
          Notes
        </span>
        {(Object.keys(JOURNAL_FILTER_LABELS) as JournalFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => onChangeJournalFilter(f)}
            className={cn(
              "rounded-full border px-3 py-0.5 text-xs transition-colors",
              journalFilter === f
                ? "border-sky-500 text-sky-300 bg-sky-500/10"
                : "border-slate-700 text-slate-300 bg-slate-800/40 hover:bg-slate-800",
            )}
          >
            {JOURNAL_FILTER_LABELS[f]}
          </button>
        ))}
      </div>
      {availableTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Tags
          </span>
          {availableTags.map((t) => {
            const active = selectedTags.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => onToggleTag(t)}
                className={cn(
                  "rounded-full border px-3 py-0.5 text-xs transition-colors gap-1 inline-flex items-center",
                  active
                    ? "border-amber-500 text-amber-200 bg-amber-500/10"
                    : "border-slate-700 text-slate-300 bg-slate-800/40 hover:bg-slate-800",
                )}
              >
                <Tag className="h-3 w-3" />
                {t}
              </button>
            );
          })}
        </div>
      )}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>
          Showing {showing} of {total}
        </span>
        {hasActive && (
          <button
            type="button"
            onClick={onClear}
            className="text-sky-300 hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
