import { cn } from "@/lib/cn.js";

/** Berserk mark: a plain hourglass (your clock is halved). Always red, it
 *  doesn't follow the surrounding text colour; size it with h-/w- classes.
 *  Simple strokes plus a little sand so it stays readable at the 12px badge
 *  size. */
const RED = "#f87171";

export function BerserkIcon({
  className,
  title,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke={RED}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <path d="M5 3H19" />
      <path d="M5 21H19" />
      <path d="M7 3V6.5L12 12L7 17.5V21" />
      <path d="M17 3V6.5L12 12L17 17.5V21" />
      <path d="M9.5 18.5H14.5" />
      <path d="M12 12V14.5" />
    </svg>
  );
}
