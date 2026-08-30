import { motion } from "framer-motion";
import { cn } from "@/lib/cn.js";
import { springSoft } from "@/lib/motion.js";

export interface RCoinProps {
  /** Pixel size (square). Default 20. */
  size?: number;
  className?: string;
  /** Plays a one-shot flip-in on mount. */
  animateIn?: boolean;
}

/**
 * Premium Rabah Coin
 *
 * A beveled gold coin with a sapphire/purple center and
 * custom-minted champagne-gold R emblem.
 */
export function RCoin({ size = 20, className, animateIn = false }: RCoinProps) {
  /*
   * Unique IDs prevent multiple RCoins from sharing SVG definitions.
   */
  const id = `rcoin-${Math.random().toString(36).slice(2, 9)}`;

  const rimId = `${id}-rim`;
  const rimInnerId = `${id}-rim-inner`;
  const centerId = `${id}-center`;
  const vignetteId = `${id}-vignette`;
  const letterId = `${id}-letter`;
  const shineId = `${id}-shine`;
  const shadowId = `${id}-shadow`;

  const svg = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 128 128"
      xmlns="http://www.w3.org/2000/svg"
      className={cn("shrink-0", className)}
      aria-hidden="true"
    >
      <defs>
        {/* Outer gold rim */}
        <linearGradient id={rimId} x1="0.1" y1="0.1" x2="0.9" y2="0.9">
          <stop offset="0%" stopColor="#fff8dc" />
          <stop offset="15%" stopColor="#ffe88c" />
          <stop offset="34%" stopColor="#f5bf45" />
          <stop offset="56%" stopColor="#c88a20" />
          <stop offset="78%" stopColor="#87580f" />
          <stop offset="100%" stopColor="#422806" />
        </linearGradient>

        {/* Inner rim */}
        <linearGradient id={rimInnerId} x1="0.05" y1="0.05" x2="0.95" y2="0.95">
          <stop offset="0%" stopColor="#fffce9" />
          <stop offset="20%" stopColor="#ffdf70" />
          <stop offset="52%" stopColor="#d39a29" />
          <stop offset="78%" stopColor="#9a6413" />
          <stop offset="100%" stopColor="#65400a" />
        </linearGradient>

        {/* Sapphire / purple center */}
        <radialGradient id={centerId} cx="34%" cy="25%" r="82%">
          <stop offset="0%" stopColor="#b9d9ff" />
          <stop offset="18%" stopColor="#75a8f5" />
          <stop offset="40%" stopColor="#4c7ee0" />
          <stop offset="67%" stopColor="#6142b4" />
          <stop offset="88%" stopColor="#3b2675" />
          <stop offset="100%" stopColor="#21133f" />
        </radialGradient>

        {/* Face vignette */}
        <radialGradient id={vignetteId} cx="50%" cy="45%" r="58%">
          <stop offset="50%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity=".42" />
        </radialGradient>

        {/* Ultra-luxurious champagne & polished gold gradient */}
        <linearGradient id={letterId} x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="18%" stopColor="#fff2be" />
          <stop offset="36%" stopColor="#f7d070" />
          <stop offset="58%" stopColor="#cf9028" />
          <stop offset="76%" stopColor="#fceaa2" />
          <stop offset="100%" stopColor="#8c5811" />
        </linearGradient>

        {/* Face highlight */}
        <linearGradient id={shineId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity=".95" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </linearGradient>

        {/* Soft coin shadow */}
        <filter id={shadowId} x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="5" stdDeviation="6" floodOpacity=".4" />
        </filter>
      </defs>

      {/* OuteRabah Coin Base */}
      <circle
        cx="64"
        cy="64"
        r="60"
        fill={`url(#${rimId})`}
        filter={`url(#${shadowId})`}
      />

      {/* Milled Edge */}
      <g strokeWidth="1.4">
        {Array.from({ length: 48 }).map((_, i) => {
          const angle = (i / 48) * Math.PI * 2;
          const x1 = 64 + Math.cos(angle) * 56.5;
          const y1 = 64 + Math.sin(angle) * 56.5;
          const x2 = 64 + Math.cos(angle) * 60.5;
          const y2 = 64 + Math.sin(angle) * 60.5;

          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={i % 2 === 0 ? "#fff2c4" : "#5c3a06"}
              strokeOpacity=".4"
            />
          );
        })}
      </g>

      {/* Inner Beveled Rim */}
      <circle
        cx="64"
        cy="64"
        r="54"
        fill="none"
        stroke={`url(#${rimInnerId})`}
        strokeWidth="3.5"
      />

      {/* Dark Groove */}
      <circle
        cx="64"
        cy="64"
        r="50.5"
        fill="none"
        stroke="#3d2405"
        strokeOpacity=".5"
        strokeWidth="1.5"
      />

      {/* Center Face */}
      <circle cx="64" cy="64" r="46" fill={`url(#${centerId})`} />
      <circle cx="64" cy="64" r="46" fill={`url(#${vignetteId})`} />

      <circle
        cx="64"
        cy="64"
        r="46"
        fill="none"
        stroke="#0f172a"
        strokeOpacity=".32"
        strokeWidth="1.5"
      />

      {/* Face Shine */}
      <circle
        cx="64"
        cy="64"
        r="41"
        fill="none"
        stroke={`url(#${shineId})`}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="55 258"
        strokeDashoffset="-6"
        transform="rotate(-55 64 64)"
      />

      {/* Premium R Emblem */}
      <g transform="rotate(-2 64 64)">
        {/* Deep Ambient Drop Shadow */}
        <path
          d="
            M 44 37
            H 68
            C 78 37 85 43 85 52
            C 85 59 80 64 73 66.5
            C 76.5 68 79 71 81.5 76.5
            L 86 87
            H 74.5
            L 70.5 77.5
            C 68.5 72.5 65.5 70.5 58.5 70.5
            H 55
            V 87
            H 44
            Z

            M 55 46.5
            V 61
            H 66
            C 71 61 74 58.5 74 53.7
            C 74 49 71 46.5 66 46.5
            Z
          "
          fill="#0c051f"
          opacity=".85"
          transform="translate(2.5, 3.2)"
        />

        {/* Chiseled Base / Dark Under-bevel */}
        <path
          d="
            M 44 37
            H 68
            C 78 37 85 43 85 52
            C 85 59 80 64 73 66.5
            C 76.5 68 79 71 81.5 76.5
            L 86 87
            H 74.5
            L 70.5 77.5
            C 68.5 72.5 65.5 70.5 58.5 70.5
            H 55
            V 87
            H 44
            Z

            M 55 46.5
            V 61
            H 66
            C 71 61 74 58.5 74 53.7
            C 74 49 71 46.5 66 46.5
            Z
          "
          fill="#784e11"
          stroke="#523207"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />

        {/* Main Body */}
        <path
          d="
            M 44 37
            H 68
            C 78 37 85 43 85 52
            C 85 59 80 64 73 66.5
            C 76.5 68 79 71 81.5 76.5
            L 86 87
            H 74.5
            L 70.5 77.5
            C 68.5 72.5 65.5 70.5 58.5 70.5
            H 55
            V 87
            H 44
            Z

            M 55 46.5
            V 61
            H 66
            C 71 61 74 58.5 74 53.7
            C 74 49 71 46.5 66 46.5
            Z
          "
          fill={`url(#${letterId})`}
          stroke="#fff8d6"
          strokeWidth=".5"
          strokeLinejoin="round"
          paintOrder="stroke fill"
        />

        {/* Top Outer Highlight Crest */}
        <path
          d="
            M 44 37.5
            H 68
            C 77.5 37.5 84 43 84 52
            C 84 58 79.5 63 72.5 65.5
          "
          fill="none"
          stroke="#ffffff"
          strokeWidth="1.25"
          strokeLinecap="round"
          opacity=".9"
        />

        {/* Left Vertical Spine Highlight */}
        <path
          d="M 45 37.5 V 86"
          fill="none"
          stroke="#ffffff"
          strokeWidth="1.1"
          strokeLinecap="round"
          opacity=".85"
        />

        {/* Inner Bowl Light Reflection */}
        <path
          d="
            M 56 47.5
            V 59.8
            H 65.5
            C 69.8 59.8 72.5 57.5 72.5 53.7
            C 72.5 49.8 69.8 47.5 65.5 47.5
          "
          fill="none"
          stroke="#fffbe3"
          strokeWidth=".8"
          strokeLinecap="round"
          opacity=".75"
        />

        {/* Sweeping Right Leg Metallic Ridge */}
        <path
          d="M 60 70.5 C 66.5 70.5 69.5 72.5 71.5 77.5 L 75.5 87"
          fill="none"
          stroke="#ffffff"
          strokeWidth="1"
          strokeLinecap="round"
          opacity=".8"
        />
      </g>
    </svg>
  );

  if (!animateIn) {
    return svg;
  }

  return (
    <motion.span
      className="inline-flex"
      initial={{
        opacity: 0,
        rotateY: 90,
      }}
      animate={{
        opacity: 1,
        rotateY: 0,
      }}
      transition={springSoft}
      style={{
        perspective: 200,
      }}
    >
      {svg}
    </motion.span>
  );
}

/**
 * Icon + amount.
 *
 * Example:
 * <RCoinAmount value={250} />
 */
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
