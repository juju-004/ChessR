import type { Variants, Transition, TargetAndTransition } from "framer-motion";

/**
 * GPU-accelerated animation helpers — the only ones the `@/components/ui`
 * kit uses, and the ones you should reach for everywhere else too.
 *
 * Hard rule this whole file follows: every variant/transition here only
 * ever animates `opacity`, plus framer-motion's `x` / `y` / `scale` /
 * `rotate` props. Those four all resolve to a single CSS `transform`
 * declaration under the hood, and `transform` + `opacity` are the two CSS
 * properties a browser can animate purely on the compositor thread — no
 * layout recalculation, no repaint of surrounding content. That's what
 * keeps these smooth on a five-year-old Android phone, not just on a dev
 * machine.
 *
 * Never add a variant here that animates width/height/top/left/margin/
 * padding (triggers layout) or backgroundColor/boxShadow/color (triggers
 * paint). If you need one of those visually, fake it with a transform-scale
 * or an opacity cross-fade instead — e.g. a "growing" card is a `scale`
 * animation on a pre-sized box, not an actual `width`/`height` tween.
 */

// "Expo out" — fast start, gentle settle, no overshoot. Good default for
// anything entering the screen.
export const EASE_OUT: Transition = [0.16, 1, 0.3, 1];
export const EASE_IN_OUT: Transition = [0.65, 0, 0.35, 1];

export const springSnappy: Transition = {
  type: "spring",
  stiffness: 420,
  damping: 32,
  mass: 0.7,
};
export const springSoft: Transition = {
  type: "spring",
  stiffness: 260,
  damping: 26,
};
export const tweenFast: Transition = { duration: 0.15, ease: EASE_OUT };
export const tweenBase: Transition = { duration: 0.25, ease: EASE_OUT };
export const tweenSlow: Transition = { duration: 0.4, ease: EASE_IN_OUT };

// --- Entrance/exit variants --------------------------------------------------
// Use with <AnimatePresence> + initial="hidden" animate="visible" exit="exit".

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: tweenBase },
  exit: { opacity: 0, transition: tweenFast },
};

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: tweenBase },
  exit: { opacity: 0, y: 8, transition: tweenFast },
};

export const fadeInDown: Variants = {
  hidden: { opacity: 0, y: -16 },
  visible: { opacity: 1, y: 0, transition: tweenBase },
  exit: { opacity: 0, y: -8, transition: tweenFast },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: { opacity: 1, scale: 1, transition: springSnappy },
  exit: { opacity: 0, scale: 0.96, transition: tweenFast },
};

export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 24 },
  visible: { opacity: 1, x: 0, transition: tweenBase },
  exit: { opacity: 0, x: 24, transition: tweenFast },
};

export const slideInLeft: Variants = {
  hidden: { opacity: 0, x: -24 },
  visible: { opacity: 1, x: 0, transition: tweenBase },
  exit: { opacity: 0, x: -24, transition: tweenFast },
};

// --- Staggered lists ----------------------------------------------------------
// Put staggerContainer on the parent (initial/animate="visible", no exit
// needed unless the whole list unmounts) and staggerItem on each child.

export function staggerContainer(staggerMs = 0.06, delayMs = 0): Variants {
  return {
    hidden: {},
    visible: {
      transition: { staggerChildren: staggerMs, delayChildren: delayMs },
    },
  };
}

export const staggerItem: Variants = fadeInUp;

// --- Modal / overlay ------------------------------------------------------------

export const modalBackdrop: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: tweenBase },
  exit: { opacity: 0, transition: tweenFast },
};

// A tween, not a spring — springSnappy settles in ~250-300ms even though
// it "looks" fast because of the initial overshoot; a modal/popover
// opening or closing is a frequent, high-traffic interaction where that
// extra settle time reads as lag, not polish. Fixed, short durations here
// instead.
const overlayIn: Transition = { duration: 0.14, ease: EASE_OUT };
const overlayOut: Transition = { duration: 0.09, ease: EASE_OUT };

export const modalContent: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 6 },
  visible: { opacity: 1, scale: 1, y: 0, transition: overlayIn },
  exit: { opacity: 0, scale: 0.98, y: 3, transition: overlayOut },
};

// Popover's own entrance — deliberately not reusing the general-purpose
// scaleIn below (Card/badge "pop in" entrances elsewhere in the app),
// since those didn't need to get faster and shouldn't change just because
// Popover did.
export const popoverContent: Variants = {
  hidden: { opacity: 0, scale: 0.94 },
  visible: { opacity: 1, scale: 1, transition: overlayIn },
  exit: { opacity: 0, scale: 0.96, transition: overlayOut },
};

// --- Interaction micro-states -------------------------------------------------
// Spread directly onto a `motion.*` element: <motion.button {...pressable}>

export const pressable: {
  whileTap: TargetAndTransition;
  whileHover: TargetAndTransition;
  transition: Transition;
} = {
  whileTap: { scale: 0.96 },
  whileHover: { scale: 1.02 },
  transition: springSnappy,
};

export const liftable: {
  whileTap: TargetAndTransition;
  whileHover: TargetAndTransition;
  transition: Transition;
} = {
  whileTap: { scale: 0.98 },
  whileHover: { scale: 1.015, y: -2 },
  transition: springSnappy,
};

export const tapScale: TargetAndTransition = { scale: 0.96 };
export const hoverLift: TargetAndTransition = { scale: 1.02, y: -2 };
