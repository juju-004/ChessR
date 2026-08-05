import { useLayoutEffect, useEffect, useRef, useState, type CSSProperties, type ReactNode, memo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/cn.js";
import { scaleIn } from "@/lib/motion.js";
import { useSettings } from "@/contexts/SettingsContext.js";

export interface PopoverProps {
  /** The element that opens the popover on click. Rendered as-is — the
   *  click handler is attached to a wrapping <span>, so pass whatever you
   *  like (an icon button, a Button, plain text). */
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end" | "center";
  side?: "bottom" | "top";
  className?: string;
  /** Omit to let Popover manage its own open state (the common case) — pass
   *  both to drive it externally (e.g. Dropdown does this). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const HIDDEN_STYLE: CSSProperties = { position: "fixed", top: 0, left: 0, visibility: "hidden" };

/**
 * The shared floating-panel primitive behind Dropdown (and anything else
 * that needs a "click to reveal a glass panel anchored to a trigger"
 * pattern). Closes on outside click or Escape. Entrance/exit is opacity +
 * scale only (see @/lib/motion.ts) with `transformOrigin` set to the
 * corner it's anchored from, so it visibly "grows out of" the trigger
 * rather than just scaling from its own center.
 *
 * Positioning is `position: fixed`, computed from the trigger's actual
 * on-screen rect and clamped to the viewport (with a small margin) —
 * rather than pure CSS `left-0`/`right-0` anchoring, which has no idea
 * how much room is actually left on screen and will happily run a wide
 * panel straight off the edge when the trigger sits near it. A
 * ResizeObserver keeps it clamped even if the panel's own content
 * changes size after opening (e.g. a list that loads in async).
 */
export const Popover = memo(function Popover({
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
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>(HIDDEN_STYLE);
  const { settings } = useSettings();

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

  // Measure the trigger + panel and pick a fixed, viewport-clamped
  // position. Runs in a layout effect so it resolves before the browser
  // paints — no visible jump from the fallback HIDDEN_STYLE corner.
  useLayoutEffect(() => {
    if (!open) {
      setStyle(HIDDEN_STYLE);
      return;
    }
    const trigger = containerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return;

    const MARGIN = 12;
    const GAP = 8;

    function reposition() {
      if (!trigger || !panel) return;
      const triggerRect = trigger.getBoundingClientRect();
      // offsetWidth/offsetHeight, not getBoundingClientRect(), for the
      // panel's own size: the panel is mid-entrance-animation (scaleIn
      // starts at scale: 0.92), and getBoundingClientRect reports the
      // currently-transformed box, so measuring it here would size the
      // panel as if it were still slightly shrunk — off by just enough
      // to look "deformed" until something (e.g. scroll) re-triggers a
      // reposition after the animation has settled. offsetWidth/Height
      // are the untransformed layout box, so they're correct from the
      // very first paint.
      const panelWidth = panel.offsetWidth;
      const panelHeight = panel.offsetHeight;

      let left =
        align === "start"
          ? triggerRect.left
          : align === "end"
            ? triggerRect.right - panelWidth
            : triggerRect.left + triggerRect.width / 2 - panelWidth / 2;
      left = Math.min(left, window.innerWidth - panelWidth - MARGIN);
      left = Math.max(left, MARGIN);

      let top =
        side === "bottom" ? triggerRect.bottom + GAP : triggerRect.top - panelHeight - GAP;
      top = Math.min(top, window.innerHeight - panelHeight - MARGIN);
      top = Math.max(top, MARGIN);

      setStyle({ position: "fixed", top, left, visibility: "visible" });
    }

    reposition();
    const resizeObserver = new ResizeObserver(reposition);
    resizeObserver.observe(panel);

    // Scroll can fire dozens of times per second on a touch-scroll fling,
    // and this handler was running synchronously on every single one of
    // them: a layout-forcing getBoundingClientRect() read immediately
    // followed by a React setState. Un-throttled and non-passive, that's
    // the browser blocking the actual scroll from compositing until that
    // JS finishes — real, measurable scroll jank, but *only* while a
    // Popover/Dropdown happens to be open, which is why it wouldn't show
    // up as constant lag. rAF-throttling collapses a whole flurry of
    // scroll events into at most one reposition per animation frame, and
    // `{ passive: true }` tells the browser up front that this handler
    // will never call preventDefault(), so it doesn't have to wait on it
    // before scrolling.
    let rafId: number | null = null;
    function onScrollOrResize() {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        reposition();
      });
    }
    window.addEventListener("resize", onScrollOrResize, { passive: true });
    window.addEventListener("scroll", onScrollOrResize, { capture: true, passive: true });
    return () => {
      resizeObserver.disconnect();
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onScrollOrResize);
      window.removeEventListener("scroll", onScrollOrResize, true);
    };
  }, [open, align, side]);

  const panelStyle: CSSProperties = {
    ...style,
    transformOrigin: `${side === "bottom" ? "top" : "bottom"} ${align === "start" ? "left" : align === "end" ? "right" : "center"}`,
  };
  const panelClassName = cn("glass-strong z-50 min-w-40 rounded-xl p-1.5", className);

  return (
    <div ref={containerRef} className="relative inline-block">
      <span onClick={() => setOpen(!open)}>{trigger}</span>
      {settings.reduceMotion ? (
        // Genuinely framer-motion-free, not just "animated instantly" —
        // MotionConfig's reducedMotion="always" (see MotionConfigProvider)
        // makes motion.div *resolve* its values instantly, but it's still a
        // framer-motion component underneath: mount/unmount still goes
        // through AnimatePresence's exit-animation bookkeeping, gesture/
        // event listener setup, and JS-driven style application. That
        // per-element overhead is real on a weak CPU even when nothing is
        // visibly animating. A plain conditional <div> below has none of
        // it — for someone who opted into (or was auto-detected into)
        // reduced motion specifically because their device is struggling,
        // that's the difference that actually matters, not the easing.
        open && (
          <div ref={panelRef} style={panelStyle} className={panelClassName}>
            {children}
          </div>
        )
      ) : (
        <AnimatePresence>
          {open && (
            <motion.div
              ref={panelRef}
              initial="hidden"
              animate="visible"
              exit="exit"
              variants={scaleIn}
              style={panelStyle}
              className={panelClassName}
            >
              {children}
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
})
