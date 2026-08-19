import { type ReactNode, memo, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  useDragControls,
  type PanInfo,
} from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/cn.js";
import { modalBackdrop, modalContent, sheetContent } from "@/lib/motion.js";

// Below this width, the sheet takes over completely — see the isMobile note
// below. Matches the phone/desktop split everywhere else in the app
// (Sidebar, ResponsiveOverlay, the mobile dock).
const MOBILE_BREAKPOINT = 768;

// How far (px) or how fast (px/s) a drag has to travel before it counts as
// "let go of the sheet" rather than "let go while still deciding". Two
// checks so a fast flick dismisses even if it didn't travel far yet.
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 600;

// Same feel as lib/motion.ts's springSnappy, spelled out here as plain
// numbers since dragTransition's bounceStiffness/bounceDamping are a
// distinct (looser-typed) shape from a regular Transition and don't accept
// that object directly.
const dragSpring = { bounceStiffness: 420, bounceDamping: 32 };

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
  /** `center` (default) is the usual dialog, floating in the middle of the
   *  screen. `bottom` docks it to the bottom edge instead, full-width with
   *  only the top corners rounded — reads as a native bottom sheet, which
   *  is a friendlier target than a small centered dialog on a phone.
   *  Ignored on phone screens, which are always a bottom sheet regardless
   *  of what's passed here — see isMobile below. Still respected on
   *  desktop, where a caller can opt into `bottom` deliberately. */
  position?: "center" | "bottom";
}

/**
 * Portal-rendered so it always sits above everything regardless of where
 * it's mounted, with a solid darkened backdrop and an elevated content
 * panel (no backdrop-filter — see the .elevated comment in index.css).
 * Backdrop and content each animate on their own opacity/scale/y — no
 * layout-affecting properties, per @/lib/motion.ts.
 *
 * On phone, position is always `bottom`: a small centered dialog is a
 * fiddly touch target and doesn't dock to a thumb-reachable edge the way a
 * sheet does, so there's no good reason to ever show the centered variant
 * below MOBILE_BREAKPOINT. The `position` prop only takes effect at
 * desktop widths.
 */
export const Modal = memo(function Modal({
  open,
  onClose,
  title,
  children,
  className,
  position = "center",
}: ModalProps) {
  const [isMobile, setIsMobile] = useState(
    () =>
      typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT,
  );

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  const isSheet = isMobile || position === "bottom";

  // Drag is scoped to the handle bar via dragControls/dragListener={false}
  // rather than the whole sheet, so dragging inside scrollable content
  // scrolls the content instead of fighting the sheet for the gesture.
  const dragControls = useDragControls();

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (
      info.offset.y > DISMISS_DISTANCE ||
      info.velocity.y > DISMISS_VELOCITY
    ) {
      onClose();
    }
    // Otherwise leave it alone — dragConstraints + dragTransition below
    // spring it back to y: 0 on their own, no manual snap-back needed.
  };

  const header = title && (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-lg font-semibold text-base-content">{title}</h2>
      <button
        onClick={onClose}
        aria-label="Close"
        className="rounded-lg p-1 text-base-content/50 transition-colors hover:bg-black/5 hover:text-base-content dark:hover:bg-white/10"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className={cn(
            "fixed inset-0 z-50 flex",
            isSheet
              ? "items-end justify-center"
              : "items-center justify-center p-4",
          )}
        >
          <motion.div
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={modalBackdrop}
            onClick={onClose}
            className="absolute inset-0 bg-black/60"
          />
          <motion.div
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={isSheet ? sheetContent : modalContent}
            drag={isSheet ? "y" : false}
            dragListener={false}
            dragControls={dragControls}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            dragTransition={dragSpring}
            onDragEnd={isSheet ? handleDragEnd : undefined}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn(
              "elevated-strong relative w-full max-h-[85vh] overflow-y-auto px-2 py-1",
              isSheet
                ? "rounded-t-3xl pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
                : "max-w-md rounded-2xl",
              className,
            )}
          >
            {isSheet && (
              <div
                onPointerDown={(e) => dragControls.start(e)}
                className="-mt-1 flex touch-none justify-center py-2 cursor-grab active:cursor-grabbing"
              >
                <div className="h-1 w-10 rounded-full bg-base-content/15" />
              </div>
            )}
            {header}
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
});
