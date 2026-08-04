import { motion } from "framer-motion";
import { cn } from "@/lib/cn.js";
import { springSoft } from "@/lib/motion.js";

export interface RCoinProps {
  /** Pixel size (square). Default 20. */
  size?: number;
  className?: string;
  /** Plays a one-shot flip-in on mount — for the rare hero/empty-state
   *  placement, not for inline use next to text (e.g. balance chips, list
   *  rows), where a coin spinning in on every render would be noisy. Uses
   *  only `rotateY`/`opacity`, both compositor-only, so it's cheap even
   *  animated. */
  animateIn?: boolean;
}

/**
 * The R Coin mark — a lowercase "r" struck through with two vertical bars
 * (a nod to Bitcoin's ₿, which does the same thing to a "B"), on a gold
 * coin. This is the app's one and only currency glyph; use it anywhere a
 * token amount is shown instead of a generic lucide icon (Coins,
 * DollarSign, etc.) so the currency reads as its own recognizable mark
 * rather than "some coins".
 *
 *   <RCoin size={16} /> 250
 */
export function RCoin({ size = 20, className, animateIn = false }: RCoinProps) {
  const svg = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
    >
      <defs>
        <linearGradient id="rim" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff2b0" />
          <stop offset="25%" stopColor="#ffd44f" />
          <stop offset="60%" stopColor="#d89200" />
          <stop offset="100%" stopColor="#6d3f00" />
        </linearGradient>

        <radialGradient id="center">
          <stop offset="0%" stopColor="#73b8ff" />
          <stop offset="55%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </radialGradient>

        <radialGradient id="glow">
          <stop offset="0%" stopColor="white" stopOpacity=".65" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>

        <linearGradient id="shine" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="white" stopOpacity=".9" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </linearGradient>

        <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="4" stdDeviation="5" floodOpacity=".35" />
        </filter>
      </defs>

      <circle cx="64" cy="64" r="60" fill="url(#rim)" filter="url(#shadow)" />

      <circle
        cx="64"
        cy="64"
        r="56"
        fill="none"
        stroke="#fff4b8"
        strokeWidth="3"
      />

      <circle cx="64" cy="64" r="46" fill="url(#center)" />

      <circle
        cx="64"
        cy="64"
        r="39"
        fill="none"
        stroke="rgba(255,255,255,.25)"
        strokeWidth="2"
      />

      <g fill="#ffe082">
        <rect x="62" y="17" width="4" height="4" transform="rotate(45 64 19)" />
        <rect
          x="62"
          y="107"
          width="4"
          height="4"
          transform="rotate(45 64 109)"
        />
        <rect x="17" y="62" width="4" height="4" transform="rotate(45 19 64)" />
        <rect
          x="107"
          y="62"
          width="4"
          height="4"
          transform="rotate(45 109 64)"
        />
      </g>

      <text
        x="64"
        y="80"
        textAnchor="middle"
        fontSize="60"
        fontWeight="900"
        fontFamily="Poppins, Inter, sans-serif"
        fill="#0f172a"
        opacity=".25"
      >
        r
      </text>

      <text
        x="64"
        y="77"
        textAnchor="middle"
        fontSize="60"
        fontWeight="900"
        fontFamily="Poppins, Inter, sans-serif"
        fill="white"
      >
        r
      </text>

      <ellipse
        cx="48"
        cy="42"
        rx="26"
        ry="14"
        fill="url(#shine)"
        transform="rotate(-20 48 42)"
      />

      <circle cx="64" cy="64" r="46" fill="url(#glow)" />
    </svg>
  );

  if (!animateIn) return svg;

  return (
    <motion.span
      className="inline-flex"
      initial={{ opacity: 0, rotateY: 90 }}
      animate={{ opacity: 1, rotateY: 0 }}
      transition={springSoft}
      style={{ perspective: 200 }}
    >
      {svg}
    </motion.span>
  );
}

/** Icon + amount, spaced and baseline-aligned consistently — the standard
 *  way to show an R Coin quantity anywhere in the app (balance chips,
 *  plan cards, transaction rows) instead of hand-rolling the gap/align
 *  every time. `size` controls the coin only; wrap in a text-size className
 *  on a parent to control the number's size. */
export function RCoinAmount({
  value,
  size = 16,
  className,
}: {
  value: number | string;
  size?: number;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <RCoin size={size} />
      {value}
    </span>
  );
}
