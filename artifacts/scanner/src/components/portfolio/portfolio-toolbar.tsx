/**
 * Portfolio Analyser — save/load toolbar (Phase 2).
 *
 * Owner-scoped DB-backed portfolio management: switch, save, save-as, rename,
 * set-default, delete. All persistence is per-user (ownerKey) server-side; there
 * is no public or shared access.
 */
import { useState } from "react";
import {
  ChevronDown,
  Save,
  FilePlus2,
  Pencil,
  Star,
  Trash2,
  FolderOpen,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { PortfolioSummary } from "@workspace/api-client-react";

export interface PortfolioToolbarProps {
  list: PortfolioSummary[];
  listReady: boolean;
  currentId: string | null;
  currentName: string | null;
  isDefault: boolean;
  dirty: boolean;
  saving: boolean;
  hasHoldings: boolean;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onSave: () => void;
  onSaveAs: (name: string) => void;
  onCreateNamed: (name: string) => void;
  onRename: (name: string) => void;
  onSetDefault: () => void;
  onDelete: () => void;
}

type NameMode = "create" | "saveas" | "rename" | null;

export function PortfolioToolbar(props: PortfolioToolbarProps) {
  const [nameMode, setNameMode] = useState<NameMode>(null);
  const [nameValue, setNameValue] = useState("");

  function openName(mode: Exclude<NameMode, null>, initial = "") {
    setNameValue(initial);
    setNameMode(mode);
  }

  function submitName() {
    const name = nameValue.trim();
    if (!name) return;
    if (nameMode === "create") props.onCreateNamed(name);
    else if (nameMode === "saveas") props.onSaveAs(name);
    else if (nameMode === "rename") props.onRename(name);
    setNameMode(null);
  }

  const dialogTitle =
    nameMode === "rename"
      ? "Rename portfolio"
      : nameMode === "saveas"
        ? "Save as new portfolio"
        : "Name your portfolio";

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="portfolio-toolbar">
      {/* Switcher */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" data-testid="portfolio-switcher">
            <FolderOpen className="mr-1 h-3.5 w-3.5" />
            <span className="max-w-[160px] truncate">{props.currentName ?? "Unsaved portfolio"}</span>
            {props.dirty && <span className="ml-1 text-amber-400">•</span>}
            <ChevronDown className="ml-1 h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Your portfolios</DropdownMenuLabel>
          {props.listReady && props.list.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">No saved portfolios yet.</div>
          )}
          {props.list.map(p => (
            <DropdownMenuItem
              key={p.id}
              onSelect={() => props.onSwitch(p.id)}
              data-testid={`portfolio-item-${p.id}`}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 truncate">
                  {p.id === props.currentId ? (
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <span className="h-3.5 w-3.5" />
                  )}
                  <span className="truncate">{p.name}</span>
                  {p.isDefault && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
                </span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{p.holdingsCount}</span>
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={props.onNew} data-testid="portfolio-new">
            <FilePlus2 className="mr-2 h-3.5 w-3.5" /> New empty portfolio
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Save */}
      <Button
        size="sm"
        onClick={() => (props.currentId ? props.onSave() : openName("create"))}
        disabled={
          props.saving ||
          // Existing saved portfolio: save whenever dirty — empty holdings IS a
          // savable state (clear + save + reload must persist the empty set).
          // New (unsaved) portfolio: require at least one holding before naming.
          (props.currentId != null ? !props.dirty : !props.hasHoldings)
        }
        data-testid="portfolio-save"
      >
        <Save className="mr-1 h-3.5 w-3.5" />
        {props.currentId ? "Save" : "Save…"}
      </Button>

      {/* Secondary actions */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" data-testid="portfolio-actions">
            Actions <ChevronDown className="ml-1 h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={() => openName("saveas", props.currentName ? `${props.currentName} (copy)` : "")}
            disabled={!props.hasHoldings}
            data-testid="portfolio-saveas"
          >
            <FilePlus2 className="mr-2 h-3.5 w-3.5" /> Save as new…
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => openName("rename", props.currentName ?? "")}
            disabled={!props.currentId}
            data-testid="portfolio-rename"
          >
            <Pencil className="mr-2 h-3.5 w-3.5" /> Rename…
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={props.onSetDefault}
            disabled={!props.currentId || props.isDefault}
            data-testid="portfolio-setdefault"
          >
            <Star className="mr-2 h-3.5 w-3.5" /> Set as default
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={props.onDelete}
            disabled={!props.currentId}
            className="text-red-400 focus:text-red-400"
            data-testid="portfolio-delete"
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" /> Delete portfolio
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={nameMode != null} onOpenChange={v => !v && setNameMode(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>
              Saved privately to your account — only you can see your portfolios.
            </DialogDescription>
          </DialogHeader>
          <Input
            autoFocus
            value={nameValue}
            onChange={e => setNameValue(e.target.value)}
            onKeyDown={e => e.key === "Enter" && submitName()}
            placeholder="e.g. Long-term core"
            data-testid="portfolio-name-input"
            maxLength={80}
          />
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setNameMode(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={submitName} disabled={!nameValue.trim() || props.saving} data-testid="portfolio-name-submit">
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
