import { useEffect, useState } from 'react';

// Not in lib.dom.d.ts yet — this is the real shape Chrome/Edge/etc. fire.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

// Persisted across tabs/sessions so "installed" survives navigating back to
// the site in an ordinary browser tab after installing — the standalone-mode
// check alone only tells you about *this* window, not whether the PWA has
// been installed at all. Set once on the 'appinstalled' event and never
// cleared client-side (there's no reliable "uninstalled" signal in the
// browser to react to).
const INSTALLED_STORAGE_KEY = 'chessr:pwa-installed';

function isRunningStandalone(): boolean {
  const displayModeStandalone = window.matchMedia?.('(display-mode: standalone)').matches;
  // iOS Safari doesn't support display-mode media queries for this — it has
  // its own `navigator.standalone` flag instead.
  const iosStandalone = (window.navigator as any).standalone === true;
  return !!displayModeStandalone || iosStandalone;
}

function readPersistedInstalled(): boolean {
  try {
    return window.localStorage.getItem(INSTALLED_STORAGE_KEY) === 'true';
  } catch {
    // Private browsing / storage disabled — fall back to session-only
    // detection rather than throwing.
    return false;
  }
}

function persistInstalled() {
  try {
    window.localStorage.setItem(INSTALLED_STORAGE_KEY, 'true');
  } catch {
    /* best-effort only */
  }
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

/**
 * Wraps the browser's `beforeinstallprompt` flow. On Chrome/Edge/Android
 * this gives a real one-tap install button. iOS Safari never fires that
 * event at all — there, `canPromptInstall` stays false but `isIos` lets the
 * UI show manual "Add to Home Screen" instructions instead of hiding the
 * option entirely.
 *
 * `isInstalled` here means "currently running in the standalone installed
 * window" — that's still exposed as-is since some callers care specifically
 * about that. `isInstalledElsewhere` is the new bit: true when the PWA has
 * been installed (per the persisted flag) but *this* tab is a normal
 * browser tab, not the standalone window — that's the "you're viewing this
 * in the browser even though you've already installed it" case, and is
 * what InstallAppButton uses to switch from "Install" to "Open app" instead
 * of just disappearing.
 */
export function useInstallPrompt() {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(isRunningStandalone);
  const [wasEverInstalled, setWasEverInstalled] = useState(
    () => isRunningStandalone() || readPersistedInstalled(),
  );

  useEffect(() => {
    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredEvent(e as BeforeInstallPromptEvent);
    }
    function onAppInstalled() {
      setIsInstalled(true);
      setWasEverInstalled(true);
      persistInstalled();
      setDeferredEvent(null);
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    if (!deferredEvent) return 'unavailable';
    await deferredEvent.prompt();
    const choice = await deferredEvent.userChoice;
    setDeferredEvent(null);
    if (choice.outcome === 'accepted') {
      setIsInstalled(true);
      setWasEverInstalled(true);
      persistInstalled();
    }
    return choice.outcome;
  }

  // Best-effort "bring the installed app to the front" — there's no
  // standard API a web page can call to focus/launch an already-installed
  // PWA from a plain browser tab. Navigating to the app's own scope is the
  // closest cross-browser approximation: on Android, Chrome will often
  // offer to complete the navigation in the installed app via its own
  // "Open in app" system prompt; elsewhere this just reloads the site in
  // the current tab, which is still a reasonable fallback.
  function openInstalledApp() {
    window.location.href = window.location.origin + '/dashboard';
  }

  return {
    canPromptInstall: !!deferredEvent,
    isInstalled,
    isInstalledElsewhere: wasEverInstalled && !isInstalled,
    isIos: isIos(),
    promptInstall,
    openInstalledApp,
  };
}
