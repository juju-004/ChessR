import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/cn.js";
import { fadeInUp, springSnappy } from "@/lib/motion.js";

export interface PageProps {
  children: ReactNode;
  /** Header title. Omit entirely for a page that wants no header at all
   *  (still gets the responsive width/padding + fade-in). */
  title?: string;
  description?: string;
  /** Adds a back button before the title. Pass a specific route to navigate
   *  there directly, or `true` to just pop one entry off browser history. */
  back?: boolean | string;
  /** Right-aligned header content — a primary action button, a badge, etc. */
  actions?: ReactNode;
  className?: string;
  /** Skips the default `mx-auto max-w-5xl px-* py-*` outer container —
   *  for a page rendered inside a parent that already provides that
   *  chrome (e.g. a layout route wrapping several sibling pages), so
   *  the two don't stack and double the width constraint/padding. The
   *  header + fade-in mount animation still apply. */
  bare?: boolean;
}

/**
 * The standard page shell — responsive max-width/padding, and a fade-up
 * entrance on mount (opacity + y only, fully GPU-accelerated per
 * @/lib/motion.ts). Use it to wrap a route's content instead of hand-rolling
 * the same "mx-auto max-w-* px-* py-*" + optional header on every page:
 *
 *   <Page title="Tournaments" back actions={<Button>New</Button>}>
 *     ...page content...
 *   </Page>
 */
export function Page({
  children,
  title,
  description,
  back,
  actions,
  className,
  bare = false,
}: PageProps) {
  const navigate = useNavigate();

  function handleBack() {
    if (typeof back === "string") navigate(back);
    else navigate(-1);
  }

  const hasHeader = !!(title || description || back || actions);

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={fadeInUp}
      className={cn(
        bare
          ? "w-full"
          : "mx-auto w-full max-w-5xl px-5 py-6 sm:px-6 md:px-8 md:py-10",
        className,
      )}
    >
      {hasHeader && (
        <header className="mb-6 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {back && (
              <motion.button
                type="button"
                onClick={handleBack}
                aria-label="Go back"
                whileTap={{ scale: 0.9 }}
                whileHover={{ scale: 1.05 }}
                transition={springSnappy}
                className="glass mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-base-content/70 hover:text-base-content"
              >
                <ArrowLeft className="h-4 w-4" />
              </motion.button>
            )}
            {(title || description) && (
              <div>
                {title && (
                  <h1 className="text-xl font-bold text-base-content md:text-2xl">
                    {title}
                  </h1>
                )}
                {description && (
                  <p className="mt-1 text-sm text-base-content/60">
                    {description}
                  </p>
                )}
              </div>
            )}
          </div>
          {actions && (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          )}
        </header>
      )}
      {children}
    </motion.div>
  );
}
