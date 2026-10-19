import type { MouseEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn.js";

export interface ListRowProps {
  /** Renders the row as a router Link. */
  to?: string;
  /** Renders the row as a clickable div (use when the row has buttons in
   *  `trailing`, since a button can't live inside an <a>). */
  onClick?: () => void;
  /** Usually an Avatar. */
  leading?: ReactNode;
  /** Top line. Truncates, so a long username can never push `trailing`
   *  onto its own line. */
  title: ReactNode;
  /** Optional second line (meta text, badges...). */
  subtitle?: ReactNode;
  /** Right-hand side: a result badge, action buttons, ... Never shrinks. */
  trailing?: ReactNode;
  className?: string;
}

const ROW_CLASSES =
  "-mx-2 flex items-center justify-between gap-3 rounded-lg border-b border-base-300 px-2 py-2.5 text-sm transition-colors last:border-none hover:bg-base-100/60";

/**
 * The one list-row shell used for every "avatar + name + trailing thing"
 * list in the app: game history (profile, analysis), friends, online
 * players, search results and friend requests. Keeping the spacing,
 * dividers, truncation and hover state here is what makes all of those
 * lists look like the same list.
 */
export function ListRow({
  to,
  onClick,
  leading,
  title,
  subtitle,
  trailing,
  className,
}: ListRowProps) {
  const body = (
    <>
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        {leading}
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5 font-medium text-base-content">
            {title}
          </div>
          {subtitle && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-base-content/40">
              {subtitle}
            </div>
          )}
        </div>
      </div>
      {trailing && (
        // Stops a tap on an action from also triggering the row's own click.
        <div
          className="flex shrink-0 items-center gap-2"
          onClick={onClick ? (e: MouseEvent) => e.stopPropagation() : undefined}
        >
          {trailing}
        </div>
      )}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={cn(ROW_CLASSES, className)}>
        {body}
      </Link>
    );
  }
  return (
    <div
      onClick={onClick}
      className={cn(ROW_CLASSES, onClick && "cursor-pointer", className)}
    >
      {body}
    </div>
  );
}
