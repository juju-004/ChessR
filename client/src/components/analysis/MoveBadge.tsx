import { memo } from "react";
import type { MoveClass } from "../../lib/analysis/classify.js";
import { MOVE_CLASS_META } from "./moveClassMeta.js";

/**
 * The little round chess.com-style marker: a colored disc with a glyph
 * (!!, !, check, X, ??). Pure SVG so it scales crisply from the 14px move
 * list size up to the badge pinned on a board square.
 */
export const MoveBadge = memo(function MoveBadge({
  cls,
  size = 16,
  className,
}: {
  cls: MoveClass;
  size?: number;
  className?: string;
}) {
  const { color, label } = MOVE_CLASS_META[cls];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={label}
      className={className}
      style={{ display: "block", flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="12" fill={color} />
      {cls === "brilliant" && <Glyph text="!!" />}
      {cls === "great" && <Glyph text="!" />}
      {cls === "blunder" && <Glyph text="??" />}
      {cls === "best" && (
        <path
          d="M12 5.2l1.95 4.4 4.8.45-3.62 3.2 1.07 4.7L12 15.4l-4.2 2.55 1.07-4.7-3.62-3.2 4.8-.45z"
          fill="#fff"
        />
      )}
      {cls === "book" && (
        <path
          d="M5.8 7.6c2.1-.9 4.2-.8 6.2.5 2-1.3 4.1-1.4 6.2-.5v9.2c-2.1-.9-4.2-.8-6.2.5-2-1.3-4.1-1.4-6.2-.5zM12 8.1v9.2"
          fill="none"
          stroke="#fff"
          strokeWidth="1.9"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {cls === "good" && (
        <path
          d="M6.5 12.5l3.8 3.8 7.2-7.6"
          fill="none"
          stroke="#fff"
          strokeWidth="2.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {(cls === "miss" || cls === "bad") && (
        <path
          d="M8 8l8 8M16 8l-8 8"
          fill="none"
          stroke="#fff"
          strokeWidth="2.8"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
});

function Glyph({ text }: { text: string }) {
  return (
    <text
      x="12"
      y="12.5"
      textAnchor="middle"
      dominantBaseline="central"
      fill="#fff"
      fontSize={text.length > 1 ? 14 : 17}
      fontWeight={800}
      fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
    >
      {text}
    </text>
  );
}
