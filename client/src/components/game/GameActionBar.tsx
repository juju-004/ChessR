import { MoreHorizontal } from "lucide-react";
import { Button, Tooltip, Dropdown, DropdownItem } from "../ui/index.js";

export interface GameActionItem {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
  id?: string;
  mobilePrimary?: boolean;
}

interface HoldHandlers {
  onPointerDown: () => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
  onClick: () => void;
}

function holdFor(
  item: GameActionItem,
  prevHold: HoldHandlers,
  nextHold: HoldHandlers,
): HoldHandlers | null {
  if (item.id === "prev") return prevHold;
  if (item.id === "next") return nextHold;
  return null;
}

/** Desktop right-panel action button row — flip/prev/next, resign/draw/
 *  cage-match actions, spectator chat trigger, etc. Rendered as plain
 *  inline Buttons from md up. */
export function GameActionBarDesktop({
  actionItems,
  prevHold,
  nextHold,
}: {
  actionItems: GameActionItem[];
  prevHold: HoldHandlers;
  nextHold: HoldHandlers;
}) {
  if (actionItems.length === 0) return null;
  return (
    <>
      {actionItems.map((item) => {
        const hold = holdFor(item, prevHold, nextHold);
        return (
          <Tooltip key={item.label} content={item.label}>
            <Button
              variant={item.danger ? "danger" : "glass"}
              disabled={item.disabled}
              {...(hold ?? { onClick: item.onClick })}
            >
              <item.icon className="h-4 w-4" />
            </Button>
          </Tooltip>
        );
      })}
    </>
  );
}

/** Mobile action pill — fixed to the bottom of the screen instead of
 *  sitting in normal flow, so it's always reachable without scrolling.
 *  Only the items reached for constantly mid-game stay always visible;
 *  the rest collapse into the "More" dropup via the Dropdown primitive so
 *  the pill stays a fixed, compact size regardless of game state. */
export function GameActionBarMobile({
  primaryItems,
  overflowItems,
  prevHold,
  nextHold,
}: {
  primaryItems: GameActionItem[];
  overflowItems: GameActionItem[];
  prevHold: HoldHandlers;
  nextHold: HoldHandlers;
}) {
  if (primaryItems.length === 0) return null;
  return (
    <div
      className="md:hidden fixed inset-x-0 z-40 flex justify-center px-3"
      style={{ bottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
    >
      <div className="elevated-strong flex items-center gap-1 rounded-full p-1.5">
        {primaryItems.map((item) => {
          const hold = holdFor(item, prevHold, nextHold);
          return (
            <Tooltip key={item.label} content={item.label}>
              <button
                type="button"
                aria-label={item.label}
                disabled={item.disabled}
                className="flex size-10 shrink-0 items-center justify-center rounded-full text-base-content/80 transition-colors hover:bg-base-content/10 hover:text-base-content disabled:opacity-40 disabled:pointer-events-none"
                {...(hold ?? { onClick: item.onClick })}
              >
                <item.icon className="h-4 w-4" />
              </button>
            </Tooltip>
          );
        })}
        {overflowItems.length > 0 && (
          <Dropdown
            trigger={
              <button
                type="button"
                aria-label="More actions"
                className="flex size-10 shrink-0 items-center justify-center rounded-full text-base-content/80 transition-colors hover:bg-base-content/10 hover:text-base-content"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            }
            items={overflowItems as DropdownItem[]}
            align="end"
            side="top"
          />
        )}
      </div>
    </div>
  );
}
