import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { BOARD_THEMES, type BoardTheme } from '../lib/boardThemes';
import { rasterizePieceTheme } from '../lib/pieceRaster';

export type { BoardTheme };
export type PieceTheme = 'classic' | 'mono' | 'contrast' | 'wood';

export interface Settings {
  boardTheme: BoardTheme;
  pieceTheme: PieceTheme;
  pieceAnimation: boolean;
  autoQueen: boolean;
  zenMode: boolean;
  showCoordinates: boolean;
  showLegalMoves: boolean;
  soundEnabled: boolean;
  vibration: boolean;
  confirmResign: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  // Chessr's own default, per David — not the lichess "brown" default an
  // earlier request briefly made this. See index.css's board-theme-blue
  // rule for the actual square colors.
  boardTheme: 'blue',
  pieceTheme: 'classic',
  pieceAnimation: true,
  autoQueen: false,
  zenMode: false,
  showCoordinates: true,
  showLegalMoves: true,
  soundEnabled: true,
  vibration: true,
  confirmResign: true,
};

const STORAGE_KEY = 'chess-app:settings';

/**
 * Piece art for everything except "classic" (bundled in index.css) lives in
 * src/styles/pieces-*.css and is only fetched once a player actually selects
 * that set. Vite turns each dynamic import into its own cached CSS chunk, so
 * ~120 KB of base64 SVG is no longer render-blocking for everyone. Rules are
 * scoped by .piece-theme-<name>, so a loaded-but-unselected set has no effect.
 */
const PIECE_THEME_CSS: Partial<Record<PieceTheme, () => Promise<unknown>>> = {
  mono: () => import('../styles/pieces-mono.css'),
  contrast: () => import('../styles/pieces-contrast.css'),
  wood: () => import('../styles/pieces-wood.css'),
};
const pieceThemeLoads = new Map<PieceTheme, Promise<unknown>>();

function ensurePieceThemeCss(theme: PieceTheme): void {
  const load = PIECE_THEME_CSS[theme];
  if (!load || pieceThemeLoads.has(theme)) return;
  const p = load()
    // Once the set's SVG rules are in, swap them for small bitmaps (see
    // lib/pieceRaster.ts). That, not the SVG itself, is what keeps sliding
    // pieces smooth on the heavier sets.
    .then(() => rasterizePieceTheme(theme))
    .catch(() => {
    // Let a later selection retry (e.g. a flaky connection) instead of
    // caching the failure. Pieces fall back to classic in the meantime.
    pieceThemeLoads.delete(theme);
  });
  pieceThemeLoads.set(theme, p);
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    // Merge over defaults rather than trusting the stored blob outright, so
    // adding a new setting later doesn't leave existing users with `undefined`
    // for it until they happen to touch that particular control.
    const merged: Settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    // A saved board theme this build doesn't know (renamed or removed) would
    // render with no square colours at all; fall back to the default.
    if (!BOARD_THEMES.some((t) => t.value === merged.boardTheme)) {
      merged.boardTheme = DEFAULT_SETTINGS.boardTheme;
    }
    // Start fetching a saved non-classic set right away (before first
    // render) so returning players don't see classic pieces flash first.
    ensurePieceThemeCss(merged.pieceTheme);
    return merged;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface SettingsContextValue {
  settings: Settings;
  updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  resetSettings: () => void;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    ensurePieceThemeCss(settings.pieceTheme);
  }, [settings.pieceTheme]);

  function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  function resetSettings() {
    setSettings(DEFAULT_SETTINGS);
  }

  // settings gets a brand-new object on every update anyway, so the
  // useMemo here isn't about that, it's about *not* creating yet another
  // new value object (and re-rendering every useSettings() consumer)
  // whenever SettingsProvider re-renders for a reason that has nothing to
  // do with settings at all.
  const value = useMemo<SettingsContextValue>(
    () => ({ settings, updateSetting, resetSettings }),
    [settings],
  );

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
}
