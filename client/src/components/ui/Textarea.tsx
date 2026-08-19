import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn.js";

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  hint?: string;
  error?: string;
  label?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ label, hint, error, className, id, rows = 4, ...props }, ref) {
    const areaId = id ?? props.name;
    return (
      <div className="w-full">
        {label && (
          <label
            htmlFor={areaId}
            className="mb-1.5 block text-sm font-medium text-base-content/80"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={areaId}
          rows={rows}
          className={cn(
            "w-full resize-y rounded-lg border bg-base-200 px-3 py-2 text-sm text-base-content placeholder:text-base-content/40",
            "border-base-300 transition-colors",
            "focus:outline-none focus:ring-2 focus:ring-(--primary) focus:border-transparent",
            error && "border-red-500 focus:ring-red-500",
            className,
          )}
          aria-invalid={!!error}
          {...props}
        />
        {(hint || error) && (
          <p className={cn("mt-1 text-xs", error ? "text-red-500" : "text-base-content/50")}>
            {error ?? hint}
          </p>
        )}
      </div>
    );
  },
);
