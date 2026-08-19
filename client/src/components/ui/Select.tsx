import { forwardRef, type ReactNode, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn.js";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Usually a string, but accepts any node — e.g. a label paired with a
   *  HelpTip, same pattern as Input's label. */
  label?: string | ReactNode;
  hint?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ label, hint, className, id, children, ...props }, ref) {
    const selectId = id ?? props.name;
    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={selectId}
            className="mb-1.5 block text-sm font-medium text-base-content/80"
          >
            {label}
          </label>
        )}
        <div className="relative">
          <select
            ref={ref}
            id={selectId}
            className={cn(
              "h-10 w-full appearance-none rounded-xl border border-base-300 bg-base-100/60 px-3 pr-9 text-sm text-base-content",
              "focus:outline-none focus:ring-2 focus:ring-(--primary) focus:border-transparent",
              className,
            )}
            {...props}
          >
            {children}
          </select>
          <ChevronDown className="pointer-events-none absolute inset-y-0 right-3 my-auto h-4 w-4 text-base-content/40" />
        </div>
        {hint && <p className="mt-1 text-xs text-base-content/50">{hint}</p>}
      </div>
    );
  },
);
