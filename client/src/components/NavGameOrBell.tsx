import { Link, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { Gamepad2 } from "lucide-react";
import { pressable } from "@/lib/motion.js";
import { useMyActiveGame } from "../contexts/MyActiveGameContext.js";
import { NotificationsMenu } from "./NotificationsMenu.js";

/**
 * Same navbar slot serves two purposes, never both: the notifications
 * bell, or, only while the user has an active game AND isn't currently
 * looking at it, a shortcut straight back to that game. The two used to be
 * separate icons (this one and the old always-visible MyGamesMenu) side by
 * side, collapsed into one slot instead, on the reasoning that a game
 * icon that's relevant maybe once in a while doesn't need to permanently
 * cost a slot everyone else always sees, and the moments it IS relevant
 * (you tabbed away from your own live game) are exactly the moments a
 * generic notification bell in the same spot would be less useful anyway.
 */
export function NavGameOrBell() {
  const location = useLocation();
  const { joinCode } = useMyActiveGame();
  const onOwnGamePage = !!joinCode && location.pathname === `/game/${joinCode}`;

  if (joinCode && !onOwnGamePage) {
    return (
      <Link to={`/game/${joinCode}`} aria-label="Return to your game" className="relative">
        {/* animate-ping draws its own copy of the dot that scales up and
         *  fades, purely decorative, no layout weight of its own, so it
         *  can't interfere with the button's actual hit target. */}
        <span className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-(--primary)/40" />
        <motion.span
          className="elevated relative flex h-9 w-9 items-center justify-center rounded-full bg-(--primary)/10 text-(--primary)"
          {...pressable}
        >
          <Gamepad2 className="h-4 w-4" />
        </motion.span>
      </Link>
    );
  }

  return <NotificationsMenu />;
}
