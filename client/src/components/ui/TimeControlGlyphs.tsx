import type { SVGProps } from "react";

/**
 * Custom icons for the bullet, blitz and rapid time-control categories.
 * Same 24x24 / 2px round-stroke construction as the lucide icons used for
 * classical and unlimited, so they sit together at any size, and they draw
 * in `currentColor`, so they take whatever text color surrounds them.
 */
export interface GlyphProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  size?: number;
}

function Glyph({ size = 24, children, ...rest }: GlyphProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Bullet: a round with speed lines trailing behind it. */
export function BulletGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M9 8h4c3 0 5.5 1.6 7 4-1.5 2.4-4 4-7 4H9z" />
      <path d="M12.5 8v8" />
      <path d="M3 9.5h3M1.5 12h4.5M3 14.5h3" />
    </Glyph>
  );
}

/** Blitz: a lightning bolt with a spark. */
export function BlitzGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M13.5 2 5 13.5h6l-1 8.5 8.5-11.5h-6z" />
      <path d="M19.5 3v3M18 4.5h3" />
    </Glyph>
  );
}

/** Rapid: a stopwatch with speed lines. */
export function RapidGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="12.5" cy="13.5" r="7.5" />
      <path d="M10 2.5h5M12.5 2.5V6" />
      <path d="M12.5 13.5l3-3.5" />
      <path d="M19 6l1.5-1.5" />
      <path d="M1.5 12h2M1.5 15.5h2" />
      <circle cx="12.5" cy="13.5" r="0.9" fill="currentColor" />
    </Glyph>
  );
}
