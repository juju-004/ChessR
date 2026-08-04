import { useState } from "react";
import { cn } from "@/lib/cn.js";
import { avatarGradientStyle } from "@/lib/avatarGradients.js";

export interface AvatarProps {
  src?: string | null;
  username: string;
  size?: "xs" | "sm" | "md" | "lg";
  /** Small colored dot in the corner — typically online/offline presence. */
  status?: "online" | "offline" | null;
  /** Preset id from avatarGradients.ts. Omit (or "brand") for the default
   *  look — falls back to the existing .gradient-brand class so old data
   *  without this field renders exactly as it always did. */
  gradient?: string | null;
  className?: string;
}

const SIZE_CLASSES = {
  xs: "h-6 w-6 text-[10px]",
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-14 w-14 text-lg",
} as const;

function initialsOf(username: string): string {
  return username.slice(0, 2).toUpperCase();
}

export function Avatar({ src, username, size = "md", status = null, gradient, className }: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const customStyle = avatarGradientStyle(gradient);

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <span
        style={customStyle}
        className={cn(
          "flex items-center justify-center overflow-hidden rounded-full font-semibold text-white select-none",
          !customStyle && "gradient-brand",
          SIZE_CLASSES[size],
        )}
      >
        {src && !imgFailed ? (
          <img
            src={src}
            alt={username}
            className="h-full w-full object-cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          initialsOf(username)
        )}
      </span>
      {status && (
        <span
          className={cn(
            "absolute right-0 bottom-0 rounded-full ring-2 ring-base-100",
            size === "lg" ? "h-3.5 w-3.5" : "h-2.5 w-2.5",
            status === "online" ? "bg-green-500" : "bg-base-content/30",
          )}
        />
      )}
    </span>
  );
}
