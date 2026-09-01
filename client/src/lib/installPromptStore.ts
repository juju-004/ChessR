// Plain (non-React) store for the PWA install prompt, same pattern as
// api/walletStore.ts / lib/balanceVisibilityStore.ts.
//
// `beforeinstallprompt` is a one-shot browser event: it fires once per
// page load, to whichever listeners happen to be attached to `window` at
// that moment, and never again. useInstallPrompt used to call
// window.addEventListener from inside its own per-component useEffect,
// which meant only whichever InstallAppButton instance happened to
// already be mounted when the event fired ever saw it. The navbar's
// compact button is mounted from the very first page load (Navbar isn't
// behind a route, so it's there before any route-level page is), so it
// reliably caught the event. The Settings page's full button only mounts
// once someone actually navigates to /settings, almost always well after
// that one-time event already fired and is gone. That's why the Settings
// button "didn't show": not a compact-vs-full difference, just whichever
// component happened to exist at the right moment.
//
// Fix: attach the listener exactly once, here, at module scope (this
// module is reachable from Navbar's static, non-lazy import chain, so it
// loads immediately on app start rather than only when a particular route
// mounts) and cache whatever it captures. Every InstallAppButton, no
// matter when it mounts, reads the same shared value instead of missing
// the event outright.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

function isRunningStandalone(): boolean {
  const displayModeStandalone = window.matchMedia?.(
    "(display-mode: standalone)",
  ).matches;
  // iOS Safari doesn't support display-mode media queries for this, it has
  // its own `navigator.standalone` flag instead.
  const iosStandalone = (window.navigator as any).standalone === true;
  return !!displayModeStandalone || iosStandalone;
}

let deferredEvent: BeforeInstallPromptEvent | null = null;
let installed = isRunningStandalone();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((l) => l());
}

window.addEventListener("beforeinstallprompt", (e: Event) => {
  e.preventDefault();
  deferredEvent = e as BeforeInstallPromptEvent;
  notify();
});

window.addEventListener("appinstalled", () => {
  installed = true;
  deferredEvent = null;
  notify();
});

export function getCachedDeferredEvent(): BeforeInstallPromptEvent | null {
  return deferredEvent;
}

export function getCachedIsInstalled(): boolean {
  return installed;
}

export function subscribeInstallPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function promptInstall(): Promise<
  "accepted" | "dismissed" | "unavailable"
> {
  if (!deferredEvent) return "unavailable";
  await deferredEvent.prompt();
  const choice = await deferredEvent.userChoice;
  deferredEvent = null;
  if (choice.outcome === "accepted") installed = true;
  notify();
  return choice.outcome;
}
