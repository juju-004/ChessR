import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, LocateFixed, Minus } from "lucide-react";
import type { LeagueStandingRow } from "../../api/leagues.js";
import { Pagination } from "../Pagination.js";
import { Avatar, Card, CardHeader, CardTitle } from "../ui/index.js";
import { cn } from "../../lib/cn.js";

/** Arrow + number of places moved since the previous tournament. */
function Movement({ row }: { row: LeagueStandingRow }) {
  if (row.movement === null) return null;
  if (row.movement === 0) {
    return (
      <Minus className="h-3 w-3 text-base-content/30" aria-label="No change" />
    );
  }
  const up = row.movement > 0;
  return (
    <span
      className={cn(
        "inline-flex items-center text-[11px] font-semibold",
        up ? "text-green-500" : "text-red-400",
      )}
      title={`${up ? "Up" : "Down"} ${Math.abs(row.movement)} ${Math.abs(row.movement) === 1 ? "place" : "places"}`}
    >
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(row.movement)}
    </span>
  );
}

/** The league table: rank, movement arrow + places moved next to
 *  the name, this tournament's points and the running total. Shared by the
 *  league page and every tournament page that belongs to a league. */
export function LeagueStandings({
  rows,
  myId,
  title = "Standings",
  subtitle,
  leagueLink,
  showLastColumn = true,
  pageSize = 10,
}: {
  rows: LeagueStandingRow[];
  myId?: string;
  title?: string;
  subtitle?: string;
  /** Renders the title area as a link back to the league page. */
  leagueLink?: string;
  /** The "+N" column, points from the tournament the table runs through. */
  showLastColumn?: boolean;
  /** Rows per page. 10 on a tournament page, 20 on the league page itself. */
  pageSize?: number;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const paged = rows.slice(safePage * pageSize, safePage * pageSize + pageSize);
  const myIndex = myId ? rows.findIndex((r) => r.user === myId) : -1;
  const anyLast = showLastColumn && rows.some((r) => r.lastPoints > 0);

  return (
    <Card variant="solid">
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>
            {leagueLink ? (
              <Link to={leagueLink} className="hover:underline">
                {title}
              </Link>
            ) : (
              title
            )}
          </CardTitle>
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
                <th className="w-10 px-3 py-2">#</th>
                <th className="px-3 py-2">Player</th>
                {anyLast && <th className="w-14 px-3 py-2 text-right">This</th>}
                <th className="w-16 px-3 py-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((r, i) => {
                const isMe = r.user === myId;
                return (
                  <tr
                    key={r.user}
                    className={cn(
                      "border-t border-base-300/60",
                      isMe
                        ? "bg-(--secondary)/10"
                        : i % 2 === 0
                          ? "bg-base-100/50"
                          : "bg-base-200/50",
                    )}
                  >
                    <td className="py-2 pl-3 font-semibold text-base-content/70">
                      {r.rank}
                    </td>
                    <td
                      className={cn(
                        "max-w-0 px-3 py-2",
                        isMe && "font-semibold text-(--secondary)",
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-1.5">
                        <Avatar
                          username={r.username}
                          gradient={r.avatarGradient}
                          size="xs"
                        />
                        <span className="min-w-0 truncate">{r.username}</span>
                        <span className="shrink-0">
                          <Movement row={r} />
                        </span>
                      </div>
                    </td>
                    {anyLast && (
                      <td className="px-3 py-2 text-right text-xs text-base-content/50">
                        {r.lastPoints > 0 ? `+${r.lastPoints}` : "–"}
                      </td>
                    )}
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
