import type { ReactNode } from "react";
import { Avatar } from "../ui/Avatar.js";
import { ListRow } from "../ui/ListRow.js";
import { RatingBadge } from "../RatingBadge.js";
import type { RatingCategory } from "../../timeControls.js";

export interface PlayerRowProps {
  username: string;
  avatarGradient?: string | null;
  /** Omit for lists that don't know presence (search results, requests). */
  online?: boolean;
  rating?: number | null;
  ratingCategory?: RatingCategory | null;
  /** Row click, normally navigating to the player's profile. */
  onClick?: () => void;
  /** Action buttons on the right. */
  actions?: ReactNode;
}

/** A player in a list: avatar (with presence dot when known), name, rating
 *  and optional actions. Used by search results, friend requests, online
 *  players and friends so they all read the same. */
export function PlayerRow({
  username,
  avatarGradient,
  online,
  rating,
  ratingCategory,
  onClick,
  actions,
}: PlayerRowProps) {
  return (
    <ListRow
      onClick={onClick}
      leading={
        <Avatar
          username={username}
          size="sm"
          gradient={avatarGradient}
          status={online === undefined ? null : online ? "online" : "offline"}
        />
      }
      title={
        <>
          <span className="min-w-0 truncate">{username}</span>
          {rating != null && (
            <RatingBadge rating={rating} category={ratingCategory} showIcon />
          )}
        </>
      }
      trailing={actions}
    />
  );
}
