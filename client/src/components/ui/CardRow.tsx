import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/cn.js";

export interface CardRowProps {
  /** Renders as a router Link. Omit for a plain div. */
  to?: string;
  /** Primary tint, for "this one is yours" (your own game, your match). */
  highlight?: boolean;
  /** Below `sm` the row stacks into two lines (content on top, actions
   *  underneath) so names get the full width; from `sm` up it's one row. */
  stackOnMobile?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * The bordered, rounded "card inside a card" row used for games, tournaments,
 * leagues and cage matches, so every such list shares one border, radius,
 * padding and hover treatment.
 */
export function CardRow({
  to,
  highlight = false,
  stackOnMobile = false,
  className,
  children,
}: CardRowProps) {
  const classes = cn(
    "flex min-w-0 border transition-colors",
    stackOnMobile
      ? "flex-col gap-2.5 rounded-2xl px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3"
      : "items-center justify-between gap-3 rounded-xl px-3 py-2.5",
    highlight
      ? "border-(--primary)/40 bg-(--primary)/5"
      : "border-base-300 bg-base-100/60 hover:border-(--primary)/40",
    className,
  );
  if (to) {
    return (
      <Link to={to} className={classes}>
        {children}
      </Link>
    );
  }
  return <div className={classes}>{children}</div>;
}
