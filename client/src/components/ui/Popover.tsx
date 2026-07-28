import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/cn.js";
import { scaleIn } from "@/lib/motion.js";

export interface PopoverProps {
  /** The element that opens the popover on click. Rendered as-is — the
   *  click handler is attached to a wrapping <span>, so pass whatever you
   *  like (an icon button, a Button, plain text). */
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  side?: "bottom" | "top";
  className?: string;
  /** Omit to let Popover manage its own open state (the common case) — pass
   *  both to drive it externally (e.g. Dropdown does this). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * The shared floating-panel primitive behind Dropdown (and anything else
 * that needs a "click to reveal a glass panel anchored to a trigger"
 * pattern). Closes on outside click or Escape. Entrance/exit is opacity +
 * scale only (see @/lib/motion.ts) with `transformOrigin` set to the
 * corner it's anchored from, so it visibly "grows out of" the trigger
 * rather than just scaling from its own center.
 */
export function Popover({
  trigger,
  children,
  align = "start",
  side = "bottom",
  className,
  open: openProp,
  onOpenChange,
}: PopoverProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const containerRef = useRef<HTMLDivElement>(null);

  function setOpen(next: boolean) {
    onOpenChange?.(next);
    if (openProp === undefined) setInternalOpen(next);
  }

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      )
        setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div ref={containerRef} className="relative inline-block">
      <span onClick={() => setOpen(!open)}>{trigger}</span>
      <AnimatePresence>
        {open && (
          <motion.div
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={scaleIn}
            style={{
              transformOrigin: `${side === "bottom" ? "top" : "bottom"} ${align === "start" ? "left" : "right"}`,
            }}
            className={cn(
              "glass-strong absolute z-50 min-w-40 rounded-xl p-1.5",
              side === "bottom" ? "top-full mt-2" : "bottom-full mb-2",
              align === "start" ? "left-0" : "right-0",
              className,
            )}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
