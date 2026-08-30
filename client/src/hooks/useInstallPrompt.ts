import { useEffect, useState } from 'react';

// Not in lib.dom.d.ts yet, this is the real shape Chrome/Edge/etc. fire.
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

function isRunningStandalone(): boolean {
  const displayModeStandalone = window.matchMedia?.('(display-mode: standalone)').matches;
  // iOS Safari doesn't support display-mode media queries for this, it has
  // its own `navigator.standalone` flag instead.
  const iosStandalone = (window.navigator as any).standalone === true;
  return !!displayModeStandalone || iosStandalone;
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

/**
 * Wraps the browser's `beforeinstallprompt` flow. On Chrome/Edge/Android
 * this gives a real one-tap install button. iOS Safari never fires that
 * event at all, there, `canPromptInstall` stays false but `isIos` lets the
 * UI show manual "Add to Home Screen" instructions instead of hiding the
 * option entirely.
 *
 * `isInstalled` means "currently running in the standalone installed
 * window", right now, in this tab. There used to also be an
 * `isInstalledElsewhere`/`openInstalledApp` pair here for "the PWA is
 * installed somewhere, but this tab is a normal browser tab, offer to jump
 * to the installed app instead" — removed, there's no reliable, universal
 * API a web page can call to actually focus/launch an already-installed
 * PWA, so that reduced to "reload the page" on most browsers anyway, and
 * it depended on a persisted-across-sessions flag that could go stale
 * (installed on one device, then this is a different device or the app
 * was later uninstalled). This hook now only answers the two questions
 * that have a genuinely reliable answer: is it installed right now, and
 * can/should we offer to install it.
 */
export function useInstallPrompt() {
  const [deferredEvent, setDeferredEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(isRunningStandalone);

  useEffect(() => {
    function onBeforeInstallPrompt(e: Event) {
      e.preventDefault();
      setDeferredEvent(e as BeforeInstallPromptEvent);
    }
    function onAppInstalled() {
      setIsInstalled(true);
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
    if (choice.outcome === 'accepted') setIsInstalled(true);
    return choice.outcome;
  }

  return {
    canPromptInstall: !!deferredEvent,
    isInstalled,
    isIos: isIos(),
    promptInstall,
  };
}
