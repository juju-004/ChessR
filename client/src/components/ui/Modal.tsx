import { type ReactNode, memo, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  motion,
  useDragControls,
  type PanInfo,
} from "framer-motion";
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
  /** Renders to the left of the title, e.g. an alert triangle for a
   *  destructive action or a trophy for a tournament prompt. Purely
   *  decorative — sized and colored by the caller. */
  icon?: ReactNode;
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
  icon,
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

  // Manual drag start instead of the default listener: a pointer-down
  // anywhere on the sheet can start the drag EXCEPT when it lands inside
  // the scrollable body while that body is scrolled away from its top —
  // there, the gesture is left alone so the browser scrolls the content
  // instead of the two fighting over the same vertical swipe. Once the
  // content is back at scrollTop 0 (or doesn't need to scroll at all), a
  // pull from anywhere — content included — drags the sheet again.
  const scrollRef = useRef<HTMLDivElement>(null);
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
    <div className="mb-4 flex rounded-2xl  justify-center bg-base-200 pt-5 pb-3 items-center gap-2">
      {icon}
      <h2 className="text-lg font-semibold text-base-content">{title}</h2>
    </div>
  );

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className={cn(
            "fixed inset-0  z-50 flex",
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
            onPointerDown={(e) => {
              if (!isSheet) return;
              const scrollEl = scrollRef.current;
              if (
                !scrollEl ||
                !scrollEl.contains(e.target as Node) ||
                scrollEl.scrollTop <= 0
              ) {
                dragControls.start(e);
              }
            }}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            dragTransition={dragSpring}
            onDragEnd={isSheet ? handleDragEnd : undefined}
            style={isSheet ? { willChange: "transform" } : undefined}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn(
              "relative w-full overflow-hidden",
              // The centered dialog is static (only a brief, one-off
              // entrance/exit) so its shadow is cheap. The sheet is
              // continuously dragged and its entrance slides the full
              // height of the screen, so it skips the shadow entirely
              // (elevated-flat, same background with no box-shadow) — a
              // moving box-shadow has to be blur-rasterized on every
              // single frame it's on screen, which is exactly what was
              // making the sheet feel laggy (same tradeoff index.css
              // documents for Tabs/Dashboard's balance card, which reach
              // for elevated-responsive's border swap; skipped that here
              // instead since its shadow only kicks back in `sm` and up,
              // which would still leave a range of "mobile" widths where
              // this sheet is dragged with the shadow back on).
              isSheet
                ? "elevated-flat border-t border-base-300 rounded-t-4xl"
                : "elevated-strong max-w-md rounded-2xl",
              className,
            )}
          >
            {isSheet && (
              <div className="left-1/2 -translate-x-1/2 absolute flex justify-center py-2">
                <div className="h-1 w-10 rounded-full bg-base-content/15" />
              </div>
            )}
            <div
              ref={scrollRef}
              className={cn(
                "max-h-[85vh] overflow-y-auto overscroll-contain px-2 ",
                isSheet && "pb-[calc(1.25rem+env(safe-area-inset-bottom))]",
              )}
            >
              {header}
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
});
