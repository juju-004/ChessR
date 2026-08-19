import { HelpCircle } from "lucide-react";
import { Popover } from "./ui/index.js";

/** A small "?" icon that reveals a short explanation on click/tap. Used on
 *  the create-tournament and create-cage-match forms to move field-level
 *  explanations out of always-visible helper paragraphs (which made those
 *  forms read like a wall of text) and into something you only see if you
 *  actually want it.
 *
 *  Built on Popover rather than Tooltip: Tooltip is `whitespace-nowrap`
 *  and meant for short one-line labels, so a paragraph of help text would
 *  render as one unbroken line off the edge of the screen. Popover already
 *  handles arbitrary-width content, viewport clamping, and touch (click
 *  to open/close) — all needed by explanations more than a sentence long. */
export function HelpTip({ children }: { children: React.ReactNode }) {
  return (
    <Popover
      align="center"
      trigger={
        <button
          type="button"
          aria-label="More info"
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-base-content/40 hover:text-base-content/70"
        >
          <HelpCircle className="h-3.5 w-3.5" />
        </button>
      }
    >
      <div className="max-w-64 p-1.5 text-xs leading-relaxed text-base-content/70">
        {children}
      </div>
    </Popover>
  );
}
