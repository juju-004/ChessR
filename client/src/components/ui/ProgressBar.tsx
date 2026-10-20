import { cn } from "@/lib/cn.js";

/** A thin progress bar. `highlight` draws it in the primary colour (yours),
 *  otherwise a muted one (someone else's). */
export function ProgressBar({
  value,
  total,
  highlight = true,
  className,
}: {
  value: number;
  total: number;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-base-300", className)}>
      <div
        className={cn(
          "h-full rounded-full transition-all duration-300",
          highlight ? "bg-(--primary)" : "bg-base-content/40",
        )}
        style={{ width: `${total ? Math.min(100, (value / total) * 100) : 0}%` }}
      />
    </div>
  );
}
