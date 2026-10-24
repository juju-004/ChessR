import { Axe } from "lucide-react";
import { cn } from "@/lib/cn.js";

/** Berserk mark: a battle axe. Stroked like every other lucide icon, so it
 *  takes its colour from `currentColor`; size it with h-/w- classes. */
export function BerserkIcon({
  className,
  title,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <Axe
      strokeWidth={2.4}
      className={cn("shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
    </Axe>
  );
}
