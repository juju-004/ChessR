import { useSyncExternalStore } from 'react';
import {
  getCachedDeferredEvent,
  getCachedIsInstalled,
  subscribeInstallPrompt,
  promptInstall as promptInstallShared,
} from '../lib/installPromptStore.js';

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
 * window", right now, in this tab.
 *
 * Reads a shared store (see lib/installPromptStore.ts) rather than
 * keeping its own local state: `beforeinstallprompt` fires once per page
 * load, so every InstallAppButton instance needs to see the same captured
 * event regardless of which one happened to be mounted at that moment.
 */
export function useInstallPrompt() {
  const deferredEvent = useSyncExternalStore(
    subscribeInstallPrompt,
    getCachedDeferredEvent,
    getCachedDeferredEvent,
  );
  const isInstalled = useSyncExternalStore(
    subscribeInstallPrompt,
    getCachedIsInstalled,
    getCachedIsInstalled,
  );

  return {
    canPromptInstall: !!deferredEvent,
    isInstalled,
    isIos: isIos(),
    promptInstall: promptInstallShared,
  };
}
