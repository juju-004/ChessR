import { forwardRef } from "react";
import type { LucideIcon, LucideProps } from "lucide-react";

/** Hand-drawn cage mark for cage matches: a domed cage with three bars on a
 *  base line. Same contract as a lucide icon (stroke follows currentColor,
 *  size via h-/w- classes, optional strokeWidth), so it drops in anywhere a
 *  LucideIcon is expected. */
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
        <path d="M4 20V10a8 8 0 0 1 16 0v10" />
        <path d="M2.5 20.5h19" />
        <path d="M8.5 4v16.5M12 2v18.5M15.5 4v16.5" />
      </svg>
    );
  },
) as LucideIcon;
