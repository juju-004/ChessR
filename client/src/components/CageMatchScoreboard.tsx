import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSocket } from '../contexts/SocketContext.js';
import { getCageMatchByCode, computeCageStandings, type CageMatch, type CageLeg } from '../api/cageMatches.js';

interface Props {
  cageMatchId: string;
  legIndex: number;
}

const PIP_COLOR: Record<CageLeg['status'], string> = {
  finished: 'bg-base-300',
  active: 'bg-blue-500',
  paused: 'bg-amber-500',
  pending: 'bg-base-300',
  skipped: 'bg-base-200',
};

function pipTitle(leg: CageLeg, p1Name: string, p2Name: string): string {
  if (leg.status === 'active') return `Leg ${leg.index + 1} — in progress`;
  if (leg.status === 'paused') return `Leg ${leg.index + 1} — paused`;
  if (leg.status === 'skipped') return `Leg ${leg.index + 1} — skipped`;
  if (leg.status === 'pending') return `Leg ${leg.index + 1} — not yet played`;
  if (leg.result === 'draw') return `Leg ${leg.index + 1} — draw`;
  if (leg.result === 'p1') return `Leg ${leg.index + 1} — ${p1Name} won`;
  if (leg.result === 'p2') return `Leg ${leg.index + 1} — ${p2Name} won`;
  return `Leg ${leg.index + 1}`;
}

/** A compact "where are we in this series" scoreboard shown on a leg's game
 *  page — for players AND spectators who land on a leg midway through a cage
 *  match and need the score and remaining-games context at a glance, without
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
        /* Scoreboard is a nice-to-have — a fetch failure just means we
           don't show it, no need to surface an error on the game page. */
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
    socket.on('cage:paused', refresh);
    socket.on('cage:resumed', refresh);
    return () => {
      socket.off('cage:next_leg', refresh);
      socket.off('cage:match_over', refresh);
      socket.off('cage:paused', refresh);
      socket.off('cage:resumed', refresh);
    };
  }, [socket, cageMatchId]);

  if (!match) return null;

  const standings = computeCageStandings(match);
  const totalLegs = match.legs.length;
  const legsLeft = match.legs.filter(
    (l) => l.status === 'pending' || l.status === 'active' || l.status === 'paused',
  ).length;
  const p1Name = match.player1.username;
  const p2Name = match.player2.username;

  return (
    <div className="mb-3 rounded-xl border border-(--secondary)/30 bg-(--secondary)/10 px-3 py-2.5">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold text-base-content">
          <span className={standings.p1Score >= standings.p2Score ? 'text-base-content' : 'text-base-content/50'}>
            {p1Name} {standings.p1Score}
          </span>
          <span className="mx-1.5 text-(--secondary)">–</span>
          <span className={standings.p2Score >= standings.p1Score ? 'text-base-content' : 'text-base-content/50'}>
            {standings.p2Score} {p2Name}
          </span>
        </div>
        <Link to={`/cage/${match.matchCode}`} className="text-xs font-medium text-(--secondary) hover:brightness-110">
          Full match →
        </Link>
      </div>

      <div className="mt-2 flex items-center gap-1">
        {match.legs.map((leg) => (
          <span
            key={leg.index}
            title={pipTitle(leg, p1Name, p2Name)}
            className={`h-1.5 flex-1 rounded-full ${PIP_COLOR[leg.status]} ${
              leg.index === legIndex ? 'ring-2 ring-(--primary) ring-offset-1 ring-offset-base-200' : ''
            }`}
          />
        ))}
      </div>

      <div className="mt-1.5 flex items-center justify-between text-xs text-base-content/50">
        <span>
          Leg {legIndex + 1} of {totalLegs}
        </span>
        <span>{legsLeft} to play</span>
      </div>
    </div>
  );
}
