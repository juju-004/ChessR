import { useState } from 'react';
import { useInstallPrompt } from '../hooks/useInstallPrompt.js';

/**
 * A single "Install app" control that adapts to what the browser actually
 * supports:
 *  - Already installed / running standalone → renders nothing.
 *  - Chrome/Edge/Android (real `beforeinstallprompt` support) → a button
 *    that triggers the native install prompt directly.
 *  - iOS Safari (no such event exists there) → a button that reveals the
 *    manual "Share → Add to Home Screen" steps instead of silently doing
 *    nothing.
 *  - Anything else with neither signal available → renders nothing rather
 *    than showing a button that can't do anything.
 */
export function InstallAppButton({ compact = false }: { compact?: boolean }) {
  const { canPromptInstall, isInstalled, isIos, promptInstall } = useInstallPrompt();
  const [showIosSteps, setShowIosSteps] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  if (isInstalled) return null;
  if (!canPromptInstall && !isIos) return null;

  async function handleClick() {
    if (canPromptInstall) {
      const outcome = await promptInstall();
      if (outcome === 'dismissed') setStatus('Maybe next time — you can install anytime from here.');
      return;
    }
    setShowIosSteps((v) => !v);
  }

  const label = compact ? 'Install app' : 'Install Chess App';

  return (
    <div className={compact ? '' : 'space-y-2'}>
      <button
        onClick={handleClick}
        className={
          compact
            ? 'rounded-md bg-neutral-800 px-3 py-1.5 text-sm font-semibold text-neutral-100 hover:bg-neutral-700'
            : 'rounded-md bg-amber-700 px-4 py-2 font-semibold text-neutral-950 hover:bg-amber-600'
        }
      >
        📲 {label}
      </button>
      {status && <p className="text-xs text-neutral-500">{status}</p>}
      {showIosSteps && (
        <div className="rounded-md border border-neutral-800 bg-neutral-950 p-3 text-sm text-neutral-300">
          <p className="mb-1 font-medium text-neutral-200">On iPhone/iPad:</p>
          <ol className="list-inside list-decimal space-y-1 text-neutral-400">
            <li>
              Tap the <span className="text-neutral-200">Share</span> icon in Safari's toolbar.
            </li>
            <li>
              Scroll down and tap <span className="text-neutral-200">Add to Home Screen</span>.
            </li>
            <li>
              Tap <span className="text-neutral-200">Add</span> — Chess App will open full-screen, just like a
              normal app.
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
