import { motion } from "framer-motion";
import { cn } from "@/lib/cn.js";

export interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASSES = {
  sm: "h-4 w-4 border-2",
  md: "h-6 w-6 border-2",
  lg: "h-10 w-10 border-[3px]",
} as const;

/** A rotating ring, `rotate` is a transform, so this is fully
 *  GPU-accelerated despite running indefinitely. */
export function Spinner({ size = "md", className }: SpinnerProps) {
  return (
    <motion.span
      role="status"
      aria-label="Loading"
      animate={{ rotate: 360 }}
      transition={{ duration: 0.7, repeat: Infinity, ease: "linear" }}
      className={cn(
        "inline-block rounded-full border-(--primary)/25 border-t-(--primary)",
        SIZE_CLASSES[size],
        className,
      )}
    />
  );
}
