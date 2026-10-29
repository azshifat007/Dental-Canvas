import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { DentalBackdrop } from "@/components/dental-art";

/**
 * The mint canvas from the dashboard, reused by the other list/detail pages so
 * moving between Dashboard → Patients → Agenda → Settings does not change the
 * surface out from under the user.
 *
 * The page keeps its own inner scroll container (the table and the day grid
 * need one), so the backdrop is pinned to the viewport and stays put while the
 * content scrolls — purely decorative and aria-hidden.
 */
export function PageShell({
  children,
  className,
  contentClassName,
}: {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <div className={cn("dc-page relative flex flex-1 flex-col overflow-hidden", className)}>
      <DentalBackdrop />
      <div className={cn("relative z-10 flex min-h-0 flex-1 flex-col", contentClassName)}>
        {children}
      </div>
    </div>
  );
}

/**
 * Page heading that mirrors the dashboard greeting: an uppercase eyebrow, a
 * large tight title, one line of context, and the page's primary actions on the
 * right (stacking under the title on narrow screens).
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  icon,
  actions,
  children,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  /** Small glyph shown in a gradient tile beside the title. */
  icon?: ReactNode;
  actions?: ReactNode;
  /** Extra row below the heading, e.g. a search field. */
  children?: ReactNode;
}) {
  return (
    <div className="shrink-0 px-4 pb-4 pt-5 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {icon ? (
            <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-teal-600 text-primary-foreground shadow-lg shadow-primary/25">
              {icon}
            </span>
          ) : null}
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-primary/80">
              {eyebrow}
            </p>
            <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-tight md:text-[30px]">
              {title}
            </h1>
            {description ? (
              <p className="mt-1 max-w-xl text-sm text-muted-foreground">{description}</p>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
            {actions}
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}
