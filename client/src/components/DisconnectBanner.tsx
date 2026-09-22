import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ShieldAlert } from "lucide-react";
import { springSnappy } from "../lib/motion.js";
import { Card, Button } from "./ui/index.js";

export interface DisconnectBannerProps {
  /** Timestamp the opponent becomes claimable at. Already in the past
   *  (e.g. `Date.now()`) means "claimable right now". */
  expiresAt: number;
  onClaim: (result: "win" | "draw") => void;
}

/**
 * Same banner Game.tsx used to render inline off a `{ message, claimable }`
 * state object that got recomputed by a page-level 500ms `setInterval` —
 * which meant every second the opponent stayed disconnected, the entire
 * Game page (board, sidebar, any open modal) re-rendered right along with
 * it. This component owns its own 500ms tick instead, so a re-render here
 * never reaches past this banner.
 */
export function DisconnectBanner({ expiresAt, onClaim }: DisconnectBannerProps) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) return; // already claimable — nothing to tick toward
    const interval = window.setInterval(() => {
      forceTick((n) => n + 1);
      if (expiresAt - Date.now() <= 0) window.clearInterval(interval);
    }, 500);
    return () => window.clearInterval(interval);
  }, [expiresAt]);

  const remainingMs = Math.max(0, expiresAt - Date.now());
  const claimable = remainingMs <= 0;
  const message = claimable
    ? "Opponent has not reconnected — you can claim this game now."
    : `Opponent disconnected. You can claim the game in ${Math.ceil(remainingMs / 1000)}s if they don't return.`;

  return (
    <motion.div
      key="disconnect-banner"
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={springSnappy}
      className="pointer-events-auto"
    >
      <Card variant="strong" className="border-red-900/50 shadow-xl">
        <p className="mb-2 flex items-center gap-1.5 text-sm text-red-300">
          <ShieldAlert className="h-4 w-4 shrink-0" /> {message}
        </p>
        {claimable && (
          <div className="flex gap-2">
            <Button size="sm" variant="danger" onClick={() => onClaim("win")}>
              Claim victory
            </Button>
            <Button size="sm" variant="glass" onClick={() => onClaim("draw")}>
              Claim draw
            </Button>
          </div>
        )}
      </Card>
    </motion.div>
  );
}
