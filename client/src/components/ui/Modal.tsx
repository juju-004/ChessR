import { type ReactNode, memo } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/cn.js";
import { modalBackdrop, modalContent } from "@/lib/motion.js";

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
}

/**
 * Portal-rendered so it always sits above everything regardless of where
 * it's mounted, with a solid darkened backdrop and an elevated content
 * panel (no backdrop-filter — see the .elevated comment in index.css).
 * Backdrop and content each animate on their own opacity/scale/y — no
 * layout-affecting properties, per @/lib/motion.ts.
 *
 * Always centered, on every viewport including phone — there used to be a
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
  const header = title && (
    <div className="mb-4 flex items-center justify-center gap-2.5 pt-1">
      {icon}
      <h2 className="text-lg font-semibold text-base-content">{title}</h2>
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
            className="absolute inset-0 bg-black/60"
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
