import { forwardRef } from "react";
import { motion, type HTMLMotionProps } from "framer-motion";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn.js";
import { springSnappy } from "@/lib/motion.js";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "gradient"
  | "glass"
  | "outline"
  | "ghost"
  | "danger";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends Omit<
  HTMLMotionProps<"button">,
  "ref" | "children"
> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner and disables the button — for an in-flight async action. */
  loading?: boolean;
  fullWidth?: boolean;
  children?: React.ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-(--primary) text-white shadow-md shadow-(--primary)/25 hover:brightness-110",
  secondary:
    "bg-(--secondary) text-white shadow-md shadow-(--secondary)/25 hover:brightness-110",
  gradient:
    "gradient-brand text-white shadow-lg shadow-(--primary)/25 hover:brightness-110",
  glass: "glass text-base-content hover:bg-base-content/5",
  outline:
    "border border-(--primary) text-(--primary) bg-transparent hover:bg-(--primary)/10",
  ghost:
    "bg-transparent text-base-content hover:bg-black/5 dark:hover:bg-white/10",
  danger: "bg-red-600 text-white hover:bg-red-500",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-sm rounded-lg gap-1.5",
  md: "h-10 px-4 text-sm rounded-xl gap-2",
  lg: "h-12 px-6 text-base rounded-xl gap-2",
  icon: "h-10 w-10 rounded-xl",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      loading,
      fullWidth,
      disabled,
      className,
      children,
      ...props
    },
    ref,
  ) {
    const isDisabled = disabled || loading;
    return (
      <motion.button
        ref={ref}
        disabled={isDisabled}
        whileTap={isDisabled ? undefined : { scale: 0.96 }}
        whileHover={isDisabled ? undefined : { scale: 1.015 }}
        transition={springSnappy}
        className={cn(
          "inline-flex items-center justify-center font-semibold transition-[filter,background-color] select-none",
          "disabled:opacity-50 disabled:pointer-events-none",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--primary) focus-visible:ring-offset-2 focus-visible:ring-offset-base-100",
          VARIANT_CLASSES[variant],
          SIZE_CLASSES[size],
          fullWidth && "w-full",
          className,
        )}
        {...props}
      >
        {loading && <Loader2 className="h-4 w-4 animate-spin" />}
        {children}
      </motion.button>
    );
  },
);
