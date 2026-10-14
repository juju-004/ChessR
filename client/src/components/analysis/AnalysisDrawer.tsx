import { type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { sheetIn, sheetOut } from "../../lib/motion.js";

/**
 * Right-side drawer for the phone layout of the analysis page. Same shell
 * as ChatDrawer's desktop drawer (flat surface, plain border, no shadow,
 * backdrop tap to close), portaled to <body> because the page shell
 * animates with a transform, which would otherwise pin a fixed element to
 * the page instead of the screen.
 */
export function AnalysisDrawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 bg-black/60"
          onClick={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: sheetIn }}
          exit={{ opacity: 0, transition: sheetOut }}
        >
          <motion.div
            className="elevated-flat absolute inset-y-0 right-0 flex w-[88%] max-w-sm flex-col gap-3 overflow-y-auto border-l border-base-300/60 p-4 will-change-transform"
            style={{
              paddingTop: "calc(1rem + env(safe-area-inset-top))",
              paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
            }}
            onClick={(e) => e.stopPropagation()}
            initial={{ x: "100%" }}
            animate={{ x: 0, transition: sheetIn }}
            exit={{ x: "100%", transition: sheetOut }}
          >
            <div className="flex shrink-0 items-center justify-between">
              <h2 className="text-base font-semibold text-base-content">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="text-base-content/50 hover:text-base-content/80"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
