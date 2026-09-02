import { useState } from "react";
import { motion } from "framer-motion";
import { Download } from "lucide-react";
import { pressable } from "@/lib/motion.js";
import { Button } from "./ui/index.js";
import { useInstallPrompt } from "../hooks/useInstallPrompt.js";

/**
 * A single "Install app" control, install-only now (there used to also be
 * an "Open app" variant for jumping back to an already-installed PWA from
 * a plain browser tab, removed along with the isInstalledElsewhere/
 * openInstalledApp bits in useInstallPrompt, see that file):
 *  - Already installed (running standalone right now) → renders nothing,
 *    a caller that wants to say so explicitly does that itself (see
 *    Settings.tsx's own "✓ Installed" message).
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
}: {
  /** The small pill used in the navbar, styled to match the other
   *  `.elevated` rounded-full icons/pills next to it (theme toggle,
   *  notifications bell, account menu). Off (the default) renders a full
   *  themed Button instead, e.g. for the Settings page. */
  compact?: boolean;
}) {
  const { canPromptInstall, isInstalled, isIos, promptInstall } =
    useInstallPrompt();
  const [showIosSteps, setShowIosSteps] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  if (isInstalled) return null;
  if (!canPromptInstall && !isIos) return null;

  async function handleClick() {
    if (canPromptInstall) {
      const outcome = await promptInstall();
      if (outcome === "dismissed") setStatus("Can't install as an app");
      return;
    }
    setShowIosSteps((v) => !v);
  }

  return (
    <div className={compact ? "" : "space-y-2"}>
      {compact ? (
        <motion.button
          onClick={handleClick}
          aria-label="Install app"
          className="elevated flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold text-base-content transition-colors hover:bg-base-content/5"
          {...pressable}
        >
          <Download className="h-3.5 w-3.5" />{" "}
          <span className="sm:flex hidden">Install</span>
        </motion.button>
      ) : (
        <Button onClick={handleClick} variant="gradient">
          <Download className="h-4 w-4" /> Install Chess R
        </Button>
      )}
      {status && !compact && (
        <p className="text-xs text-base-content/50">{status}</p>
      )}
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
              Tap <span className="text-base-content">Add</span>. Chess R will
              open full-screen, just like a normal app.
            </li>
          </ol>
        </div>
      )}
    </div>
  );
}
