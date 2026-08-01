import { useState } from "react";
import { useInstallPrompt } from "../hooks/useInstallPrompt.js";

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
  const { canPromptInstall, isInstalled, isIos, promptInstall } =
    useInstallPrompt();
  const [showIosSteps, setShowIosSteps] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  if (isInstalled) return null;
  if (!canPromptInstall && !isIos) return null;

  async function handleClick() {
    if (canPromptInstall) {
      const outcome = await promptInstall();
      if (outcome === "dismissed")
        setStatus("Maybe next time — you can install anytime from here.");
      return;
    }
    setShowIosSteps((v) => !v);
  }

  const label = compact ? "Install app" : "Install Chess App";

  return (
    <div className={compact ? "sm:flex hidden" : "space-y-2"}>
      <button
        onClick={handleClick}
        className={
          compact
            ? "glass h-9 rounded-full px-3.5 text-sm font-semibold text-base-content transition-colors hover:bg-base-content/5"
            : "rounded-md bg-amber-700 px-4 py-2 font-semibold text-neutral-950 hover:bg-amber-600"
        }
      >
        📲 {label}
      </button>
      {status && <p className="text-xs text-base-content/50">{status}</p>}
      {showIosSteps && (
        <div className="rounded-md border border-base-300 bg-base-100 p-3 text-sm text-base-content/80">
          <p className="mb-1 font-medium text-base-content">On iPhone/iPad:</p>
          <ol className="list-inside list-decimal space-y-1 text-base-content/60">
            <li>
              Tap the <span className="text-base-content">Share</span> icon in
              Safari's toolbar.
            </li>
            <li>
              Scroll down and tap{" "}
              <span className="text-base-content">Add to Home Screen</span>.
            </li>
            <li>
              Tap <span className="text-base-content">Add</span> — Chess App
              will open full-screen, just like a normal app.
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
