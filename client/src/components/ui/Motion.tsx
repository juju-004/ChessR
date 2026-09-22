import type { ReactNode } from "react";
import { motion, type Variants } from "framer-motion";
import { fadeInUp, scaleIn, staggerContainer as makeStaggerContainer, staggerItem } from "@/lib/motion.js";

interface MotionWrapperProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  variants?: Variants;
}

/** Fades + slides up on mount. The default entrance for most content. */
export function FadeIn({ children, className, delay = 0, variants = fadeInUp }: MotionWrapperProps) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={variants}
      transition={{ delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/** Fades + scales up on mount — for cards, badges, anything that should feel
 *  like it "pops in" rather than slides. */
export function ScaleIn({ children, className, delay = 0 }: MotionWrapperProps) {
  return (
    <FadeIn className={className} delay={delay} variants={scaleIn}>
      {children}
    </FadeIn>
  );
}

interface StaggerProps {
  children: ReactNode;
  className?: string;
  /** Seconds between each child's entrance. */
  staggerMs?: number;
  delayMs?: number;
}

/** Wrap a list with this, and each direct child in <StaggerItem> — they'll
 *  cascade in one after another instead of all popping in at once. */
export function Stagger({ children, className, staggerMs = 0.06, delayMs = 0 }: StaggerProps) {
  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={makeStaggerContainer(staggerMs, delayMs)}
      className={className}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div variants={staggerItem} className={className}>
      {children}
    </motion.div>
  );
}
