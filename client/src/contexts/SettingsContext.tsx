import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type BoardTheme = 'brown' | 'green' | 'blue' | 'gray' | 'purple' | 'walnut' | 'coral' | 'ic';
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
};

const STORAGE_KEY = 'chess-app:settings';

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
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
