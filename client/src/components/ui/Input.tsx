import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn.js";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Small text shown under the field — swaps to error styling when `error` is set. */
  hint?: string;
  error?: string;
  label?: string | ReactNode;
  /** e.g. a lucide icon, positioned inside the left edge of the field. */
  leadingIcon?: ReactNode;
  /** e.g. a lucide icon, positioned inside the right edge of the field —
   *  a plain decorative icon if `onTrailingIconClick` is omitted, or a
   *  small icon button (e.g. password show/hide) if it's provided. */
  trailingIcon?: ReactNode;
  onTrailingIconClick?: () => void;
  trailingIconLabel?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    hint,
    error,
    leadingIcon,
    trailingIcon,
    onTrailingIconClick,
    trailingIconLabel,
    className,
    id,
    ...props
  },
  ref,
) {
  const inputId = id ?? props.name;
  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="mb-1.5 block text-xs sm:text-sm font-medium text-base-content/80"
        >
          {label}
        </label>
      )}
      <div className="relative">
        {leadingIcon && (
          <span className="pointer-events-none z-20 absolute inset-y-0 left-3 flex items-center text-base-content/40">
            {leadingIcon}
          </span>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            "h-10 w-full rounded-lg border bg-base-100/60 px-3 text-sm text-base-content placeholder:text-base-content/40",
            "border-base-300 transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-(--primary) focus:border-transparent",
            error && "border-red-500 focus:ring-red-500",
            leadingIcon ? "pl-9" : "",
            trailingIcon ? "pr-9" : "",
            className,
          )}
          aria-invalid={!!error}
          {...props}
        />
        {trailingIcon &&
          (onTrailingIconClick ? (
            <button
              type="button"
              onClick={onTrailingIconClick}
              aria-label={trailingIconLabel}
              className="absolute inset-y-0 right-2.5 z-20 flex items-center text-base-content/40 transition-colors hover:text-base-content/70"
            >
              {trailingIcon}
            </button>
          ) : (
            <span className="pointer-events-none absolute inset-y-0 right-3 z-20 flex items-center text-base-content/40">
              {trailingIcon}
            </span>
          ))}
      </div>
      {(hint || error) && (
        <p
          className={cn(
            "mt-1 text-xs",
            error ? "text-red-500" : "text-base-content/50",
          )}
        >
          {error ?? hint}
        </p>
      )}
    </div>
  );
});
