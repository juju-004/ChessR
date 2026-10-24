import { cn } from "@/lib/cn.js";

/** Hand-drawn berserk mark: a flame with a lightning bolt cut out of it
 *  (the bolt is a hole, so it shows whatever is behind). Filled, so it
 *  takes its colour from `currentColor`; size it with h-/w- classes. */
export function BerserkIcon({
  className,
  title,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={cn("shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      <path
        fillRule="evenodd"
        d="M12 1.5C12.2 4.4 13.7 6.2 15.6 8.1C17.6 10.1 19 12 19 14.8C19 18.7 15.9 22 12 22C8.1 22 5 18.7 5 14.8C5 12.8 5.8 11.1 7 9.8C7.3 11.4 8 12.4 9.2 12.9C8.6 9 9.8 4.8 12 1.5ZM13.4 9.6L8.8 15.2H11.6L10.6 19.6L15.4 13.4H12.5Z"
      />
    </svg>
  );
}
