import { cn } from "@/lib/cn.js";
import { Spinner } from "./Spinner.js";

/** A spinner centred in its own block, the "list is loading" state. Pass a
 *  `py-*` class to size the block (page-level loads use more than a card). */
export function CenteredSpinner({
  size = "md",
  className,
}: {
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  return (
    <div className={cn("flex justify-center py-6", className)}>
      <Spinner size={size} className="text-base-content/40" />
    </div>
  );
}
