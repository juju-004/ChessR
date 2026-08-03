import { type ReactNode, memo } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/cn.js";
import { modalBackdrop, modalContent } from "@/lib/motion.js";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Portal-rendered so it always sits above everything regardless of where
 * it's mounted, with a solid darkened backdrop and an elevated content
 * panel (no backdrop-filter — see the .glass comment in index.css).
 * Backdrop and content each animate on their own opacity/scale/y — no
 * layout-affecting properties, per @/lib/motion.ts.
 */
export const Modal = memo(function Modal({ open, onClose, title, children, className }: ModalProps) {
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
            className={cn("glass-strong relative w-full max-w-md rounded-2xl p-5", className)}
          >
            {title && (
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
            )}
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
})
