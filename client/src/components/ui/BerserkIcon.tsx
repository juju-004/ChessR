import { cn } from "@/lib/cn.js";

/** Berserk mark: a spiky, horned hourglass (your clock is halved). Always
 *  red, it doesn't follow the surrounding text colour; size it with h-/w-
 *  classes. The glass outline is a thin stroke so it stays readable at the
 *  12px badge size. */
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
      strokeLinejoin="miter"
      strokeLinecap="round"
      className={cn("shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <path
        d="M5.5 5H18.5L13.2 12L18.5 19H5.5L10.8 12Z"
        fill={RED}
        fillOpacity={0.18}
        stroke={RED}
        strokeWidth={1}
      />
      <path d="M1.5 1L6 3H18L22.5 1L20.5 5H3.5Z" fill={RED} />
      <path d="M1.5 23L3.5 19H20.5L22.5 23L18 21H6Z" fill={RED} />
      <path d="M8.5 6.4H15.5L12 10.6Z" fill={RED} />
      <path d="M12 10.6V14" stroke={RED} strokeWidth={0.9} />
      <path
        d="M7 18.2L9.5 15.2L11 17L12 13.8L13 17L14.5 15.2L17 18.2Z"
        fill={RED}
      />
    </svg>
  );
}
