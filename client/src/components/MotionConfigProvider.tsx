import { type ReactNode } from "react";
import { MotionConfig } from "framer-motion";
import { useSettings } from "../contexts/SettingsContext.js";

/**
 * Single app-wide switch for animation complexity, driven by
 * Settings.reduceMotion (auto-defaulted from device heuristics on first
 * load — see deviceCapability.ts — and user-overridable in Settings).
 *
 * This deliberately does NOT touch Popover/Dropdown/Modal/Tooltip/etc
 * individually. Every one of them already animates only opacity/x/y/scale
 * (see lib/motion.ts) via framer-motion, and framer-motion's own
 * <MotionConfig reducedMotion="always"> is built exactly for this: when
 * active, it keeps opacity transitions but resolves every x/y/scale/rotate
 * change instantly instead of tweening/springing it — the "sharper
 * animations" version of every existing motion component for free, with no
 * per-component changes and no risk of the two drifting out of sync later.
 *
 * "never" (not "user") when off — this is a manual/auto-detected app
 * setting, not a re-read of the OS-level prefers-reduced-motion media query,
 * so it shouldn't silently defer to that separately.
 */
export function MotionConfigProvider({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  return (
    <MotionConfig reducedMotion={settings.reduceMotion ? "always" : "never"}>
      {children}
    </MotionConfig>
  );
}
