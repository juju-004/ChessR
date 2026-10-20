import { LineChart } from "lucide-react";
import { Avatar } from "../ui/Avatar.js";
import { Badge } from "../ui/Badge.js";
import { EmptyState } from "../ui/EmptyState.js";
import { LoadMoreButton } from "../ui/LoadMoreButton.js";
import { ListRow } from "../ui/ListRow.js";
import { CenteredSpinner } from "../ui/CenteredSpinner.js";
import { TimeControlIcon } from "../ui/TimeControlIcon.js";
import type { UserGameHistoryItem } from "../../api/users.js";
import { formatTimeControl } from "../../timeControls.js";

const RESULT_VARIANT: Record<
  UserGameHistoryItem["result"],
  "success" | "error" | "neutral"
> = {
  win: "success",
  loss: "error",
  draw: "neutral",
};

export interface GameHistoryListProps {
  games: UserGameHistoryItem[];
  /** True while a page is being fetched. */
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  /** Where a row goes when tapped (the replay, ...). */
  linkFor: (game: UserGameHistoryItem) => string;
  emptyText?: string;
}

/** A finished-games list: opponent, colour, time control, length, date and
 *  the result. Used for the profile's game history. */
export function GameHistoryList({
  games,
  loading,
  hasMore,
  onLoadMore,
  linkFor,
  emptyText = "No games played yet.",
}: GameHistoryListProps) {
  return (
    <>
      {loading && games.length === 0 && (
        <CenteredSpinner size="sm" className="py-8" />
      )}

      {!loading && games.length === 0 && (
        <EmptyState icon={LineChart}>{emptyText}</EmptyState>
      )}

      <div>
        {games.map((g) => (
          <ListRow
            key={g.gameId}
            to={linkFor(g)}
            leading={
              <Avatar
                username={g.opponent?.username ?? "?"}
                size="sm"
                gradient={g.opponent?.avatarGradient}
              />
            }
            title={
              <span className="truncate">
                vs {g.opponent?.username ?? "Unknown"}
              </span>
            }
            subtitle={
              <>
                <span
                  className={
                    g.color === "white"
                      ? "inline-block h-2 w-2 rounded-full border border-base-content/30 bg-white"
                      : "inline-block h-2 w-2 rounded-full border border-base-content/30 bg-black"
                  }
                />
                <span className="capitalize">{g.color}</span>
                <span>·</span>
                <span className="inline-flex items-center gap-1">
                  <TimeControlIcon
                    baseSeconds={g.timeControl.baseSeconds}
                    size={12}
                  />
                  {formatTimeControl(g.timeControl)}
                </span>
                <span>·</span>
                <span>{g.moveCount} moves</span>
                <span>·</span>
                <span>{new Date(g.endedAt).toLocaleDateString()}</span>
              </>
            }
            trailing={
              <Badge variant={RESULT_VARIANT[g.result]} className="uppercase">
                {g.result}
              </Badge>
            }
          />
        ))}
      </div>

      {loading && games.length > 0 && (
        <CenteredSpinner size="sm" className="py-4" />
      )}

      <LoadMoreButton hasMore={!loading && hasMore} onClick={onLoadMore} />
    </>
  );
}
