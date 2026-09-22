import { motion } from "framer-motion";
import { cn } from "@/lib/cn.js";
import { springSnappy } from "@/lib/motion.js";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
  className?: string;
}

const TRACK_WIDTH = 40; // px
const THUMB_SIZE = 16; // px
const TRACK_PADDING = 2; // px

/**
 * The thumb's "sliding" motion is a `translateX` on a fixed-size element,
 * never a `left`/`width` change — same GPU-only rule as everywhere else in
 * this kit (see @/lib/motion.ts).
 */
export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
}: SwitchProps) {
  const travel = TRACK_WIDTH - THUMB_SIZE - TRACK_PADDING * 2;

  const track = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      style={{ width: TRACK_WIDTH, padding: TRACK_PADDING }}
      className={cn(
        "relative inline-flex h-6 shrink-0 items-center rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--primary) focus-visible:ring-offset-2 focus-visible:ring-offset-base-100",
        checked ? "gradient-brand" : "bg-base-300",
        disabled && "opacity-50 pointer-events-none",
      )}
    >
      <motion.span
        style={{ width: THUMB_SIZE, height: THUMB_SIZE }}
        className="block rounded-full bg-white shadow-sm"
        animate={{ x: checked ? travel : 0 }}
        transition={springSnappy}
      />
    </button>
  );

  if (!label && !description) return track;

  return (
    <label
      className={cn(
        "flex cursor-pointer items-start justify-between gap-4",
        className,
      )}
    >
      <span>
        {label && (
          <span className="block text-sm text-base-content">{label}</span>
        )}
        {description && (
          <span className="block text-xs text-base-content/50">
            {description}
          </span>
        )}
      </span>
      {track}
    </label>
  );
}
