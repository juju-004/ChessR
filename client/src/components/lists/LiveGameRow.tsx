import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AvatarStack } from "../ui/AvatarStack.js";
import { Badge } from "../ui/Badge.js";
import { CardRow } from "../ui/CardRow.js";
import { RCoin } from "../ui/RCoin.js";
import { TimeControlIcon } from "../ui/TimeControlIcon.js";
import { formatTimeControl } from "../../timeControls.js";

export interface LiveGamePlayer {
  username: string;
  avatarGradient?: string | null;
  /** Shown instead of the username (e.g. "You"). */
  label?: string;
  /** Makes the name a link to the player's profile. */
  profileHref?: string;
}

function PlayerName({ p }: { p: LiveGamePlayer }) {
  const text = p.label ?? p.username;
  if (!p.profileHref) return <>{text}</>;
  return (
    <Link to={p.profileHref} className="hover:underline">
      {text}
    </Link>
  );
}

/** A game in progress (or waiting for an opponent): overlapping avatars,
 *  "A vs B", time control, move number, stake, and a trailing action
 *  (Watch / Resume). Used for your own game and followed players' games. */
export function LiveGameRow({
  white,
  black,
  timeControl,
  moveCount,
  wagerTokens,
  highlight = false,
  waitingText = "Waiting for an opponent…",
  action,
}: {
  white: LiveGamePlayer;
  black?: LiveGamePlayer | null;
  timeControl: { baseSeconds: number | null; incrementSeconds: number };
  /** Plies played so far; the "Move N" prefix is hidden at 0. */
  moveCount: number;
  wagerTokens: number;
  highlight?: boolean;
  waitingText?: string;
  action: ReactNode;
}) {
  return (
    <CardRow highlight={highlight}>
      <div className="flex min-w-0 items-center gap-2.5">
        <AvatarStack players={black ? [white, black] : [white]} />
        <div className="min-w-0 text-sm text-base-content">
          <div className="truncate font-medium">
            {black ? (
              <>
                <PlayerName p={white} />{" "}
                <span className="text-base-content/40">vs</span>{" "}
                <PlayerName p={black} />
              </>
            ) : (
              waitingText
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-base-content/50">
            <span className="inline-flex items-center gap-1">
              {moveCount > 0 ? `Move ${Math.ceil(moveCount / 2)} · ` : ""}
              <TimeControlIcon baseSeconds={timeControl.baseSeconds} size={12} />
              {formatTimeControl(timeControl)}
            </span>
            {wagerTokens > 0 && (
              <Badge variant="warning">
                <span className="inline-flex items-center gap-1">
                  {wagerTokens} <RCoin size={10} />
                </span>
              </Badge>
            )}
          </div>
        </div>
      </div>
      <div className="shrink-0">{action}</div>
    </CardRow>
  );
}
