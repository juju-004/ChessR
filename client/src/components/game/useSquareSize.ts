import { useEffect, useRef, useState, type RefObject } from "react";

/**
 * Measures a wrapper element and returns the largest square (in px) that
 * fits inside it — i.e. `Math.min(width, height)`.
 *
 * This replaces an earlier CSS-only attempt at the same problem (`width:
 * min(100cqw, 100cqh)` inside a `container-type: size` wrapper). That
 * relied on CSS container query *size* queries specifically — not just
 * `@container` support, which is now widespread, but the size-axis
 * variant, which needs the container to be given `container-type: size`
 * via the arbitrary-property syntax `[container-type:size]` rather than
 * Tailwind's built-in `@container` utility (that one only sets
 * `inline-size`). That combination turned out to not reliably size the
 * board on every mobile browser/version actually in use, and a silently
 * empty 0×0 board is a bad failure mode for something this central to the
 * page. ResizeObserver has been universally supported in mobile browsers
 * for years and doesn't depend on any of that — it just measures the box
 * and this returns a plain number to size the board with directly, no CSS
 * unit gymnastics involved.
 *
 * Below `fullWidthBelow` (a viewport-width breakpoint, not the wrapper's
 * own width) the board ignores the wrapper's height entirely and sizes to
 * its full width instead of `min(width, height)`. On a short viewport —
 * an iPad in split view, a phone in landscape, any phone with the
 * keyboard/browser chrome eating vertical space — the wrapper's height
 * can be far smaller than its width, and `min()` was shrinking the board
 * down to whatever sliver of height was left, which reads as broken on a
 * board that should just be "as big as the screen is wide". Past that
 * breakpoint (tablet/desktop, where both dimensions are normally
 * generous and a board taller than the viewport would be worse than one
 * capped to it) the old min(width, height) behavior is unchanged.
 */
export function useSquareSize(
  ref: RefObject<HTMLElement | null>,
  fullWidthBelow = 768,
): number {
  const [size, setSize] = useState(0);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const measure = () => {
      // rAF-batched: ResizeObserver can fire multiple times per paint
      // (e.g. once for this element, once for an ancestor also being
      // observed elsewhere) — coalescing to one setState per frame avoids
      // doing that work twice for the same visual frame.
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(() => {
        const rect = el.getBoundingClientRect();
        const ignoreHeight = window.innerWidth < fullWidthBelow;
        const next = Math.floor(
          ignoreHeight ? rect.width : Math.min(rect.width, rect.height),
        );
        // Ignore a transient zero/near-zero read (e.g. a reflow
        // triggered elsewhere on the page — a modal opening, a panel
        // animating — that briefly collapses this element's box)
        // rather than tearing the board down to invisible and
        // rebuilding it a frame later. Matches the same guard
        // ChessBoard's own internal measurement uses.
        if (next > 0) setSize(next);
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // The wrapper's own box doesn't necessarily change size on every
    // window resize (e.g. rotating a phone can change which branch of
    // `ignoreHeight` applies without the wrapper's width moving at all),
    // so the ResizeObserver alone isn't enough to catch every case that
    // should flip full-width on/off.
    window.addEventListener("resize", measure);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [ref, fullWidthBelow]);

  return size;
}
