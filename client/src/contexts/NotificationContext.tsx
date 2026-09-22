import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { slideInRight } from "../lib/motion.js";

/**
 * In-app notification banners — deliberately NOT window.confirm()/alert().
 * Those are synchronous, blocking dialogs, and browsers are inconsistent about
 * surfacing them promptly (or at all) on a background/unfocused tab, which made
 * real-time events like incoming challenges look like they weren't arriving when
 * they actually were.
 */

export interface NotifyAction {
  label: string;
  onClick: () => void;
  variant?: "primary" | "secondary" | "danger";
}

interface NotifyItem {
  id: string;
  /** When provided, a later notify() call with the same key replaces this
   *  toast in place instead of stacking a new one alongside it — e.g. the
   *  same person challenging you three times in a row should update one
   *  toast, not pile up three. */
  key?: string;
  message: string;
  actions: NotifyAction[];
  /** How long (ms) before this toast dismisses itself — omit for one that
   *  stays until the person acts on it or dismisses it manually. Also
   *  drives the depleting progress bar along the bottom edge. */
  autoDismissMs?: number;
}

// Hard ceiling on simultaneously visible toasts. A burst of notifications
// (a buggy client retrying, or someone spamming challenges/invites) would
// otherwise stack indefinitely in the fixed top-right column — on a phone,
// where each toast is up to 90vw wide, that's enough to cover the entire
// screen. Once this cap is hit, the oldest toast is dropped to make room
// for the new one.
const MAX_VISIBLE_TOASTS = 4;

interface NotificationContextValue {
  notify: (
    message: string,
    actions?: NotifyAction[],
    autoDismissMs?: number,
    key?: string,
  ) => string;
  dismiss: (id: string) => void;
}

const NotificationContext = createContext<NotificationContextValue | null>(
  null,
);

function actionClasses(variant?: NotifyAction["variant"]): string {
  const base = "rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors";
  if (variant === "secondary")
    return `${base} bg-base-300 hover:bg-base-content/10 text-base-content`;
  if (variant === "danger")
    return `${base} bg-red-600 hover:bg-red-500 text-white`;
  return `${base} gradient-brand text-white hover:brightness-110`;
}

function Toast({
  item,
  onDismiss,
}: {
  item: NotifyItem;
  onDismiss: () => void;
}) {
  return (
    <motion.div
      layout
      initial="hidden"
      animate="visible"
      exit="exit"
      variants={slideInRight}
      className="glass-strong relative overflow-hidden rounded-2xl p-3 pr-8 shadow-lg"
    >
      <p className="mb-2 text-sm text-base-content">{item.message}</p>

      {item.actions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {item.actions.map((a, i) => (
            <button
              key={i}
              className={actionClasses(a.variant)}
              onClick={() => {
                a.onClick();
                onDismiss();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute top-2 right-2 rounded-full p-1 text-base-content/40 transition-colors hover:bg-black/5 hover:text-base-content dark:hover:bg-white/10"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      {/* Progress indicator — a full-width bar that depletes via `scaleX`
       *  (transform, so it's GPU-only per @/lib/motion.ts) over exactly
       *  `autoDismissMs`, anchored to the left edge so it visibly shrinks
       *  from right to left as time runs out. A literal border tracing
       *  around all four edges would need to animate stroke-dashoffset,
       *  which is a paint-time SVG property rather than a compositor-only
       *  one — this bar reads just as clearly as "about to close" while
       *  staying within the GPU-only rule the whole animation system
       *  follows. */}
      {item.autoDismissMs && (
        <motion.span
          initial={{ scaleX: 1 }}
          animate={{ scaleX: 0 }}
          transition={{ duration: item.autoDismissMs / 1000, ease: "linear" }}
          style={{ transformOrigin: "left" }}
          className="gradient-brand absolute inset-x-0 bottom-0 h-1"
        />
      )}
    </motion.div>
  );
}

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<NotifyItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const notify = useCallback(
    (
      message: string,
      actions: NotifyAction[] = [],
      autoDismissMs?: number,
      key?: string,
    ) => {
      const id = crypto.randomUUID();
      setItems((prev) => {
        // A toast sharing `key` with an existing one replaces it in place
        // (same visual slot, fresh message/timer) instead of stacking —
        // this is what stops "challenged you" x5 from a spammy sender
        // turning into five separate toasts.
        const withoutSameKey = key ? prev.filter((i) => i.key !== key) : prev;
        const next = [...withoutSameKey, { id, key, message, actions, autoDismissMs }];
        // Oldest-first eviction once over the cap — a burst of distinct
        // notifications still can't grow the stack without bound.
        return next.length > MAX_VISIBLE_TOASTS
          ? next.slice(next.length - MAX_VISIBLE_TOASTS)
          : next;
      });
      if (autoDismissMs) setTimeout(() => dismiss(id), autoDismissMs);
      return id;
    },
    [dismiss],
  );

  // notify/dismiss are already stable (useCallback), so this object never
  // changes identity across re-renders — every useNotify() consumer app-
  // wide is fully insulated from this provider's own toast-list re-renders.
  const value = useMemo(() => ({ notify, dismiss }), [notify, dismiss]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <div className="fixed top-4 right-4 z-1000 flex w-80 max-w-[90vw] flex-col gap-2">
        <AnimatePresence>
          {items.map((item) => (
            <Toast
              key={item.id}
              item={item}
              onDismiss={() => dismiss(item.id)}
            />
          ))}
        </AnimatePresence>
      </div>
    </NotificationContext.Provider>
  );
}

export function useNotify(): NotificationContextValue {
  const ctx = useContext(NotificationContext);
  if (!ctx)
    throw new Error("useNotify must be used within NotificationProvider");
  return ctx;
}
