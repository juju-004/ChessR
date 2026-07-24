import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSocket } from '../contexts/SocketContext.js';
import { getCageMatchByCode, computeCageStandings, type CageMatch } from '../api/cageMatches.js';

interface Props {
  cageMatchId: string;
  legIndex: number;
}

/** A compact "where are we in this series" strip shown on a leg's game page —
 *  for players AND spectators who land on a leg midway through a cage match
 *  and need the score and remaining-games context at a glance, without
 *  clicking through to the full match page. */
export function CageMatchScoreboard({ cageMatchId, legIndex }: Props) {
  const socket = useSocket();
  const [match, setMatch] = useState<CageMatch | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCageMatchByCode(cageMatchId)
      .then(({ match }) => {
        if (!cancelled) setMatch(match);
      })
      .catch(() => {
        /* Scoreboard is a nice-to-have — a fetch failure just means we don't
           show it, no need to surface an error on the game page itself. */
      });
    return () => {
      cancelled = true;
    };
  }, [cageMatchId]);

  useEffect(() => {
    if (!socket) return;
    function refresh(payload: { matchId: string }) {
      if (payload.matchId !== cageMatchId) return;
      getCageMatchByCode(cageMatchId)
        .then(({ match }) => setMatch(match))
        .catch(() => {});
    }
    socket.on('cage:next_leg', refresh);
    socket.on('cage:match_over', refresh);
    return () => {
      socket.off('cage:next_leg', refresh);
      socket.off('cage:match_over', refresh);
    };
  }, [socket, cageMatchId]);

  if (!match) return null;

  const standings = computeCageStandings(match);
  const totalLegs = match.legs.length;
  const legsLeft = match.legs.filter((l) => l.status === 'pending' || l.status === 'active').length;

  return (
    <Link
      to={`/cage/${match.matchCode}`}
      className="mb-3 block rounded-md border border-purple-900 bg-purple-950/30 px-3 py-2 hover:bg-purple-950/50"
    >
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-purple-200">
          {match.player1.username} <span className="text-purple-300">{standings.p1Score}</span>
          <span className="mx-1 text-purple-500">–</span>
          <span className="text-purple-300">{standings.p2Score}</span> {match.player2.username}
        </span>
        <span className="text-purple-400">
          Leg {legIndex + 1}/{totalLegs} · {legsLeft} left
        </span>
      </div>
    </Link>
  );
}
