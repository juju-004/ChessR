import { memo } from "react";
import { cn } from "@/lib/cn.js";

export interface TabItem {
  value: string;
  label: string;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

/**
 * The sliding active-pill indicator uses framer-motion's `layoutId` shared
 * layout animation. That looks like it's animating position/size directly,
 * but framer-motion implements it with the FLIP technique under the hood, 
 * it measures the before/after boxes and animates purely via `transform`
 * (translate + scale), so it stays on the GPU-only rule from
 * @/lib/motion.ts despite appearing to resize.
 */
export const Tabs = memo(function Tabs({
  items,
  value,
  onChange,
  className,
}: TabsProps) {
  return (
    <div
      className={cn(
        "elevated-flat inline-flex gap-1 rounded-xl p-1",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            onClick={() => onChange(item.value)}
            className={cn(
              "relative rounded-lg whitespace-nowrap px-3.5 flex py-1.5 text-sm font-medium transition-colors",
              active
                ? "text-white gradient-brand"
                : "text-base-content/60 hover:text-base-content",
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
});
