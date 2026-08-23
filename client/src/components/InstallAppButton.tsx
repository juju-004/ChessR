import { useState } from "react";
import { useInstallPrompt } from "../hooks/useInstallPrompt.js";

/**
 * A single "Install app"/"Open app" control that adapts to what the browser
 * actually supports and whether the PWA is already installed:
 *  - Currently running standalone (already inside the installed app) →
 *    renders nothing, there's nothing to offer.
 *  - Installed, but this tab is a normal browser tab → "Open app" instead
 *    of disappearing or re-offering an install that's already done, unless
 *    `installOnly` is set (see below).
 *  - Not installed, Chrome/Edge/Android (real `beforeinstallprompt`
 *    support) → a button that triggers the native install prompt directly.
 *  - Not installed, iOS Safari (no such event exists there) → a button
 *    that reveals the manual "Share → Add to Home Screen" steps instead of
 *    silently doing nothing.
 *  - Anything else with none of the above signals → renders nothing rather
 *    than showing a button that can't do anything.
 */
export function InstallAppButton({
  compact = false,
  installOnly = false,
}: {
  compact?: boolean;
  /** Ignores the "already installed elsewhere" state entirely — never
   *  offers to jump to the installed app, only ever the install flow (or
   *  nothing, if there's genuinely no install path available). Used on
   *  the Settings page, which already has its own "✓ Installed" message
   *  for the standalone case and doesn't need a second, separate "open in
   *  app" control alongside it. */
  installOnly?: boolean;
}) {
  const {
    canPromptInstall,
    isInstalled,
    isInstalledElsewhere: isInstalledElsewhereRaw,
    isIos,
    promptInstall,
    openInstalledApp,
  } = useInstallPrompt();
  const isInstalledElsewhere = installOnly ? false : isInstalledElsewhereRaw;
  const [showIosSteps, setShowIosSteps] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  if (isInstalled) return null;
  if (!isInstalledElsewhere && !canPromptInstall && !isIos) return null;

  async function handleClick() {
    if (isInstalledElsewhere) {
      openInstalledApp();
      return;
    }
    if (canPromptInstall) {
      const outcome = await promptInstall();
      if (outcome === "dismissed")
        setStatus("Maybe next time — you can install anytime from here.");
      return;
    }
    setShowIosSteps((v) => !v);
  }

  const label = isInstalledElsewhere
    ? "Open app"
    : compact
      ? "Install app"
      : "Install Chess R";
  const icon = isInstalledElsewhere ? "↗️" : "📲";

  return (
    <div className={compact ? "sm:flex hidden" : "space-y-2"}>
      <button
        onClick={handleClick}
        className={
          compact
            ? "elevated h-9 rounded-full px-3.5 text-sm font-semibold text-base-content transition-colors hover:bg-base-content/5"
            : "rounded-md bg-amber-700 px-4 py-2 font-semibold text-neutral-950 hover:bg-amber-600"
        }
      >
        {icon} {label}
      </button>
      {status && <p className="text-xs text-base-content/50">{status}</p>}
      {!isInstalledElsewhere && showIosSteps && (
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
              Tap <span className="text-base-content">Add</span> — Chess R
              will open full-screen, just like a normal app.
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
