import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Trophy, Clock, Share2, Lock, Trash2 } from 'lucide-react';
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
import { useNotify } from '../contexts/NotificationContext.js';
import { copyToClipboard } from '@/lib/utils.js';
import { Page, Card, CardHeader, CardTitle, Button, Badge, Spinner, Input } from '../components/ui/index.js';

const CLIENT_URL = import.meta.env.VITE_CLIENT_URL ?? 'http://localhost:5173';

function ordinalSuffix(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return 'th';
  switch (n % 10) {
    case 1:
      return 'st';
    case 2:
      return 'nd';
    case 3:
      return 'rd';
    default:
      return 'th';
  }
}

/** Live "next round starts in Ns" countdown, shown while the tournament is
 *  sitting in its inter-round break (see scheduleRoundStart in
 *  tournament.service.ts — nextRoundStartsAt is only ever set during that
 *  window). Ticks locally rather than waiting on the server; the round
 *  activating for real sends its own tournament:update/tournament:pairing_ready
 *  events, so this never needs to do anything beyond just counting down. */
function BreakCountdown({ nextRoundStartsAt }: { nextRoundStartsAt: string }) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => forceTick((n) => n + 1), 500);
    return () => window.clearInterval(interval);
  }, []);

  const remainingMs = new Date(nextRoundStartsAt).getTime() - Date.now();

  return (
    <Card variant="solid" className="border-(--secondary)/30 bg-(--secondary)/10">
      <p className="flex items-center justify-center gap-1.5 text-center text-sm font-medium text-base-content">
        <Clock className="h-4 w-4 text-(--secondary)" />
        {remainingMs > 0 ? `Next round starts in ${Math.ceil(remainingMs / 1000)}s` : 'Starting the next round…'}
      </p>
    </Card>
  );
}

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
  const { notify, dismiss } = useNotify();
  const navigate = useNavigate();
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<{ message: string; isError: boolean } | null>(null);
  const [joinPassword, setJoinPassword] = useState('');

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
    function onDeleted(payload: { code: string }) {
      if (payload.code !== code) return;
      setStatus({ message: 'This tournament was deleted by its organizer.', isError: true });
      setTimeout(() => navigate('/tournaments'), 1500);
    }
    socket.on('tournament:update', onUpdate);
    socket.on('tournament:started', onUpdate);
    socket.on('tournament:cancelled', onUpdate);
    socket.on('tournament:finished', onUpdate);
    socket.on('tournament:deleted', onDeleted);
    socket.on('tournament:error', onError);
    return () => {
      socket.off('tournament:update', onUpdate);
      socket.off('tournament:started', onUpdate);
      socket.off('tournament:cancelled', onUpdate);
      socket.off('tournament:finished', onUpdate);
      socket.off('tournament:deleted', onDeleted);
      socket.off('tournament:error', onError);
    };
    // Re-subscribe once the tournament's Mongo _id is known.
  }, [socket, tournament?._id, code, refresh, navigate]);

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
    // Once you're a player, the server already knows it — the password is
    // only ever asked for here, at join time, never again on return visits.
    socket?.emit('tournament:join', { tournamentId: tournament!._id, password: joinPassword || undefined });
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
  function handleDeleteTournament() {
    if (confirm('Delete this tournament? Everyone will be refunded and this cannot be undone.')) {
      socket?.emit('tournament:delete', { tournamentId: tournament!._id });
    }
  }
  function handleShare() {
    copyToClipboard(`${CLIENT_URL}/tournaments/${tournament!.code}`);
    const n = notify('Copied tournament link');
    setTimeout(() => dismiss(n), 2000);
  }

  return (
    <Page
      title={tournament.name}
      back="/tournaments"
      actions={
        <div className="flex items-center gap-2">
          <span className="text-xs text-base-content/40">#{tournament.code}</span>
          <Button variant="glass" size="sm" onClick={handleShare}>
            <Share2 className="h-3.5 w-3.5" /> Share
          </Button>
        </div>
      }
    >
      <div className="mx-auto max-w-3xl space-y-4">
        {status && (
          <p className={`text-sm ${status.isError ? 'text-red-400' : 'text-green-400'}`}>{status.message}</p>
        )}

        <Card variant="solid">
          <p className="mb-4 text-sm text-base-content/60">
            {FORMAT_LABEL[tournament.format]} · {formatTimeControl(tournament)} · {tournament.players.length}/
            {tournament.maxPlayers} players
            {tournament.format === 'swiss' && <> · {tournament.swissRounds} rounds</>}
            {tournament.regFeeTokens > 0 && <> · {tournament.regFeeTokens} R to join</>}
            {tournament.prizePoolTokens > 0 && <> · {tournament.prizePoolTokens} R prize pool</>}
            {tournament.berserkAllowed && <> · Berserk allowed ⚔</>}
            {tournament.hasPassword && (
              <>
                {' '}
                · <Lock className="inline h-3 w-3 align-[-1px]" /> Password protected
              </>
            )}
          </p>

          {tournament.status === 'pending' && (
            <div className="space-y-3">
              {tournament.scheduledStartAt && (
                <p className="flex items-center gap-1.5 text-xs text-base-content/50">
                  <Clock className="h-3.5 w-3.5" />
                  Starts automatically {new Date(tournament.scheduledStartAt).toLocaleString()}
                </p>
              )}
              <div className="flex flex-wrap items-end gap-2">
                {!isPlayer && (
                  <>
                    {tournament.hasPassword && (
                      <div className="w-40">
                        <Input
                          type="password"
                          placeholder="Password"
                          value={joinPassword}
                          onChange={(e) => setJoinPassword(e.target.value)}
                        />
                      </div>
                    )}
                    <Button variant="secondary" size="sm" onClick={join}>
                      Join
                    </Button>
                  </>
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
                      Start now ({tournament.players.length}/{tournament.minPlayers} min)
                    </Button>
                    <Button variant="danger" size="sm" onClick={cancel}>
                      Cancel
                    </Button>
                    <Button variant="glass" size="sm" onClick={handleDeleteTournament} className="text-red-400">
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </Button>
                  </>
                )}
              </div>
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

        {tournament.prizeSchedule.length > 0 && (
          <Card variant="solid">
            <CardHeader>
              <CardTitle>Prize pool — {tournament.prizePoolTokens} R</CardTitle>
            </CardHeader>
            <div className="space-y-1 text-sm text-base-content/70">
              {tournament.prizeSchedule.map((tier, i) => (
                <div key={i} className="flex justify-between">
                  <span>{tier.fromRank === tier.toRank ? `${tier.fromRank}${ordinalSuffix(tier.fromRank)} place` : `${tier.fromRank}${ordinalSuffix(tier.fromRank)}–${tier.toRank}${ordinalSuffix(tier.toRank)} place`}</span>
                  <span className="font-medium text-base-content">{tier.tokens} R each</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {tournament.status === 'active' && tournament.nextRoundStartsAt && (
          <BreakCountdown nextRoundStartsAt={tournament.nextRoundStartsAt} />
        )}

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
