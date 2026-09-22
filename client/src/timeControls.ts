export interface TimeControlOption {
  label: string;
  baseMinutes: number | null;
  incrementSeconds: number;
}

export const TIME_CONTROLS: TimeControlOption[] = [
  { label: "Bullet · 1+0", baseMinutes: 1, incrementSeconds: 0 },
  { label: "Blitz · 3+0", baseMinutes: 3, incrementSeconds: 0 },
  { label: "Blitz · 3+2", baseMinutes: 3, incrementSeconds: 2 },
  { label: "Blitz · 5+0", baseMinutes: 5, incrementSeconds: 0 },
  { label: "Rapid · 10+0", baseMinutes: 10, incrementSeconds: 0 },
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
