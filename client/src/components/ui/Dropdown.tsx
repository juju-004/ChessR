import { useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn.js";
import { Popover } from "./Popover.js";

export interface DropdownItem {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface DropdownProps {
  trigger: ReactNode;
  items: DropdownItem[];
  align?: "start" | "end";
  side?: "bottom" | "top";
}

/** A menu of clickable items in a Popover — closes itself after any item is
 *  clicked. For anything richer than a flat action list (a form, a custom
 *  layout), reach for <Popover> directly instead. */
export function Dropdown({ trigger, items, align = "end", side = "bottom" }: DropdownProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover trigger={trigger} open={open} onOpenChange={setOpen} align={align} side={side}>
      <div role="menu" className="flex flex-col">
        {items.map((item, i) => {
          const Icon = item.icon;
          return (
            <button
              key={i}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                item.onClick();
                setOpen(false);
              }}
              className={cn(
                "flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
                "disabled:opacity-40 disabled:pointer-events-none",
                item.danger
                  ? "text-red-500 hover:bg-red-500/10"
                  : "text-base-content hover:bg-black/5 dark:hover:bg-white/10",
              )}
            >
              {Icon && <Icon className="h-4 w-4 shrink-0" />}
              {item.label}
            </button>
          );
        })}
      </div>
    </Popover>
  );
}
