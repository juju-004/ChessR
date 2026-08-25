/** Joins truthy class names together. Deliberately not clsx/tailwind-merge, 
 *  the ui kit's conditional classes never conflict badly enough to need
 *  Tailwind-aware merging, so this stays a zero-dependency one-liner. */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ');
}
