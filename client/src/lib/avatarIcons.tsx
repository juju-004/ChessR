import type { ReactNode } from "react";

/** Avatar icons: original symbols (swirl, drop, peak, flame) drawn on a
 *  24x24 grid. They use `currentColor` for the main shape and a translucent
 *  black for shading, so they sit on any gradient the same way initials do. */
export interface AvatarIconPreset {
  id: string;
  label: string;
  glyph: ReactNode;
}

export const AVATAR_ICONS: AvatarIconPreset[] = [
  {
    id: "swirl",
    label: "Swirl",
    glyph: (
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 9h10.5a3 3 0 1 0-3-3" />
        <path d="M3 13.5h15a3 3 0 1 1-3 3" />
        <path d="M3 18h6.5" />
      </g>
    ),
  },
  {
    id: "drop",
    label: "Drop",
    glyph: (
      <>
        <path fill="currentColor" d="M12 2.5c3.6 4.3 6.2 7.5 6.2 11a6.2 6.2 0 0 1-12.4 0c0-3.5 2.6-6.7 6.2-11z" />
        <path
          fill="none"
          stroke="#000"
          strokeOpacity=".28"
          strokeWidth="1.8"
          strokeLinecap="round"
          d="M8.2 14.2c1.2-1.2 2.4-1.2 3.8 0s2.6 1.2 3.8 0"
        />
      </>
    ),
  },
  {
    id: "peak",
    label: "Peak",
    glyph: (
      <>
        <path fill="currentColor" d="M2.5 19.5 9 7l3.2 6 2.3-3.6 7 10.1z" />
        <path fill="#000" fillOpacity=".22" d="m9 7 3.2 6-3.7 6.5H2.5z" />
      </>
    ),
  },
  {
    id: "flame",
    label: "Flame",
    glyph: (
      <>
        <path
          fill="currentColor"
          d="M12.5 2c.6 3 4.7 5.3 4.7 10.3a5.2 5.2 0 0 1-10.4 0c0-2.1 1-3.5 2.1-4.6.1 1.6.7 2.6 1.6 3 .1-3 .3-6 2-8.7z"
        />
        <path
          fill="#000"
          fillOpacity=".25"
          d="M12 20.4c-2.1 0-3.2-1.2-3.2-2.7 0-1.5 1.5-2.5 3.2-4.6 1.7 2.1 3.2 3.1 3.2 4.6 0 1.5-1.1 2.7-3.2 2.7z"
        />
      </>
    ),
  },
];

/** Ids saved before the rename keep working: they map to the same drawing. */
const LEGACY_ICON_IDS: Record<string, string> = {
  air: "swirl",
  water: "drop",
  earth: "peak",
  fire: "flame",
};

/** Maps an old saved id to its current one (current ids pass through). */
export function normalizeAvatarIconId(id?: string | null): string | null {
  if (!id) return null;
  return LEGACY_ICON_IDS[id] ?? id;
}

export function findAvatarIcon(id?: string | null): AvatarIconPreset | undefined {
  const current = normalizeAvatarIconId(id);
  return current ? AVATAR_ICONS.find((i) => i.id === current) : undefined;
}

/** Draws an icon at the size of its parent (the avatar circle). */
export function AvatarIconGlyph({ id, className }: { id: string; className?: string }) {
  const icon = findAvatarIcon(id);
  if (!icon) return null;
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
      <g transform="translate(3.6 3.6) scale(.7)">{icon.glyph}</g>
    </svg>
  );
}
