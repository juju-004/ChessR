import { useState } from "react";
import { cn } from "@/lib/cn.js";
import { avatarGradientStyle, parseAvatarStyle } from "@/lib/avatarGradients.js";
import { AvatarIconGlyph, findAvatarIcon } from "@/lib/avatarIcons.js";

export interface AvatarProps {
  src?: string | null;
  username: string;
  size?: "xs" | "compact" | "sm" | "md" | "lg" | "xl";
  /** Size to switch to from the `md` breakpoint up, for avatars that should
   *  be compact on phone but roomier on desktop (e.g. the game page's
   *  player panels). Omit to keep `size` at every width. */
  mdSize?: "xs" | "compact" | "sm" | "md" | "lg" | "xl";
  /** Small colored dot in the corner, typically online/offline presence. */
  status?: "online" | "offline" | null;
  /** Preset id from avatarGradients.ts. Omit (or "brand") for the default
   *  look, falls back to the existing .gradient-brand class so old data
   *  without this field renders exactly as it always did. */
  gradient?: string | null;
  className?: string;
}

const SIZE_CLASSES = {
  xs: "h-6 w-6 text-[10px]",
  compact: "h-7 w-7 text-[11px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-lg",
  xl: "h-24 w-24 text-3xl",
} as const;

// Literal class strings (not built from `md:${...}`) so Tailwind's scanner
// can see them.
const MD_SIZE_CLASSES = {
  xs: "md:h-6 md:w-6 md:text-[10px]",
  compact: "md:h-7 md:w-7 md:text-[11px]",
  sm: "md:h-8 md:w-8 md:text-xs",
  md: "md:h-10 md:w-10 md:text-sm",
  lg: "md:h-14 md:w-14 md:text-lg",
  xl: "md:h-24 md:w-24 md:text-3xl",
} as const;

function initialsOf(username: string): string {
  return username.slice(0, 2).toUpperCase();
}

export function Avatar({
  src,
  username,
  size = "md",
  mdSize,
  status = null,
  gradient,
  className,
}: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const customStyle = avatarGradientStyle(gradient);
  const iconId = parseAvatarStyle(gradient).iconId;
  const hasIcon = !!findAvatarIcon(iconId);

  return (
    // rounded-full on the wrapper itself, not just the inner disc: callers pass
    // rings / offsets / shadows via `className`, and those paint on THIS
    // element's box. Without a radius here they rendered as a square frame
    // around the round avatar (puzzle podium, invite landing).
    <span className={cn("relative inline-flex shrink-0 rounded-full", className)}>
      <span
        style={customStyle}
        className={cn(
          "flex items-center justify-center overflow-hidden rounded-full font-semibold text-white select-none",
          !customStyle && "gradient-brand",
          SIZE_CLASSES[size],
          mdSize && MD_SIZE_CLASSES[mdSize],
        )}
      >
        {src && !imgFailed ? (
          <img
            src={src}
            alt={username}
            className="h-full w-full object-cover"
            onError={() => setImgFailed(true)}
          />
        ) : hasIcon ? (
          <AvatarIconGlyph id={iconId!} className="h-full w-full" />
        ) : (
          initialsOf(username)
        )}
      </span>
      {status && (
        <span
          className={cn(
            "absolute right-0 bottom-0 rounded-full ring-2 ring-base-100",
            size === "xl" ? "h-5 w-5" : size === "lg" ? "h-3.5 w-3.5" : "h-2.5 w-2.5",
            status === "online" ? "bg-green-500" : "bg-neutral-500",
          )}
        />
      )}
    </span>
  );
}
