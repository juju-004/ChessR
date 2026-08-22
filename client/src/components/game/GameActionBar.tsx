import { ArrowLeftCircle, MoreVertical } from "lucide-react";
import { Button, Tooltip, Dropdown, DropdownItem } from "../ui/index.js";
import { cn } from "../../lib/cn.js";
import { useNavigate } from "react-router-dom";

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

/** In-game mobile action bar — occupies the same fixed-bottom slot as the
 *  site-navigation dock (see `.dock` in index.css and MobileDock in
 *  components/Sidebar.tsx, which hides itself on /game/:code so this is
 *  the only thing rendered there).
 *
 *  Three zones so nothing important can get squeezed off-screen: a pinned
 *  back button on the left (so you're never stuck without a way out of a
 *  game mid-match — the old version dropped nav entirely here), a
 *  horizontally-scrollable middle for the
 *  reached-for-constantly items (flip/prev/next/share/etc — however many
 *  there are, they scroll rather than shrinking to illegible slivers),
 *  and a pinned "More" dropup on the right for resign/draw/abort/etc so
 *  it's always in the same spot and never scrolled out of view. */
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
  const navigate = useNavigate();

  function handleBack() {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof idx === "number" && idx > 0) {
      navigate(-1);
    } else {
      navigate("/");
    }
  }

  if (primaryItems.length === 0) return null;
  return (
    <nav aria-label="Game actions" className="docker game flex md:hidden">
      <button
        type="button"
        aria-label="Back"
        className={"docker-item docker-item-grow"}
        onClick={handleBack}
      >
        <ArrowLeftCircle className="h-5 w-5 text-primary" />
      </button>

      {primaryItems.map((item) => {
        const hold = holdFor(item, prevHold, nextHold);
        return (
          <button
            key={item.label}
            type="button"
            aria-label={item.label}
            disabled={item.disabled}
            className={cn(
              "docker-item docker-item-grow",
              item.danger && "docker-item-danger",
            )}
            {...(hold ?? { onClick: item.onClick })}
          >
            <item.icon className="h-5 w-5" />
          </button>
        );
      })}
      <Dropdown
        trigger={
          <button
            type="button"
            aria-label="More actions"
            className="docker-item w-full docker-item-grow"
          >
            <MoreVertical className="h-5 w-5" />
          </button>
        }
        items={overflowItems as DropdownItem[]}
        align="end"
        side="top"
      />
    </nav>
  );
}
