import { useState } from "react";
import { Link } from "react-router-dom";
import { LocateFixed } from "lucide-react";
import type { LeagueStandingRow } from "../../api/leagues.js";
import { Pagination } from "../Pagination.js";
import { RatingBadge } from "../RatingBadge.js";
import {
  Avatar,
  Card,
  CardHeader,
  CardTitle,
  ResponsiveOverlay,
} from "../ui/index.js";
import { Movement } from "./Movement.js";
import {
  RankBadge,
  STANDINGS_RANK_TD,
  STANDINGS_RANK_TH,
} from "./RankBadge.js";
import { cn } from "../../lib/cn.js";

/** Win percentage across the league, "–" until the player has a finished game. */
function winPercent(r: LeagueStandingRow): string {
  if (!r.games) return "–";
  return `${Math.round((r.wins / r.games) * 100)}%`;
}

/** APPT: average points per tournament entered, one decimal at most. */
function avgPoints(r: LeagueStandingRow): string {
  if (!r.played) return "–";
  return String(Math.round((r.points / r.played) * 10) / 10);
}

/** What opens when a league row is tapped: just who they are plus the two
 *  league-wide numbers. Phones get both here instead of as table columns. */
function LeaguePlayerPanel({ row }: { row: LeagueStandingRow }) {
  const stats = [
    { label: "Win %", value: winPercent(row) },
    { label: "Avg pts / tournament", value: avgPoints(row) },
  ];
  return (
    <div className="flex w-full max-w-full flex-col items-center space-y-2">
      <div className="w-full rounded-xl bg-base-200/70 px-2 py-2.5">
        <div className="flex items-center gap-3 pb-3 pt-1">
          <Avatar
            username={row.username}
            gradient={row.avatarGradient}
            size="md"
          />
          <div className="min-w-0">
            <Link
              to={`/profile/${row.username}`}
              className="block truncate text-base font-semibold text-base-content transition-colors hover:text-(--secondary) hover:underline"
            >
              {row.username}
            </Link>
            <div className="mt-0.5 flex items-center gap-2">
              <RatingBadge rating={row.rating} />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t-2 border-base-300/35 md:border-none">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl px-2 py-2.5 text-center md:bg-base-200/70"
            >
              <p className="text-base font-bold text-base-content md:text-lg">
                {s.value}
              </p>
              <p className="text-[11px] text-base-content/50">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** The league table, built the same way as a tournament's standings table
 *  (medal rank badges, tap a player for their panel, rating badge, "Me"
 *  jump, badge pager) with league-specific columns: win percentage and
 *  average points per tournament (APPT) on desktop, folded into the player
 *  panel on phones, then the running total. */
export function LeagueStandings({
  rows,
  myId,
  title = "Standings",
  subtitle,
  pageSize = 10,
}: {
  rows: LeagueStandingRow[];
  myId?: string;
  title?: string;
  subtitle?: string;
  /** Rows per page. */
  pageSize?: number;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const paged = rows.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const myIndex = myId ? rows.findIndex((r) => r.user === myId) : -1;

  return (
    <Card variant="solid">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {subtitle && (
            <p className="mt-0.5 text-xs text-base-content/50">{subtitle}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {myIndex !== -1 && (
            <button
              type="button"
              onClick={() => setPage(Math.floor(myIndex / pageSize))}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-(--secondary) transition-colors hover:bg-(--secondary)/10"
            >
              <LocateFixed className="h-3.5 w-3.5" /> Me
            </button>
          )}
          <Pagination
            badge
            page={safePage}
            pageCount={pageCount}
            onPageChange={setPage}
          />
        </div>
      </CardHeader>
      {rows.length === 0 ? (
        <p className="text-sm text-base-content/50">
          No standings yet. They appear once the first tournament starts.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-base-300">
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="bg-base-300/50 text-left text-[11px] font-semibold uppercase tracking-wide text-base-content/50">
                <th className={STANDINGS_RANK_TH}>#</th>
                <th className="px-2 py-2 md:px-3">Player</th>
                <th className="hidden w-20 px-3 py-2 text-right md:table-cell">
                  Win %
                </th>
                <th
                  className="hidden w-20 px-3 py-2 text-right md:table-cell"
                  title="Average points per tournament"
                >
                  APPT
                </th>
                <th className="w-14 px-3 py-2 text-right md:w-16">Pts</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((r, i) => {
                const isMe = r.user === myId;
                return (
                  <tr
                    key={r.user}
                    className={cn(
                      "border-t border-base-300/60 transition-colors",
                      isMe
                        ? "bg-(--secondary)/10"
                        : i % 2 === 0
                          ? "bg-base-100/50"
                          : "bg-base-200/50",
                    )}
                  >
                    <td className={STANDINGS_RANK_TD}>
                      <RankBadge rank={r.rank} />
                    </td>
                    <td
                      className={cn(
                        "max-w-0 px-2 py-2 md:px-3",
                        isMe && "font-semibold text-(--secondary)",
                      )}
                    >
                      <ResponsiveOverlay
                        align="start"
                        trigger={
                          <button className="flex w-full min-w-0 items-center gap-1.5 text-left duration-150 hover:scale-95">
                            <Avatar
                              username={r.username}
                              gradient={r.avatarGradient}
                              size="xs"
                            />
                            <span className="min-w-0 truncate">
                              {r.username}
                            </span>
                            <RatingBadge
                              className="shrink-0"
                              rating={r.rating}
                            />
                            <span className="shrink-0">
                              <Movement movement={r.movement} />
                            </span>
                          </button>
                        }
                      >
                        <LeaguePlayerPanel row={r} />
                      </ResponsiveOverlay>
                    </td>
                    <td className="hidden px-3 py-2 text-right text-base-content/70 md:table-cell">
                      {winPercent(r)}
                    </td>
                    <td className="hidden px-3 py-2 text-right text-base-content/70 md:table-cell">
                      {avgPoints(r)}
                    </td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right font-semibold",
                        isMe ? "text-secondary" : "text-base-content",
                      )}
                    >
                      {r.points}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
