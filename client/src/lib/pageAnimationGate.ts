import { useEffect, useState } from "react";

/**
 * A tiny global "is a page currently playing its entrance animation?" gate.
 *
 * Why it exists: on low-end phones the dashboard / buy-coins fade-in stutters
 * because, in the very same frames the page is fading in, the browser is also
 * mounting and rasterizing a pile of decorative SVG (the R Coin icons, the
 * 140px watermark with its gradients + filter). Anything decorative can wait
 * ~250ms without anyone noticing, so it waits on this gate instead and mounts
 * in ONE batch right after the animation finishes, during an idle slice.
 *
 * Page (components/ui/Page.tsx) opens the gate while it animates and closes
 * it on completion. A safety timer closes it regardless, so a missed
 * animation callback (reduced motion, background tab, a discarded Suspense
 * render) can never leave decorations hidden forever.
 */

const SAFETY_MS = 700;

let busy = false;
let safetyTimer: ReturnType<typeof setTimeout> | undefined;
const waiters = new Set<() => void>();
let flushQueued = false;

type IdleWindow = Window & {
  requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
};

function flush() {
  flushQueued = false;
  const fns = [...waiters];
  waiters.clear();
  // React 18 batches these state updates into a single commit.
  for (const fn of fns) fn();
}

function queueFlush() {
  if (flushQueued) return;
  flushQueued = true;
  const run = () => requestAnimationFrame(() => flush());
  const w = window as IdleWindow;
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 250 });
  else setTimeout(run, 0);
}

/** Called by Page as it starts animating in. Safe to call during render. */
export function beginPageAnimation() {
  busy = true;
  if (safetyTimer) clearTimeout(safetyTimer);
  safetyTimer = setTimeout(endPageAnimation, SAFETY_MS);
}

/** Called by Page when its entrance animation completes. */
export function endPageAnimation() {
  if (safetyTimer) clearTimeout(safetyTimer);
  safetyTimer = undefined;
  busy = false;
  queueFlush();
}

/**
 * `true` once it's fine to mount expensive decorative content. Immediately
 * `true` when no page is animating (e.g. a modal opened later), otherwise
 * flips to `true` right after the page's entrance animation ends.
 * Pass `enabled = false` to opt out and get `true` straight away.
 */
export function useAfterPageAnimation(enabled = true): boolean {
  const [ready, setReady] = useState(() => !enabled || !busy);

  useEffect(() => {
    if (ready) return;
    if (!busy) {
      setReady(true);
      return;
    }
    const fn = () => setReady(true);
    waiters.add(fn);
    return () => {
      waiters.delete(fn);
    };
  }, [ready]);

  return ready;
}
