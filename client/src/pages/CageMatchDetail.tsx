import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  getCageMatchByCode,
  computeCageStandings,
  formatLegTimeControl,
  CATEGORY_LABEL,
  type CageMatch,
} from '../api/cageMatches.js';
import { useAuth } from '../contexts/AuthContext.js';
import { useSocket } from '../contexts/SocketContext.js';
import { useNotify } from '../contexts/NotificationContext.js';

const WINNER_MODE_LABEL: Record<CageMatch['winnerMode'], string> = {
  total_score: 'Total score (win = 1, draw = 0.5)',
  most_categories: 'Most categories won',
  first_to_n: 'First to N wins',
};

const WAGER_MODE_LABEL: Record<CageMatch['wagerMode'], string> = {
  none: 'No wager',
  winner_takes_all: 'Winner takes all',
  per_leg: 'Per leg',
  split_even: 'Split evenly across legs',
};

const LEG_STATUS_DOT: Record<string, string> = {
  pending: 'bg-neutral-700',
  active: 'bg-blue-500',
  paused: 'bg-amber-500',
  finished: 'bg-green-600',
  skipped: 'bg-neutral-800',
};

export function CageMatchDetail() {
  const { code = '' } = useParams<{ code: string }>();
  const { user } = useAuth();
  const socket = useSocket();
  const navigate = useNavigate();
  const { notify } = useNotify();

  const [match, setMatch] = useState<CageMatch | null>(null);
  const [loadError, setLoadError] = useState('');

  const refresh = useCallback(() => {
    getCageMatchByCode(code)
      .then(({ match }) => setMatch(match))
      .catch(() => setLoadError('Cage match not found'));
  }, [code]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!socket || !match) return;

    function onNextLeg(payload: { matchId: string; nextLeg: { joinCode: string } }) {
      if (payload.matchId !== match!._id) return;
      refresh();
      notify(
        'The next leg is starting.',
        [{ label: 'Play it now', onClick: () => navigate(`/game/${payload.nextLeg.joinCode}`) }],
        15_000,
      );
    }
    function onMatchOver(payload: { matchId: string }) {
      if (payload.matchId !== match!._id) return;
      refresh();
    }
    function onPausedOrResumed(payload: { matchId: string }) {
      if (payload.matchId !== match!._id) return;
      refresh();
    }

    socket.on('cage:next_leg', onNextLeg);
    socket.on('cage:match_over', onMatchOver);
    socket.on('cage:paused', onPausedOrResumed);
    socket.on('cage:resumed', onPausedOrResumed);
    return () => {
      socket.off('cage:next_leg', onNextLeg);
      socket.off('cage:match_over', onMatchOver);
      socket.off('cage:paused', onPausedOrResumed);
      socket.off('cage:resumed', onPausedOrResumed);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, match?._id]);

  function handleForfeit() {
    if (!socket || !match) return;
    if (!window.confirm('Forfeit the rest of this cage match? Your opponent will be declared the overall winner.')) {
      return;
    }
    socket.emit('cage:forfeit', { matchId: match._id });
  }

  if (loadError) return <p className="mx-auto mt-10 max-w-lg text-center text-red-400">{loadError}</p>;
  if (!match) return <p className="mx-auto mt-10 max-w-lg text-center text-neutral-400">Loading…</p>;

  const iAmP1 = match.player1._id === user?.id;
  const me = iAmP1 ? match.player1 : match.player2;
  const opponent = iAmP1 ? match.player2 : match.player1;
  const standings = computeCageStandings(match);
  const myScore = iAmP1 ? standings.p1Score : standings.p2Score;
  const oppScore = iAmP1 ? standings.p2Score : standings.p1Score;
  const myCats = iAmP1 ? standings.categoriesWonP1 : standings.categoriesWonP2;
  const oppCats = iAmP1 ? standings.categoriesWonP2 : standings.categoriesWonP1;

  const isParticipant = match.player1._id === user?.id || match.player2._id === user?.id;
  const activeLeg = match.legs.find((l) => l.status === 'active');
  const pausedLeg = match.legs.find((l) => l.status === 'paused');

  let outcomeLine = '';
  if (match.status === 'finished') {
    if (match.matchWinner === 'draw') outcomeLine = 'Match drawn';
    else {
      const winnerIsMe = (match.matchWinner === 'p1' && iAmP1) || (match.matchWinner === 'p2' && !iAmP1);
      const winnerLabel = winnerIsMe ? 'you won' : `${opponent.username} won`;
      if (match.matchEndReason === 'no_show_forfeit') {
        const loserLabel = winnerIsMe ? opponent.username : 'You';
        outcomeLine = `${loserLabel} didn't move in time at the start of a leg — ${winnerLabel} the match`;
      } else if (match.forfeitedBy) {
        outcomeLine = `${match.forfeitedBy === me._id ? 'You' : opponent.username} forfeited — ${winnerLabel}`;
      } else {
        outcomeLine = winnerIsMe ? 'You won the match' : `${opponent.username} won the match`;
      }
    }
  }

  return (
    <div className="mx-auto mt-6 max-w-2xl space-y-4">
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-neutral-100">
            Cage match vs {opponent.username}
          </h1>
          <Link to="/cage" className="text-sm text-neutral-400 hover:text-neutral-200">
            ← All cage matches
          </Link>
        </div>

        <div className="mb-3 flex items-center justify-center gap-6 rounded-md border border-neutral-800 bg-neutral-950 py-4">
          <div className="text-center">
            <p className="text-sm text-neutral-400">You</p>
            <p className="text-2xl font-bold text-neutral-100">{myScore}</p>
          </div>
          <span className="text-neutral-600">–</span>
          <div className="text-center">
            <p className="text-sm text-neutral-400">{opponent.username}</p>
            <p className="text-2xl font-bold text-neutral-100">{oppScore}</p>
          </div>
        </div>

        {match.winnerMode === 'most_categories' && (
          <p className="mb-2 text-center text-sm text-neutral-400">
            Categories won — you: {myCats}, {opponent.username}: {oppCats}
          </p>
        )}
        {match.winnerMode === 'first_to_n' && (
          <p className="mb-2 text-center text-sm text-neutral-400">
            First to {match.targetWins} wins
          </p>
        )}

        {outcomeLine && (
          <p className="mb-2 text-center text-base font-semibold text-amber-300">{outcomeLine}</p>
        )}

        <div className="mb-3 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs text-neutral-500">
          <span>{WINNER_MODE_LABEL[match.winnerMode]}</span>
          <span>·</span>
          <span>
            {WAGER_MODE_LABEL[match.wagerMode]}
            {match.wagerMode !== 'none' ? ` · ${match.wagerTokens} R` : ''}
          </span>
          <span>·</span>
          <span>Leg {Math.min(match.currentLegIndex + 1, match.legs.length)} of {match.legs.length}</span>
        </div>

        {match.status === 'active' && activeLeg?.joinCode && (
          <Link
            to={`/game/${activeLeg.joinCode}`}
            className="mb-2 block w-full rounded-md bg-blue-600 px-3 py-2 text-center text-sm font-semibold text-white hover:bg-blue-500"
          >
            Go to current leg (#{activeLeg.index + 1})
          </Link>
        )}
        {match.status === 'active' && pausedLeg && (
          <Link
            to={`/game/${pausedLeg.joinCode}`}
            className="mb-2 block w-full rounded-md border border-amber-900 bg-amber-950/30 px-3 py-2 text-center text-sm text-amber-300 hover:bg-amber-950/50"
          >
            ⏸ Leg #{pausedLeg.index + 1} is paused — go there to resume
          </Link>
        )}
        {match.status === 'active' && isParticipant && (
          <button
            onClick={handleForfeit}
            className="w-full rounded-md bg-red-900/40 px-3 py-2 text-sm font-semibold text-red-300 hover:bg-red-900/60"
          >
            Forfeit match
          </button>
        )}
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-2 text-sm font-semibold text-neutral-200">Legs</h2>
        <ol className="space-y-1">
          {match.legs.map((leg) => {
            const resultLabel =
              leg.status === 'finished'
                ? leg.result === 'draw'
                  ? 'Draw'
                  : leg.result === 'p1'
                    ? `${match.player1.username} won`
                    : leg.result === 'p2'
                      ? `${match.player2.username} won`
                      : ''
                : leg.status === 'skipped'
                  ? 'Skipped'
                  : leg.status === 'active'
                    ? 'In progress'
                    : leg.status === 'paused'
                      ? 'Paused'
                      : 'Pending';
            return (
              <li
                key={leg.index}
                className="flex items-center justify-between rounded bg-neutral-950 px-3 py-1.5 text-sm"
              >
                <span className="flex items-center gap-2 text-neutral-300">
                  <span className={`inline-block h-2 w-2 rounded-full ${LEG_STATUS_DOT[leg.status]}`} />
                  #{leg.index + 1} · {formatLegTimeControl(leg)} · {CATEGORY_LABEL[leg.category]}
                </span>
                <span className="flex items-center gap-2 text-neutral-500">
                  {resultLabel}
                  {leg.status === 'finished' && leg.joinCode && (
                    <Link to={`/game/${leg.joinCode}`} className="text-blue-400 hover:text-blue-300">
                      Review
                    </Link>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
