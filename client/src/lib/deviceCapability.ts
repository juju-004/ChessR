/**
 * Heuristic, best-effort "is this a low-end device" check, used to pick a
 * sane *default* for Settings.reduceMotion the first time the app loads on
 * a given browser (see SettingsContext). None of these signals are reliable
 * alone — Safari/iOS exposes neither deviceMemory nor connection at all,
 * hardwareConcurrency reports inflated core counts on some Android
 * WebViews — so this ORs a few cheap, synchronous, zero-cost checks rather
 * than trying to be precise or running an actual frame-timing probe.
 *
 * False positives (treating a decent phone as low-end) just mean a slightly
 * snappier default, which the user can flip back off in Settings — a fine
 * trade-off for something that should never itself cost a layout/paint to
 * compute.
 */
export function isLowEndDevice(): boolean {
  if (typeof navigator === "undefined") return false;

  // Most reliable single signal where it's available: physical CPU cores.
  // 4 or fewer is a reasonable line for "budget Android" in 2026.
  const cores = navigator.hardwareConcurrency ?? 8;
  if (cores <= 4) return true;

  // Chrome/Android + some desktop Chrome only — not in lib.dom yet.
  const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
  if (memory !== undefined && memory <= 4) return true;

  // Data-saver mode / a detected slow network is as much "please go easy on
  // me" as an explicit signal of weak hardware — same fix either way, and
  // it's the one signal iOS Safari has never exposed at all so this stays
  // an OR of independent best-effort checks rather than a single source of
  // truth.
  const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } })
    .connection;
  if (conn?.saveData) return true;
  if (conn?.effectiveType && ["slow-2g", "2g", "3g"].includes(conn.effectiveType)) return true;

  return false;
}
