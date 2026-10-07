import type { ReactNode } from "react";

/** One labelled block of the team page. The content inside brings its own
 *  card surface, so this is just the heading row and spacing. */
export function TeamSection({
  title,
  icon,
  badge,
  action,
  children,
}: {
  title: string;
  icon?: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <h2 className="flex min-w-0 items-center gap-2 text-base font-semibold">
          {icon && <span className="shrink-0 text-base-content/60">{icon}</span>}
          <span className="truncate">{title}</span>
          {badge}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
