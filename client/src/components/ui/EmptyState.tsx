import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn.js";

/** Centred "nothing here yet" block for a list or page with no items. */
export function EmptyState({
  icon: Icon,
  children,
  className,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 py-8 text-center",
        className,
      )}
    >
      {Icon && <Icon className="h-8 w-8 text-base-content/30" />}
      <p className="text-sm text-base-content/60">{children}</p>
    </div>
  );
}
