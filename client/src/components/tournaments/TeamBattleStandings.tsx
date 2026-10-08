import { useState } from "react";
import { ChevronDown, Users } from "lucide-react";
import type { Tournament, TeamStanding } from "../../api/tournaments.js";
import { cn } from "@/lib/cn.js";
import { Card, CardHeader, CardTitle } from "../ui/index.js";

const MEDALS = ["bg-amber-400 text-black", "bg-slate-300 text-black", "bg-orange-400 text-black"];

/** Team standings for a team battle: shown ABOVE the normal player standings.
 *  A team's score is the sum of its best `leadersPerTeam` players; tap a row
 *  to see which players are counting towards it. */
export function TeamBattleStandings({
  tournament,
  myTeamId,
}: {
  tournament: Tournament;
  myTeamId: string | null;
}) {
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const battle = tournament.teamBattle;
  if (!battle) return null;
  const rows: TeamStanding[] =
    tournament.teamStandings ??
    battle.teams.map((t) => ({ team: t.team, name: t.name, score: 0, playerCount: 0, leaders: [] }));

  return (
    <Card variant="solid">
      <CardHeader>
        <CardTitle className="inline-flex items-center gap-1.5">
          <Users className="h-4 w-4" /> Team standings
        </CardTitle>
        <span className="text-xs text-base-content/50">
          Top {battle.leadersPerTeam} {battle.leadersPerTeam === 1 ? "player" : "players"} per team count
        </span>
      </CardHeader>
      <div className="overflow-hidden rounded-xl border border-base-300">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="bg-base-300/50 text-left text-[11px] font-semibold uppercase tracking-wide text-base-content/50">
              <th className="w-10 px-3 py-2">#</th>
              <th className="px-3 py-2">Team</th>
              <th className="w-16 px-3 py-2 text-center">Players</th>
              <th className="w-16 px-3 py-2 text-right">Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const isMine = r.team === myTeamId;
              const expanded = openTeam === r.team;
              return (
                <RowGroup key={r.team}>
                  <tr
                    onClick={() => setOpenTeam(expanded ? null : r.team)}
                    className={cn(
                      "cursor-pointer border-t border-base-300/60 transition-colors",
                      isMine ? "bg-(--secondary)/10" : i % 2 === 0 ? "bg-base-100/50" : "bg-base-200/50",
                    )}
                  >
                    <td className="py-2 pl-3">
                      <span
                        className={cn(
                          "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold",
                          MEDALS[i] ?? "text-base-content/60",
                        )}
                      >
                        {i + 1}
                      </span>
                    </td>
                    <td className={cn("max-w-0 px-3 py-2", isMine && "font-semibold text-(--secondary)")}>
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate">{r.name}</span>
                        <ChevronDown
                          className={cn(
                            "h-3.5 w-3.5 shrink-0 text-base-content/40 transition-transform",
                            expanded && "rotate-180",
                          )}
                        />
                      </span>
                    </td>
                    <td className="px-3 py-2 text-center text-base-content/60">{r.playerCount}</td>
                    <td className="px-3 py-2 text-right font-semibold text-base-content">{r.score}</td>
                  </tr>
                  {expanded && (
                    <tr className="border-t border-base-300/60 bg-base-200/30">
                      <td colSpan={4} className="px-3 py-2">
                        {r.leaders.length === 0 ? (
                          <p className="text-xs text-base-content/50">No players yet.</p>
                        ) : (
                          <ul className="space-y-1">
                            {r.leaders.map((l, idx) => (
                              <li key={l.user} className="flex items-center justify-between gap-2 text-xs">
                                <span className="flex min-w-0 items-center gap-1">
                                  <span className="w-4 text-base-content/40">{idx + 1}.</span>
                                  <span className="truncate text-base-content/80">{l.username}</span>
                                </span>
                                <span className="font-semibold text-base-content">{l.points}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  )}
                </RowGroup>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
