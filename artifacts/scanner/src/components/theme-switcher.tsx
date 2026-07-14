import { useEffect, useState, useRef } from "react";
import { Sun, Moon, Waves, Palette, Hexagon, Crown } from "lucide-react";

export type ThemeName = "dark" | "light" | "ocean" | "carbon" | "royal";
const STORAGE_KEY = "nse_scanner_theme";
const THEME_CLASSES: Record<ThemeName, string> = {
  dark: "theme-dark dark",
  light: "theme-light",
  ocean: "theme-ocean dark",
  carbon: "theme-carbon dark",
  royal: "theme-royal dark",
};

const VALID_THEMES = new Set<ThemeName>(["dark", "light", "ocean", "carbon", "royal"]);

export function applyTheme(name: ThemeName) {
  const root = document.documentElement;
  Object.values(THEME_CLASSES).forEach(cls => {
    cls.split(" ").forEach(c => root.classList.remove(c));
  });
  THEME_CLASSES[name].split(" ").forEach(c => root.classList.add(c));
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    /* private mode */
  }
}

export function loadInitialTheme(): ThemeName {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeName | null;
    if (saved && VALID_THEMES.has(saved)) return saved;
  } catch {
    /* ignore */
  }
  return "dark";
}

const THEMES: { id: ThemeName; label: string; icon: React.ElementType }[] = [
  { id: "dark", label: "Dark", icon: Moon },
  { id: "light", label: "Light", icon: Sun },
  { id: "ocean", label: "Ocean", icon: Waves },
  { id: "carbon", label: "Carbon Blue", icon: Hexagon },
  { id: "royal", label: "Royal Blue", icon: Crown },
];

export function ThemeSwitcher() {
  const [theme, setTheme] = useState<ThemeName>(() => loadInitialTheme());
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const current = THEMES.find(t => t.id === theme) ?? THEMES[0]!;
  const CurrentIcon = current.icon;

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        title="Switch theme"
        aria-label={`Switch theme — current: ${current.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-card hover:bg-accent transition-colors"
      >
        <CurrentIcon className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" aria-label="Theme" className="absolute right-0 mt-1 w-40 rounded-md border border-border bg-popover shadow-xl z-[60] overflow-hidden">
          <div className="px-3 py-2 text-[10px] font-mono uppercase tracking-wider text-muted-foreground border-b border-border flex items-center gap-1.5">
            <Palette className="h-3 w-3" /> Theme
          </div>
          {THEMES.map(t => {
            const Icon = t.icon;
            const active = t.id === theme;
            return (
              <button
                key={t.id}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                onClick={() => { setTheme(t.id); setOpen(false); }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-accent transition-colors ${active ? "text-foreground font-semibold" : "text-foreground/80"}`}
              >
                <Icon className="h-4 w-4" />
                <span>{t.label}</span>
                {active && <span className="ml-auto text-[10px] font-mono text-primary">●</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
