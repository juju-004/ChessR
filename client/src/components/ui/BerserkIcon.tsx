import { cn } from "@/lib/cn.js";

/** Berserk mark: a solid hourglass (your clock is halved). Always red, it
 *  doesn't follow the surrounding text colour; size it with h-/w- classes.
 *  One filled silhouette (two triangles meeting at the waist) with no inner
 *  detail, so it stays recognisable down to ~10px. The thin outline just
 *  rounds the corners and fattens the shape slightly. */
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
      fill={RED}
      stroke={RED}
      strokeWidth={2.5}
      strokeLinejoin="round"
      className={cn("shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <path d="M5 3H19L12.5 12L19 21H5L11.5 12Z" />
    </svg>
  );
}
