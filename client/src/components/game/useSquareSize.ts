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
 */
export function useSquareSize(ref: RefObject<HTMLElement | null>): number {
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
        const next = Math.floor(Math.min(rect.width, rect.height));
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

    return () => {
      observer.disconnect();
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [ref]);

  return size;
}
