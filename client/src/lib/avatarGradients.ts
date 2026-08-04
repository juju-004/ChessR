import type { CSSProperties } from "react";

export interface AvatarGradientPreset {
  id: string;
  label: string;
  /** CSS color stops — can be a hex value or a `var(--...)` reference. */
  from: string;
  to: string;
}

// "brand" intentionally mirrors .gradient-brand in index.css (var(--primary)
// -> var(--secondary), 135deg) rather than hardcoding the current blue/violet
// hex values, so it stays in sync if the theme's brand colors ever change.
// It's also the default for anyone who hasn't picked a custom gradient.
export const AVATAR_GRADIENTS: AvatarGradientPreset[] = [
  { id: "brand", label: "Brand", from: "var(--primary)", to: "var(--secondary)" },
  { id: "sunset", label: "Sunset", from: "#f97316", to: "#ec4899" },
  { id: "ocean", label: "Ocean", from: "#0ea5e9", to: "#14b8a6" },
  { id: "forest", label: "Forest", from: "#22c55e", to: "#0d9488" },
  { id: "berry", label: "Berry", from: "#d946ef", to: "#6366f1" },
  { id: "fire", label: "Fire", from: "#ef4444", to: "#f59e0b" },
  { id: "midnight", label: "Midnight", from: "#1e293b", to: "#7c3aed" },
  { id: "gold", label: "Gold", from: "#eab308", to: "#f97316" },
  { id: "rose", label: "Rose", from: "#fb7185", to: "#f43f5e" },
  { id: "ice", label: "Ice", from: "#38bdf8", to: "#a5f3fc" },
];

export function findAvatarGradient(id?: string | null): AvatarGradientPreset {
  return AVATAR_GRADIENTS.find((g) => g.id === id) ?? AVATAR_GRADIENTS[0];
}

export function avatarGradientStyle(id?: string | null): CSSProperties | undefined {
  // "brand" (and anything unrecognized) just falls back to the existing
  // .gradient-brand class — no inline style needed, and it means old rows
  // without an avatarGradient at all render exactly as they did before.
  if (!id || id === "brand") return undefined;
  const preset = findAvatarGradient(id);
  return {
    backgroundImage: `linear-gradient(135deg, ${preset.from} 0%, ${preset.to} 100%)`,
  };
}
