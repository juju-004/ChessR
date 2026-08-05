import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { isLowEndDevice } from '../lib/deviceCapability.js';

export type BoardTheme = 'brown' | 'green' | 'blue' | 'gray' | 'purple';
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
  confirmResign: boolean;
  /** Swaps modal/popover/dropdown entrances from springy scale+opacity to
   *  opacity-only near-instant transitions (see MotionConfigProvider). The
   *  *static* default here is deliberately `false` — the real, device-aware
   *  default is computed once in loadSettings() below and only falls back
   *  to this constant in the (very unlikely) case that fails too. */
  reduceMotion: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  boardTheme: 'brown',
  pieceTheme: 'classic',
  pieceAnimation: true,
  autoQueen: false,
  zenMode: false,
  showCoordinates: true,
  showLegalMoves: true,
  soundEnabled: true,
  confirmResign: true,
  reduceMotion: false,
};

const STORAGE_KEY = 'chess-app:settings';

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    // First-ever load on this browser: no stored prefs to merge over, so
    // this is the one moment it's correct to pick reduceMotion's default
    // from the device itself rather than from the static DEFAULT_SETTINGS
    // constant. Wrapped in its own try — a throwing heuristic should never
    // take the whole settings load down with it.
    if (!raw) {
      let autoReduceMotion = DEFAULT_SETTINGS.reduceMotion;
      try {
        autoReduceMotion = isLowEndDevice();
      } catch {
        // fall through to the static default
      }
      return { ...DEFAULT_SETTINGS, reduceMotion: autoReduceMotion };
    }
    // Merge over defaults rather than trusting the stored blob outright, so
    // adding a new setting later doesn't leave existing users with `undefined`
    // for it until they happen to touch that particular control.
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
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

  function updateSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((prev) => ({ ...prev, [key]: value }));
  }

  function resetSettings() {
    setSettings(DEFAULT_SETTINGS);
  }

  // settings gets a brand-new object on every update anyway, so the
  // useMemo here isn't about that — it's about *not* creating yet another
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
