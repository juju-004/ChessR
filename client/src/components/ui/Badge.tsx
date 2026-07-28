import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn.js";

export type BadgeVariant =
  | "primary"
  | "secondary"
  | "gradient"
  | "glass"
  | "success"
  | "warning"
  | "error"
  | "neutral";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  primary: "bg-(--primary)/15 text-(--primary)",
  secondary: "bg-(--secondary)/15 text-(--secondary)",
  gradient: "gradient-brand text-white",
  glass: "glass text-base-content",
  success: "bg-green-500/15 text-green-500",
  warning: "bg-amber-500/15 text-amber-500",
  error: "bg-red-500/15 text-red-500",
  neutral: "bg-base-300 text-base-content/70",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({
  variant = "neutral",
  className,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        VARIANT_CLASSES[variant],
        className,
      )}
      {...props}
    />
  );
}
