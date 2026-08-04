/**
 * PageHeader — consistent heading + breadcrumb + actions strip (Pack 6 Gate A).
 *
 * Use at the top of every page as the H1 / title region so heading hierarchy
 * is consistent across all 30+ routes. Optionally renders a breadcrumb trail
 * and a right-aligned actions slot.
 */

import { Link } from "wouter";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export interface Breadcrumb {
  label: string;
  href?: string;
}

export interface PageHeaderProps {
  /** Rendered as the <h1> for the page. */
  title: string;
  /** Optional short upper-label (e.g. "F&O", "Research") above the title. */
  section?: string;
  /** Optional breadcrumb trail. Last entry is the current page (no link). */
  breadcrumbs?: Breadcrumb[];
  /** Optional description below the title. */
  description?: string;
  /** Right-aligned actions slot. */
  actions?: ReactNode;
  /** Extra component rendered below the title row (e.g. a DataSourceBadge). */
  meta?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  section,
  breadcrumbs,
  description,
  actions,
  meta,
  className,
}: PageHeaderProps) {
  return (
    <div
      className={cn("flex flex-col gap-1.5 mb-4", className)}
      data-testid="page-header"
    >
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="flex items-center gap-1">
          {breadcrumbs.map((crumb, i) => {
            const isLast = i === breadcrumbs.length - 1;
            return (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && (
                  <ChevronRight className="h-3 w-3 text-muted-foreground/50" aria-hidden />
                )}
                {!isLast && crumb.href ? (
                  <Link
                    href={crumb.href}
                    className="text-xs font-mono text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {crumb.label}
                  </Link>
                ) : (
                  <span
                    className="text-xs font-mono text-muted-foreground/70"
                    aria-current={isLast ? "page" : undefined}
                  >
                    {crumb.label}
                  </span>
                )}
              </span>
            );
          })}
        </nav>
      )}

      <div className="flex flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-0.5 min-w-0">
          {section && (
            <p className="text-[10px] font-mono uppercase tracking-widest text-muted-foreground">
              {section}
            </p>
          )}
          <h1 className="text-xl font-bold tracking-tight leading-tight truncate">
            {title}
          </h1>
          {description && (
            <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
          )}
          {meta && <div className="mt-1">{meta}</div>}
        </div>
        {actions && (
          <div className="flex items-center gap-2 shrink-0 mt-2 sm:mt-0">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

export default PageHeader;
