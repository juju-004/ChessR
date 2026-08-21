export interface TimeControlOption {
  label: string;
  baseMinutes: number | null;
  incrementSeconds: number;
}

// Single source of truth for every time-control select in the app (game
// creation, tournament creation, cage match leg editor, etc). Previously
// three near-identical lists had drifted out of sync (different bullet/
// blitz presets, tournament creation missing "Unlimited", the cage match
// editor missing "Hyper Bullet"/"Bullet · 2+1"/the two Rapid variants) —
// this is now the one list every page imports, so a preset added or
// changed here shows up everywhere consistently.
export const TIME_CONTROLS: TimeControlOption[] = [
  { label: "Hyper Bullet · ½+0", baseMinutes: 0.5, incrementSeconds: 0 },
  { label: "Bullet · 1+0", baseMinutes: 1, incrementSeconds: 0 },
  { label: "Bullet · 2+1", baseMinutes: 2, incrementSeconds: 1 },
  { label: "Blitz · 3+0", baseMinutes: 3, incrementSeconds: 0 },
  { label: "Blitz · 3+2", baseMinutes: 3, incrementSeconds: 2 },
  { label: "Blitz · 5+0", baseMinutes: 5, incrementSeconds: 0 },
  { label: "Rapid · 8+0", baseMinutes: 8, incrementSeconds: 0 },
  { label: "Rapid · 10+0", baseMinutes: 10, incrementSeconds: 0 },
  { label: "Rapid · 10+5", baseMinutes: 10, incrementSeconds: 5 },
  { label: "Rapid · 15+10", baseMinutes: 15, incrementSeconds: 10 },
  { label: "Classical · 30+0", baseMinutes: 30, incrementSeconds: 0 },
  { label: "Unlimited", baseMinutes: null, incrementSeconds: 0 },
];

export function formatTimeControl(tc: {
  baseSeconds: number | null;
  incrementSeconds: number;
}): string {
  if (tc.baseSeconds === null) return "Unlimited";
  return `${Math.round(tc.baseSeconds / 60)}+${tc.incrementSeconds}`;
}

// Same bullet/blitz/rapid/classical buckets used for category labels
// elsewhere (rating ladder, cage match badges) — reused here so a game's
// piece-slide speed matches the pace of the time control it's actually
// played at, rather than one fixed duration for every game. Faster time
// controls get snappier, more immediate-feeling animation; slower ones get
// a more deliberate, easier-to-follow one.
export function animationDurationForTimeControl(
  baseSeconds: number | null,
): number {
  if (baseSeconds === null) return 260; // unlimited/correspondence — treat as classical
  const baseMinutes = baseSeconds / 60;
  if (baseMinutes < 3) return 90; // bullet — quick snaps
  if (baseMinutes < 10) return 140; // blitz — faster
  if (baseMinutes < 30) return 200; // rapid — the old fixed default
  return 260; // classical — normal, slower
}
