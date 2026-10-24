import { forwardRef } from "react";
import type { LucideIcon, LucideProps } from "lucide-react";

/** Mark for a standard (non-cage) game: a chess pawn. Same contract as a
 *  lucide icon (stroke follows currentColor, size via h-/w- classes,
 *  optional strokeWidth), so it drops in anywhere a LucideIcon is expected. */
export const GameIcon: LucideIcon = forwardRef<SVGSVGElement, LucideProps>(
  function GameIcon({ size = 24, strokeWidth = 2, color, className, ...rest }, ref) {
    return (
      <svg
        ref={ref}
        viewBox="0 0 24 24"
        width={size}
        height={size}
        fill="none"
        stroke={color ?? "currentColor"}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
        aria-hidden="true"
        {...rest}
      >
        <circle cx="12" cy="6.5" r="3.5" />
        <path d="M9 11.5h6" />
        <path d="M10 11.5c0 3.5-1.5 5.5-3 8.5h10c-1.5-3-3-5-3-8.5" />
        <path d="M5.5 21.5h13" />
      </svg>
    );
  },
) as LucideIcon;
