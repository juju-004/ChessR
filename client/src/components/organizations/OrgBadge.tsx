import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/cn.js";

/** The badge every verified organisation gets: one fixed icon and colour set
 *  by the app (nothing to upload or customise). Shown on the owner's profile. */
export function OrgBadge({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  return (
    <span
      title={`${name} (verified organisation)`}
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full bg-amber-500/15 px-2.5 py-0.5 text-xs font-semibold text-amber-500 ring-1 ring-amber-500/30",
        className,
      )}
    >
      <BadgeCheck className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{name}</span>
    </span>
  );
}
