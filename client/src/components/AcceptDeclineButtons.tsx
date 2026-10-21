import { Check, X } from "lucide-react";
import { Button } from "./ui/Button.js";

/** The Accept / Decline pair for challenges and cage
 *  invites. `pill` is the compact style for the notifications dropdown;
 *  `button` uses the UI-kit buttons (icon-only below `sm`) for full lists. */
export function AcceptDeclineButtons({
  onAccept,
  onDecline,
  variant = "button",
}: {
  onAccept: () => void;
  onDecline: () => void;
  variant?: "pill" | "button";
}) {
  if (variant === "pill") {
    return (
      <div className="mt-1.5 flex gap-1.5">
        <button
          type="button"
          onClick={onAccept}
          className="flex items-center gap-1 rounded-full bg-(--primary) px-2.5 py-1 text-xs font-medium text-white hover:brightness-110"
        >
          <Check className="h-3 w-3" /> Accept
        </button>
        <button
          type="button"
          onClick={onDecline}
          className="flex items-center gap-1 rounded-full bg-base-300 px-2.5 py-1 text-xs font-medium text-base-content/70 hover:bg-base-300/70"
        >
          <X className="h-3 w-3" /> Decline
        </button>
      </div>
    );
  }
  return (
    <>
      <Button size="sm" onClick={onAccept}>
        <Check className="h-4 w-4" />
        <span className="hidden sm:flex">Accept</span>
      </Button>
      <Button variant="glass" size="sm" onClick={onDecline}>
        <X className="h-4 w-4" />
        <span className="hidden sm:flex">Decline</span>
      </Button>
    </>
  );
}
