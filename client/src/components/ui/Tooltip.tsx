import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/cn.js";
import { tweenFast } from "@/lib/motion.js";
import { useSettings } from "@/contexts/SettingsContext.js";

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}

const SIDE_CLASSES: Record<NonNullable<TooltipProps["side"]>, string> = {
  top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
  bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
  left: "right-full top-1/2 -translate-y-1/2 mr-2",
  right: "left-full top-1/2 -translate-y-1/2 ml-2",
};

const SIDE_OFFSET: Record<NonNullable<TooltipProps["side"]>, { y?: number; x?: number }> = {
  top: { y: 4 },
  bottom: { y: -4 },
  left: { x: 4 },
  right: { x: -4 },
};

/** Simple hover/focus tooltip — a small glass label, fades + nudges in on
 *  its offset axis only (still transform+opacity only). Skips framer-motion
 *  entirely (not just its animated values) when Settings.reduceMotion is
 *  on — see the matching comment in Popover.tsx. */
export function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  const [open, setOpen] = useState(false);
  const offset = SIDE_OFFSET[side];
  const { settings } = useSettings();

  const tooltipClassName = cn(
    "glass-strong pointer-events-none absolute z-50 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-medium text-base-content",
    SIDE_CLASSES[side],
    className,
  );

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={() => {
        // On touch devices there's no mouseleave to close this — tapping
        // the trigger fires onFocus (opening it) same as a real focus, but
        // then nothing ever blurs it since focus just stays put after a
        // tap, so it was sitting there forever until something else on the
        // page happened to steal focus. Closing on every click covers
        // touch taps; blurring the element too stops focus from
        // immediately reopening it via a lingering :focus state.
        setOpen(false);
        if (
          document.activeElement instanceof HTMLElement &&
          document.activeElement !== document.body
        ) {
          document.activeElement.blur();
        }
      }}
    >
      {children}
      {settings.reduceMotion ? (
        open && (
          <span role="tooltip" className={tooltipClassName}>
            {content}
          </span>
        )
      ) : (
        <AnimatePresence>
          {open && (
            <motion.span
              role="tooltip"
              initial={{ opacity: 0, ...offset }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, ...offset }}
              transition={tweenFast}
              className={tooltipClassName}
            >
              {content}
            </motion.span>
          )}
        </AnimatePresence>
      )}
    </span>
  );
}
