/**
 * Full-page fallback shown by <Suspense> while a lazy-loaded route chunk
 * (see App.tsx) is still downloading/parsing. This is NOT the small inline
 * spinner (@/components/ui/Spinner) used for in-page/button loading states;
 * that one is untouched and still used everywhere it already was.
 */
import { motion } from "framer-motion";

export function PageLoader() {
  return (
    <div className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-6">
      <div className="relative flex items-center justify-center">
        <motion.div
          aria-hidden="true"
          className="gradient-brand absolute h-24 w-24 rounded-full blur-2xl"
          animate={{ opacity: [0.25, 0.5, 0.25], scale: [0.9, 1.05, 0.9] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <div
        className="flex items-center gap-1.5"
        role="status"
        aria-label="Loading"
      >
        {[0, 1, 2].map((i) => (
          <motion.span
            key={i}
            className="gradient-brand h-2 w-2 rounded-full"
            animate={{ opacity: [0.3, 1, 0.3], y: [0, -3, 0] }}
            transition={{
              duration: 0.9,
              repeat: Infinity,
              ease: "easeInOut",
              delay: i * 0.15,
            }}
          />
        ))}
      </div>
    </div>
  );
}
