import { forwardRef, type HTMLAttributes } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/cn.js";
import { liftable } from "@/lib/motion.js";

export interface CardProps extends Omit<HTMLMotionProps<"div">, "ref"> {
  /** `glass` = the default liquid-glass surface. `solid` = opaque daisyUI
   *  base-200 surface, for places a translucent card would sit awkwardly
   *  (e.g. stacked directly on another glass surface). `strong` = a more
   *  opaque/blurred glass variant for content that needs more contrast
   *  (modals, anything over a busy background). */
  variant?: "glass" | "solid" | "strong";
  /** Adds the hover-lift + tap-shrink micro-interaction — for cards that are
   *  themselves clickable (e.g. wrapped in a Link). Leave off for static
   *  content cards. */
  interactive?: boolean;
}

const VARIANT_CLASSES: Record<NonNullable<CardProps["variant"]>, string> = {
  glass: "glass",
  strong: "glass-strong",
  solid: "bg-base-200 border border-base-300",
};

/** The base surface used by every other card-shaped thing in the ui kit. */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = "glass", interactive = false, className, children, ...props },
  ref,
) {
  const motionProps: Partial<HTMLMotionProps<"div">> = interactive ? liftable : {};

  return (
    <motion.div
      ref={ref}
      className={cn("rounded-2xl p-4", VARIANT_CLASSES[variant], interactive && "cursor-pointer", className)}
      {...motionProps}
      {...props}
    >
      {children}
    </motion.div>
  );
});

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-3 flex items-center justify-between gap-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-base font-semibold text-base-content", className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm text-base-content/60", className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-sm text-base-content/80", className)} {...props} />;
}

export function CardFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mt-4 flex items-center gap-2", className)} {...props} />;
}
