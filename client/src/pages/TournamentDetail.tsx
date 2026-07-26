import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  getTournamentByCode,
  rankTournamentPlayers,
  usernameOf,
  formatTimeControl,
  FORMAT_LABEL,
  type Tournament,
  type TournamentPairing,
} from '../api/tournaments.js';
import { useSocket } from '../contexts/SocketContext.js';
import { useAuth } from '../contexts/AuthContext.js';

function PairingRow({ tournament, pairing, myId }: { tournament: Tournament; pairing: TournamentPairing; myId?: string }) {
  const p1Name = usernameOf(tournament, pairing.player1);
  const p2Name = usernameOf(tournament, pairing.player2);
  const involvesMe = pairing.player1 === myId || pairing.player2 === myId;

  let outcome = '·';
  if (pairing.status === 'finished') {
    if (pairing.player2 === null) outcome = 'Bye';
    else if (pairing.result === 'draw') outcome = 'Draw';
    else if (pairing.result === 'p1') outcome = `${p1Name} won`;
    else outcome = `${p2Name} won`;
  } else if (pairing.status === 'active') {
    outcome = 'In progress';
  }

  return (
    <div
      className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${
        involvesMe ? 'border-amber-800 bg-amber-950/20' : 'border-neutral-800 bg-neutral-950'
      }`}
    >
      <span className="text-neutral-200">
        {p1Name}
        {pairing.berserk.p1 && ' ⚔'} {pairing.player2 && <>vs {p2Name}{pairing.berserk.p2 && ' ⚔'}</>}
      </span>
      <span className="flex items-center gap-2">
        <span className="text-neutral-500">{outcome}</span>
        {pairing.status === 'active' && pairing.joinCode && (
          <Link to={`/game/${pairing.joinCode}`} className="rounded bg-neutral-800 px-2 py-0.5 text-xs text-amber-300 hover:bg-neutral-700">
            {involvesMe ? 'Play' : 'Watch'}
          </Link>
        )}
      </span>
    </div>
  );
}

export function TournamentDetail() {
  const { code = '' } = useParams<{ code: string }>();
  const socket = useSocket();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<{ message: string; isError: boolean } | null>(null);

  const refresh = useCallback(() => {
    getTournamentByCode(code)
      .then((res) => setTournament(res.tournament))
      .catch(() => setError('Tournament not found'));
  }, [code]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!socket || !tournament) return;
    socket.emit('tournament:watch', { tournamentId: tournament._id });
    function onUpdate(payload: { code: string }) {
      if (payload.code === code) refresh();
    }
    function onError(payload: { message: string }) {
      setStatus({ message: payload.message, isError: true });
    }
    socket.on('tournament:update', onUpdate);
    socket.on('tournament:started', onUpdate);
    socket.on('tournament:cancelled', onUpdate);
    socket.on('tournament:finished', onUpdate);
    socket.on('tournament:error', onError);
    return () => {
      socket.off('tournament:update', onUpdate);
      socket.off('tournament:started', onUpdate);
      socket.off('tournament:cancelled', onUpdate);
      socket.off('tournament:finished', onUpdate);
      socket.off('tournament:error', onError);
    };
    // Re-subscribe once the tournament's Mongo _id is known.
  }, [socket, tournament?._id, code, refresh]);

  if (error) return <p className="mt-6 text-center text-red-400">{error}</p>;
  if (!tournament) return <p className="mt-6 text-center text-neutral-400">Loading…</p>;

  const myId = user?.id;
  const isPlayer = !!myId && tournament.players.some((p) => p.user === myId);
  const isCreator = tournament.createdBy === myId;
  const isPointsFormat = tournament.format !== 'normal';
  const standings = isPointsFormat ? rankTournamentPlayers(tournament) : [];
  const currentRound = tournament.rounds[tournament.currentRoundIndex];

  function join() {
    socket?.emit('tournament:join', { tournamentId: tournament!._id });
  }
  function leave() {
    socket?.emit('tournament:leave', { tournamentId: tournament!._id });
  }
  function cancel() {
    if (confirm('Cancel this tournament and refund everyone?')) {
      socket?.emit('tournament:cancel', { tournamentId: tournament!._id });
    }
  }
  function start() {
    socket?.emit('tournament:start', { tournamentId: tournament!._id });
  }
  function withdraw() {
    if (confirm("Withdraw from the tournament? Any game you're currently playing will count as a loss.")) {
      socket?.emit('tournament:withdraw', { tournamentId: tournament!._id });
    }
  }

  return (
    <div className="mx-auto mt-6 max-w-3xl space-y-4">
      <button onClick={() => navigate('/tournaments')} className="text-sm text-neutral-500 hover:text-neutral-300">
        ← All tournaments
      </button>

      {status && <p className={`text-sm ${status.isError ? 'text-red-400' : 'text-green-400'}`}>{status.message}</p>}

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <div className="mb-2 flex items-center justify-between">
          <h1 className="text-lg font-semibold text-neutral-100">{tournament.name}</h1>
          <span className="text-xs text-neutral-500">#{tournament.code}</span>
        </div>
        <p className="mb-4 text-sm text-neutral-400">
          {FORMAT_LABEL[tournament.format]} · {formatTimeControl(tournament)} · {tournament.players.length}/
          {tournament.maxPlayers} players
          {tournament.format === 'swiss' && <> · {tournament.swissRounds} rounds</>}
          {tournament.wagerMode === 'entry_fee' && (
            <>
              {' '}
              · {tournament.wagerTokens} R entry · pool {tournament.prizePoolTokens} R
            </>
          )}
          {tournament.berserkAllowed && <> · Berserk allowed ⚔</>}
        </p>

        {tournament.status === 'pending' && (
          <div className="flex flex-wrap gap-2">
            {!isPlayer && (
              <button onClick={join} className="rounded-md bg-amber-700 px-3 py-1.5 text-sm font-semibold text-neutral-950 hover:bg-amber-600">
                Join
              </button>
            )}
            {isPlayer && !isCreator && (
              <button onClick={leave} className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm text-neutral-300 hover:bg-neutral-700">
                Leave
              </button>
            )}
            {isCreator && (
              <>
                <button
                  onClick={start}
                  disabled={tournament.players.length < tournament.minPlayers}
                  className="rounded-md bg-green-800 px-3 py-1.5 text-sm font-semibold text-green-100 hover:bg-green-700 disabled:opacity-40"
                >
                  Start ({tournament.players.length}/{tournament.minPlayers} min)
                </button>
                <button onClick={cancel} className="rounded-md bg-red-900/40 px-3 py-1.5 text-sm text-red-300 hover:bg-red-900/60">
                  Cancel
                </button>
              </>
            )}
          </div>
        )}

        {tournament.status === 'active' && isPlayer && (
          <button onClick={withdraw} className="rounded-md bg-red-900/40 px-3 py-1.5 text-sm text-red-300 hover:bg-red-900/60">
            Withdraw
          </button>
        )}

        {tournament.status === 'finished' && (
          <p className="text-sm text-green-400">
            🏆 {usernameOf(tournament, tournament.winner)} won
            {tournament.runnerUp && <> · runner-up {usernameOf(tournament, tournament.runnerUp)}</>}
          </p>
        )}
        {tournament.status === 'cancelled' && <p className="text-sm text-red-400">This tournament was cancelled.</p>}
      </div>

      {tournament.status === 'pending' && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="mb-2 text-sm font-semibold text-neutral-200">Players ({tournament.players.length})</h2>
          <div className="flex flex-wrap gap-2">
            {tournament.players.map((p) => (
              <span key={p.user} className="rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-200">
                {p.username}
                {p.user === tournament.createdBy && <span className="ml-1 text-amber-400">★</span>}
              </span>
            ))}
          </div>
        </div>
      )}

      {isPointsFormat && standings.length > 0 && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="mb-2 text-sm font-semibold text-neutral-200">Standings</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-neutral-500">
                <th className="pb-1">#</th>
                <th className="pb-1">Player</th>
                <th className="pb-1 text-right">Pts</th>
                <th className="pb-1 text-right">Games</th>
                <th className="pb-1 text-right">⚔ wins</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((p, i) => (
                <tr key={p.user} className={p.user === myId ? 'text-amber-300' : 'text-neutral-200'}>
                  <td className="py-0.5">{i + 1}</td>
                  <td className="py-0.5">{p.username}</td>
                  <td className="py-0.5 text-right">{p.points}</td>
                  <td className="py-0.5 text-right">{p.gamesPlayed}</td>
                  <td className="py-0.5 text-right">{p.berserkWins}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tournament.rounds.length > 0 && (
        <div className="space-y-3">
          {[...tournament.rounds].reverse().map((round) => (
            <div key={round.index} className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
              <h2 className="mb-2 text-sm font-semibold text-neutral-200">
                {tournament.format === 'normal' ? `Round ${round.index + 1}` : `Round ${round.index + 1}`}
                {round.index === currentRound?.index && round.status === 'active' && (
                  <span className="ml-2 rounded bg-green-900/40 px-2 py-0.5 text-xs text-green-300">current</span>
                )}
              </h2>
              <div className="space-y-1.5">
                {round.pairings.map((pairing) => (
                  <PairingRow key={pairing.index} tournament={tournament} pairing={pairing} myId={myId} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
