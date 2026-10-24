import { forwardRef } from "react";
import type { LucideIcon, LucideProps } from "lucide-react";

/** Hand-drawn cage mark for cage matches: an octagon (the shape of a fight
 *  cage) with two fence bars and a top rail. Same contract as a lucide icon
 *  (stroke follows currentColor, size via h-/w- classes, optional
 *  strokeWidth), so it drops in anywhere a LucideIcon is expected. */
export const CageIcon: LucideIcon = forwardRef<SVGSVGElement, LucideProps>(
  function CageIcon({ size = 24, strokeWidth = 2, color, className, ...rest }, ref) {
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
        <path d="M8.5 2.5h7L21.5 8.5v7L15.5 21.5h-7L2.5 15.5v-7z" />
        <path d="M9 2.8v18.4M15 2.8v18.4" />
        <path d="M2.8 12h18.4" />
      </svg>
    );
  },
) as LucideIcon;
