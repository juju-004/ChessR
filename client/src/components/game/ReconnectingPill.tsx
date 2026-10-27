import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";

/** Wait this long before showing the pill, so a blip that heals in a moment
 *  doesn't flash it. It hides the instant the connection is back. */
const SHOW_AFTER_MS = 600;

/** "Reconnecting" pill with three animated dots. Fades in over the top edge of
 *  the board while the socket is down. Render it inside a `relative` box that
 *  is exactly the board. */
export function ReconnectingPill({ active }: { active: boolean }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!active) {
      setShow(false);
      return;
    }
    const t = window.setTimeout(() => setShow(true), SHOW_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [active]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="reconnecting"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 6 }}
          transition={{ duration: 0.25, ease: "easeOut" }}
          className="pointer-events-none absolute left-1/2 top-0 z-40 -translate-x-1/2 -translate-y-1/2"
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-base-300 bg-base-100/95 px-3 py-1 text-xs font-semibold text-base-content shadow-lg backdrop-blur">
            Reconnecting
            <span className="inline-flex items-center gap-0.5" aria-hidden>
              <span className="reconnect-dot" />
              <span className="reconnect-dot" style={{ animationDelay: "0.18s" }} />
              <span className="reconnect-dot" style={{ animationDelay: "0.36s" }} />
            </span>
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
