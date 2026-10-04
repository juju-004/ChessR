/**
 * Vibration feedback via the Vibration API (navigator.vibrate).
 *
 * Supported on Android browsers (Chrome, Edge, Firefox, Samsung Internet)
 * and installed PWAs. iOS Safari doesn't implement it at all, and desktop
 * browsers ignore it, so every call here is a silent no-op where it's
 * unavailable. Browsers also only allow it after the user has interacted
 * with the page, which is always true by the time a game is underway.
 *
 * Same module-level switch pattern as sounds.ts: Game.tsx mirrors the
 * Settings page's "Vibration" toggle in via setVibrationEnabled().
 */
let vibrationEnabled = true;

export function setVibrationEnabled(enabled: boolean) {
  vibrationEnabled = enabled;
  if (!enabled) cancelVibration();
}

/** True when this browser can vibrate at all (used to hide the Settings
 *  toggle on devices where it would do nothing). */
export function isVibrationSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

function cancelVibration() {
  if (!isVibrationSupported()) return;
  try {
    navigator.vibrate(0);
  } catch {
    /* ignore */
  }
}

function vibrate(pattern: number | number[]) {
  if (!vibrationEnabled || !isVibrationSupported()) return;
  // Browsers ignore vibration from a hidden tab anyway; skip the call.
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* some browsers throw when blocked by policy; haptics are optional */
  }
}

export const haptics = {
  /** Light tap for a capture. */
  capture: () => vibrate(15),
  /** Double pulse when the local player's king is put in check. */
  check: () => vibrate([40, 40, 40]),
  /** Stronger double pulse for the low-time warning. */
  lowTime: () => vibrate([90, 60, 90]),
};
