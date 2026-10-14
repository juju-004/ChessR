import type { ReactNode } from "react";
import { cn } from "@/lib/cn.js";
import { Avatar } from "./ui/index.js";

/**
 * Shared layout for the two "someone sent you a link" landing pages: the game
 * join screen (Game.tsx, need-join mode) and the cage match invite
 * (CageMatchInvite.tsx). Both answer the same three questions in the same
 * order, so they share one shell: who is asking, what exactly am I agreeing
 * to, and the one button that says yes.
 */

export interface InviteCardProps {
  /** The person who sent the link. */
  from: { username: string; avatarGradient?: string | null };
  /** One line, what they're asking: "challenges you to a game". */
  headline: ReactNode;
  /** Small line under the headline (game code, number of games...). */
  subline?: ReactNode;
  /** The terms: a stack of <InviteTerm> rows and/or a custom block. */
  children: ReactNode;
  /** Primary action area (button, inline error, "this is your own link"). */
  footer: ReactNode;
}

export function InviteCard({
  from,
  headline,
  subline,
  children,
  footer,
}: InviteCardProps) {
  return (
    <section className="overflow-hidden rounded-2xl border border-base-content/10 bg-base-200">
      <header className="flex items-center gap-4 px-5 pb-5 pt-6">
        <Avatar
          username={from.username}
          gradient={from.avatarGradient}
          size="lg"
          className="ring-2 ring-primary/40 ring-offset-2 ring-offset-base-200"
        />
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold leading-tight text-base-content">
            {from.username}
          </h1>
          <p className="text-sm text-base-content/70">{headline}</p>
          {subline && (
            <p className="mt-0.5 text-xs text-base-content/50">{subline}</p>
          )}
        </div>
      </header>

      <div className="border-t border-base-content/10">{children}</div>

      <footer className="space-y-3 border-t border-base-content/10 bg-base-300/40 px-5 py-4">
        {footer}
      </footer>
    </section>
  );
}

export interface InviteTermProps {
  icon: ReactNode;
  label: string;
  /** The value, right-aligned. */
  children: ReactNode;
  /** Extra explanation under the label (what "winner takes all" means). */
  detail?: ReactNode;
  /** Highlights the row (used for anything that costs R Coins). */
  emphasis?: boolean;
}

/** One row of the terms list. Rows are separated by hairlines, so stack as
 *  many as needed directly inside <InviteCard>. */
export function InviteTerm({
  icon,
  label,
  children,
  detail,
  emphasis = false,
}: InviteTermProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 border-b border-base-content/10 px-5 py-3 last:border-b-0",
        emphasis && "bg-amber-500/10",
      )}
    >
      <span
        className={cn(
          "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
          emphasis
            ? "bg-amber-500/20 text-amber-600 dark:text-amber-300"
            : "bg-base-300 text-base-content/70",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-base-content/70">{label}</p>
        {detail && <p className="text-xs text-base-content/50">{detail}</p>}
      </div>
      <div
        className={cn(
          "shrink-0 text-right text-sm font-semibold",
          emphasis ? "text-amber-600 dark:text-amber-300" : "text-base-content",
        )}
      >
        {children}
      </div>
    </div>
  );
}
