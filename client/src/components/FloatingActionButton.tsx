import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn.js';

interface FloatingActionButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'default' | 'danger' | 'warning';
  className?: string;
}

const VARIANT_CLASSES: Record<NonNullable<FloatingActionButtonProps['variant']>, string> = {
  default: 'elevated-strong text-base-content hover:bg-base-content/5',
  danger: 'bg-red-600/90 text-white shadow-lg shadow-red-900/30 hover:bg-red-500',
  warning: 'bg-amber-600/90 text-white shadow-lg shadow-amber-900/30 hover:bg-amber-500',
};

/** A self-contained floating pill, icon + label, for the fixed action bar
 *  at the bottom of the game page. Deliberately plain CSS transitions
 *  (opacity/background on hover) rather than framer-motion; these sit fixed
 *  on screen the whole time, so there's no mount/layout animation to earn
 *  the extra weight. */
export function FloatingActionButton({ icon: Icon, label, onClick, disabled, variant = 'default', className }: FloatingActionButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold shadow-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        VARIANT_CLASSES[variant],
        className,
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </button>
  );
}
