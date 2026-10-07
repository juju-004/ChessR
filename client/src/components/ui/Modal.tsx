import { type ReactNode, memo, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/cn.js";
import { modalBackdrop, modalContent } from "@/lib/motion.js";

// How many Modals are open right now. A modal that opens on top of another
// (e.g. a confirm dialog over a form) skips its own dim layer: stacking two
// bg-black/60 backdrops made the page visibly darker while both were open
// and then lightened it again as the top one faded out, which is the
// "backdrop blink" on close. The bottom modal's backdrop already covers the
// page, so the nested one doesn't need another.
let openModalCount = 0;

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Renders to the left of the title, e.g. an alert triangle for a
   *  destructive action or a trophy for a tournament prompt. Purely
   *  decorative, sized and colored by the caller. */
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Portal-rendered so it always sits above everything regardless of where
 * it's mounted, with a solid darkened backdrop and an elevated content
 * panel (no backdrop-filter, see the .elevated comment in index.css).
 * Backdrop and content each animate on their own opacity/scale/y, no
 * layout-affecting properties, per @/lib/motion.ts.
 *
 * Always centered, on every viewport including phone, there used to be a
 * `position="bottom"` variant that docked this as a draggable bottom
 * sheet instead, but that's gone now (see ResponsiveOverlay.tsx, which
 * used to opt into it for its phone-width Popover replacement and now
 * just renders this same centered dialog there too).
 */
export const Modal = memo(function Modal({
  open,
  onClose,
  title,
  icon,
  children,
  className,
}: ModalProps) {
  const [nested, setNested] = useState(false);
  useLayoutEffect(() => {
    if (!open) return;
    setNested(openModalCount > 0);
    openModalCount++;
    return () => {
      openModalCount--;
    };
  }, [open]);

  const header = title && (
    <div className="mb-5 flex w-full items-center gap-3 pt-2 px-2 pb-3">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>

      <h2 className="text-[17px] font-semibold tracking-tight text-base-content">
        {title}
      </h2>

      <div className="ml-auto h-px flex-1 bg-linear-to-r from-primary/60 to-transparent" />
    </div>
  );

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={modalBackdrop}
            onClick={onClose}
            className={cn(
              "absolute inset-0 will-change-[opacity]",
              nested ? "bg-transparent" : "bg-black/60",
            )}
          />
          <motion.div
            initial="hidden"
            animate="visible"
            exit="exit"
            variants={modalContent}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cn(
              "relative w-full max-w-md overflow-hidden rounded-2xl elevated-strong",
              className,
            )}
          >
            <div className="max-h-[85vh] overflow-y-auto overscroll-contain px-2 py-3">
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
