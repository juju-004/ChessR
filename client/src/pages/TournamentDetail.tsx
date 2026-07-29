import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Trophy } from 'lucide-react';
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
import { Page, Card, CardHeader, CardTitle, Button, Badge, Spinner } from '../components/ui/index.js';

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
      className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm ${
        involvesMe ? 'border-(--secondary)/40 bg-(--secondary)/10' : 'border-base-300 bg-base-100/60'
      }`}
    >
      <span className="text-base-content">
        {p1Name}
        {pairing.berserk.p1 && ' ⚔'} {pairing.player2 && (
          <>
            vs {p2Name}
            {pairing.berserk.p2 && ' ⚔'}
          </>
        )}
      </span>
      <span className="flex items-center gap-2">
        <span className="text-base-content/50">{outcome}</span>
        {pairing.status === 'active' && pairing.joinCode && (
          <Link to={`/game/${pairing.joinCode}`}>
            <Badge variant="warning" className="hover:brightness-110">
              {involvesMe ? 'Play' : 'Watch'}
            </Badge>
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

  if (error) {
    return (
      <div className="mx-auto mt-6 max-w-lg px-4">
        <Card variant="solid" className="border-red-900/50 bg-red-950/20 text-center text-red-300">
          {error}
        </Card>
      </div>
    );
  }
  if (!tournament) {
    return (
      <div className="flex justify-center pt-16">
        <Spinner className="text-base-content/40" />
      </div>
    );
  }

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
    <Page title={tournament.name} back="/tournaments" actions={<span className="text-xs text-base-content/40">#{tournament.code}</span>}>
      <div className="mx-auto max-w-3xl space-y-4">
        {status && (
          <p className={`text-sm ${status.isError ? 'text-red-400' : 'text-green-400'}`}>{status.message}</p>
        )}

        <Card variant="solid">
          <p className="mb-4 text-sm text-base-content/60">
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
                <Button variant="secondary" size="sm" onClick={join}>
                  Join
                </Button>
              )}
              {isPlayer && !isCreator && (
                <Button variant="glass" size="sm" onClick={leave}>
                  Leave
                </Button>
              )}
              {isCreator && (
                <>
                  <Button
                    size="sm"
                    disabled={tournament.players.length < tournament.minPlayers}
                    onClick={start}
                    className="bg-green-700 shadow-green-700/25 hover:bg-green-600 hover:brightness-100"
                  >
                    Start ({tournament.players.length}/{tournament.minPlayers} min)
                  </Button>
                  <Button variant="danger" size="sm" onClick={cancel}>
                    Cancel
                  </Button>
                </>
              )}
            </div>
          )}

          {tournament.status === 'active' && isPlayer && (
            <Button variant="danger" size="sm" onClick={withdraw}>
              Withdraw
            </Button>
          )}

          {tournament.status === 'finished' && (
            <p className="flex items-center gap-1.5 text-sm font-medium text-green-400">
              <Trophy className="h-4 w-4" /> {usernameOf(tournament, tournament.winner)} won
              {tournament.runnerUp && <> · runner-up {usernameOf(tournament, tournament.runnerUp)}</>}
            </p>
          )}
          {tournament.status === 'cancelled' && (
            <p className="text-sm text-red-400">This tournament was cancelled.</p>
          )}
        </Card>

        {tournament.status === 'pending' && (
          <Card variant="solid">
            <CardHeader>
              <CardTitle>Players ({tournament.players.length})</CardTitle>
            </CardHeader>
            <div className="flex flex-wrap gap-2">
              {tournament.players.map((p) => (
                <Badge key={p.user} variant="neutral">
                  {p.username}
                  {p.user === tournament.createdBy && <span className="text-amber-400">★</span>}
                </Badge>
              ))}
            </div>
          </Card>
        )}

        {isPointsFormat && standings.length > 0 && (
          <Card variant="solid">
            <CardHeader>
              <CardTitle>Standings</CardTitle>
            </CardHeader>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-base-content/50">
                  <th className="pb-1">#</th>
                  <th className="pb-1">Player</th>
                  <th className="pb-1 text-right">Pts</th>
                  <th className="pb-1 text-right">Games</th>
                  <th className="pb-1 text-right">⚔ wins</th>
                </tr>
              </thead>
              <tbody>
                {standings.map((p, i) => (
                  <tr key={p.user} className={p.user === myId ? 'font-semibold text-(--secondary)' : 'text-base-content'}>
                    <td className="py-1">{i + 1}</td>
                    <td className="py-1">{p.username}</td>
                    <td className="py-1 text-right">{p.points}</td>
                    <td className="py-1 text-right">{p.gamesPlayed}</td>
                    <td className="py-1 text-right">{p.berserkWins}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {tournament.rounds.length > 0 && (
          <div className="space-y-3">
            {[...tournament.rounds].reverse().map((round) => (
              <Card variant="solid" key={round.index}>
                <CardHeader>
                  <CardTitle>
                    Round {round.index + 1}
                    {round.index === currentRound?.index && round.status === 'active' && (
                      <Badge variant="success" className="ml-2">
                        current
                      </Badge>
                    )}
                  </CardTitle>
                </CardHeader>
                <div className="space-y-1.5">
                  {round.pairings.map((pairing) => (
                    <PairingRow key={pairing.index} tournament={tournament} pairing={pairing} myId={myId} />
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </Page>
  );
}
