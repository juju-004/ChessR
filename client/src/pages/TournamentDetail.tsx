import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Trophy, Clock, Share2, Lock, Pencil, Plus, X } from 'lucide-react';
import {
  getTournamentByCode,
  rankTournamentPlayers,
  usernameOf,
  gradientOf,
  formatTimeControl,
  totalPrizePool,
  tokensLabel,
  FORMAT_LABEL,
  type Tournament,
  type TournamentPairing,
  type TournamentPlayer,
  type TournamentFormat,
  type TournamentPrizeTier,
} from '../api/tournaments.js';
import { useSocket } from '../contexts/SocketContext.js';
import { useAuth } from '../contexts/AuthContext.js';
import { useNotify } from '../contexts/NotificationContext.js';
import { copyToClipboard } from '@/lib/utils.js';
import { Page, Card, CardHeader, CardTitle, Button, Badge, Spinner, Input, Select, Switch, Avatar, Tabs, Popover, Modal } from '../components/ui/index.js';

const CLIENT_URL = import.meta.env.VITE_CLIENT_URL ?? 'http://localhost:5173';

// datetime-local wants local time with no seconds/timezone.
function toDatetimeLocal(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date(Date.now() + 5 * 60 * 1000);
  d.setSeconds(0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function EditTournamentForm({
  tournament,
  onSaved,
  onCancel,
}: {
  tournament: Tournament;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const socket = useSocket();
  const [name, setName] = useState(tournament.name);
  const [format, setFormat] = useState<TournamentFormat>(tournament.format);
  const [variant, setVariant] = useState<'standard' | 'chess960'>(tournament.variant);
  const [baseMinutes, setBaseMinutes] = useState<string>(
    tournament.baseMinutes === null ? '' : String(tournament.baseMinutes),
  );
  const [incrementSeconds, setIncrementSeconds] = useState(tournament.incrementSeconds);
  const [maxPlayers, setMaxPlayers] = useState(tournament.maxPlayers);
  const [swissRounds, setSwissRounds] = useState(tournament.swissRounds ?? 5);
  const [breakSeconds, setBreakSeconds] = useState(tournament.breakSeconds);
  const [berserkAllowed, setBerserkAllowed] = useState(tournament.berserkAllowed);
  const [isPublic, setIsPublic] = useState(tournament.isPublic);
  const [regFeeInput, setRegFeeInput] = useState(String(tournament.regFeeTokens));
  const [prizeTiers, setPrizeTiers] = useState<TournamentPrizeTier[]>(tournament.prizeSchedule);
  const [password, setPassword] = useState('');
  const [removePassword, setRemovePassword] = useState(false);
  const [startInput, setStartInput] = useState(() => toDatetimeLocal(tournament.scheduledStartAt));
  const [error, setError] = useState('');

  function addPrizeTier() {
    const nextRank = (prizeTiers[prizeTiers.length - 1]?.toRank ?? 0) + 1;
    setPrizeTiers([...prizeTiers, { fromRank: nextRank, toRank: nextRank, tokens: 0 }]);
  }
  function updatePrizeTier(i: number, patch: Partial<TournamentPrizeTier>) {
    setPrizeTiers(prizeTiers.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }
  function removePrizeTier(i: number) {
    setPrizeTiers(prizeTiers.filter((_, idx) => idx !== i));
  }

  function save() {
    if (!socket) return;
    if (name.trim().length < 3) return setError('Give it a name (3+ characters).');
    const scheduledStartAt = new Date(startInput);
    if (Number.isNaN(scheduledStartAt.getTime()) || scheduledStartAt.getTime() < Date.now() + 5000) {
      return setError('Pick a start time a bit further in the future.');
    }
    for (const tier of prizeTiers) {
      if (tier.toRank > maxPlayers) {
        return setError(`Prize schedule can't cover a rank beyond your ${maxPlayers}-player cap.`);
      }
    }
    socket.emit('tournament:edit', {
      tournamentId: tournament._id,
      name: name.trim(),
      format,
      variant,
      baseMinutes: baseMinutes.trim() === '' ? null : Number(baseMinutes),
      incrementSeconds,
      maxPlayers,
      berserkAllowed,
      isPublic,
      prizeSchedule: prizeTiers,
      regFeeTokens: Math.max(0, Math.floor(Number(regFeeInput) || 0)),
      swissRounds: format === 'swiss' ? swissRounds : null,
      breakSeconds,
      scheduledStartAt: scheduledStartAt.toISOString(),
      password: removePassword ? null : password.trim() || undefined,
    });
    onSaved();
  }

  return (
    <Card variant="solid" className="space-y-4 border-(--secondary)/30">
      <CardHeader>
        <CardTitle>Edit tournament</CardTitle>
      </CardHeader>
      {error && <p className="text-sm text-red-400">{error}</p>}

      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />

      <div className="flex flex-wrap gap-3">
        <div className="w-40">
          <Select label="Format" value={format} onChange={(e) => setFormat(e.target.value as TournamentFormat)}>
            {(Object.keys(FORMAT_LABEL) as TournamentFormat[]).map((f) => (
              <option key={f} value={f}>
                {FORMAT_LABEL[f]}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-32">
          <Select label="Variant" value={variant} onChange={(e) => setVariant(e.target.value as 'standard' | 'chess960')}>
            <option value="standard">Standard</option>
            <option value="chess960">Chess960</option>
          </Select>
        </div>
        <div className="w-28">
          <Input
            label="Base mins (blank = unlimited)"
            type="number"
            min={1}
            max={180}
            value={baseMinutes}
            onChange={(e) => setBaseMinutes(e.target.value)}
          />
        </div>
        <div className="w-28">
          <Input
            label="Increment"
            type="number"
            min={0}
            max={60}
            value={incrementSeconds}
            onChange={(e) => setIncrementSeconds(Number(e.target.value))}
          />
        </div>
        <div className="w-28">
          <Input
            label="Max players"
            type="number"
            min={2}
            max={64}
            value={maxPlayers}
            onChange={(e) => setMaxPlayers(Number(e.target.value))}
          />
        </div>
        {format === 'swiss' && (
          <div className="w-24">
            <Input
              label="Rounds"
              type="number"
              min={3}
              max={15}
              value={swissRounds}
              onChange={(e) => setSwissRounds(Number(e.target.value))}
            />
          </div>
        )}
        <div className="w-28">
          <Input
            label="Break (secs)"
            type="number"
            min={0}
            max={300}
            value={breakSeconds}
            onChange={(e) => setBreakSeconds(Number(e.target.value))}
          />
        </div>
      </div>

      <Switch checked={berserkAllowed} onChange={setBerserkAllowed} label="Allow berserking" />
      <Switch checked={isPublic} onChange={setIsPublic} label="List publicly" />

      <div className="space-y-2 border-t border-base-300 pt-3">
        <Input label="Start time" type="datetime-local" value={startInput} onChange={(e) => setStartInput(e.target.value)} />
      </div>

      <div className="space-y-2 border-t border-base-300 pt-3">
        {tournament.hasPassword && !removePassword ? (
          <div className="flex items-center justify-between">
            <p className="text-xs text-base-content/50">A password is currently set.</p>
            <Button size="sm" variant="glass" onClick={() => setRemovePassword(true)}>
              Remove password
            </Button>
          </div>
        ) : (
          <Input
            label={tournament.hasPassword ? 'New password' : 'Password (optional)'}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setRemovePassword(false);
            }}
            placeholder="Leave blank for no password"
          />
        )}
      </div>

      <div className="space-y-2 border-t border-base-300 pt-3">
        <Input
          label="Registration fee — R Coins"
          type="number"
          min={0}
          value={regFeeInput}
          onChange={(e) => setRegFeeInput(e.target.value)}
        />
        <p className="text-xs text-base-content/50">
          Since you're still the only player, changing this just adjusts what you've already paid in.
        </p>
      </div>

      <div className="space-y-2 border-t border-base-300 pt-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-base-content/80">Prize pool</label>
          {totalPrizePool(prizeTiers) > 0 && (
            <span className="text-xs text-base-content/50">{totalPrizePool(prizeTiers)} R total</span>
          )}
        </div>
        <p className="text-xs text-base-content/50">
          Increasing this debits the difference from you now; decreasing it refunds the difference.
        </p>
        {prizeTiers.map((tier, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-base-content/50">Rank</span>
            <div className="w-16">
              <Input type="number" min={1} value={tier.fromRank} onChange={(e) => updatePrizeTier(i, { fromRank: Number(e.target.value) })} />
            </div>
            <span className="text-xs text-base-content/50">to</span>
            <div className="w-16">
              <Input type="number" min={1} value={tier.toRank} onChange={(e) => updatePrizeTier(i, { toRank: Number(e.target.value) })} />
            </div>
            <span className="text-xs text-base-content/50">gets</span>
            <div className="w-24">
              <Input type="number" min={0} value={tier.tokens} onChange={(e) => updatePrizeTier(i, { tokens: Number(e.target.value) })} />
            </div>
            <span className="text-xs text-base-content/50">{tokensLabel(tier)}</span>
            <button onClick={() => removePrizeTier(i)} aria-label="Remove prize tier" className="ml-auto rounded-md p-1 text-red-400 hover:bg-red-900/30">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
        <Button size="sm" variant="secondary" onClick={addPrizeTier}>
          <Plus className="h-4 w-4" /> Add prize tier
        </Button>
      </div>

      <div className="flex gap-2 pt-2">
        <Button variant="secondary" onClick={save}>
          Save changes
        </Button>
        <Button variant="glass" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}

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

/** Formats a millisecond duration as HH:MM:SS (always all three segments,
 *  even for a countdown under an hour — easier to scan at a glance than a
 *  segment count that changes shape as it ticks down). Clamps negative
 *  input to zero rather than showing a negative countdown. */
function formatHms(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** Live HH:MM:SS countdown to a tournament's scheduled auto-start, shown
 *  while it's still pending. Purely a display timer — the actual starting
 *  happens server-side (see scheduleAutoStart in tournament.service.ts);
 *  this just counts down to the same timestamp the server is watching. */
function StartCountdown({ scheduledStartAt }: { scheduledStartAt: string }) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => forceTick((n) => n + 1), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const remainingMs = new Date(scheduledStartAt).getTime() - Date.now();

  return (
    <p className="flex items-center gap-1.5 text-xs text-base-content/50">
      <Clock className="h-3.5 w-3.5" />
      {remainingMs > 0 ? (
        <>
          Starts in <span className="font-mono text-base-content">{formatHms(remainingMs)}</span> (
          {new Date(scheduledStartAt).toLocaleString()})
        </>
      ) : (
        'Starting…'
      )}
    </p>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-base-200/60 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-base-content/40">{label}</p>
      <p className="font-semibold text-base-content">{value}</p>
    </div>
  );
}

/** Every pairing a given player was part of, across every round, in the
 *  order the rounds were played — the raw material for their round-by-round
 *  line in PlayerTournamentDetails. */
function pairingsForPlayer(
  tournament: Tournament,
  userId: string,
): { roundIndex: number; pairing: TournamentPairing; isP1: boolean }[] {
  const records: { roundIndex: number; pairing: TournamentPairing; isP1: boolean }[] = [];
  for (const round of tournament.rounds) {
    for (const pairing of round.pairings) {
      if (pairing.player1 === userId) records.push({ roundIndex: round.index, pairing, isP1: true });
      else if (pairing.player2 === userId) records.push({ roundIndex: round.index, pairing, isP1: false });
    }
  }
  return records;
}

/** The full "player tournament details" content — shared verbatim between
 *  the desktop popover and the mobile modal (see the standings table below)
 *  so the two surfaces can never drift out of sync with each other. */
function PlayerTournamentDetails({ tournament, player }: { tournament: Tournament; player: TournamentPlayer }) {
  const isPointsFormat = tournament.format !== 'normal';
  const records = pairingsForPlayer(tournament, player.user);

  return (
    <div className="w-72 max-w-full space-y-3 p-1">
      <div className="flex items-center gap-2.5">
        <Avatar username={player.username} gradient={player.avatarGradient} size="md" />
        <div className="min-w-0">
          <p className="truncate font-semibold text-base-content">{player.username}</p>
          {player.user === tournament.createdBy && <p className="text-xs text-amber-400">★ Organizer</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {isPointsFormat && <Stat label="Points" value={player.points} />}
        {isPointsFormat && <Stat label="Tiebreak" value={player.tiebreak} />}
        <Stat label="Games played" value={player.gamesPlayed} />
        <Stat label="Berserk wins" value={player.berserkWins} />
      </div>

      {(player.hadBye || player.withdrawn) && (
        <div className="flex flex-wrap gap-1.5">
          {player.hadBye && <Badge variant="neutral">Had a bye</Badge>}
          {player.withdrawn && <Badge variant="error">Withdrawn</Badge>}
        </div>
      )}

      {records.length > 0 && (
        <div className="space-y-1.5 border-t border-base-300 pt-2.5">
          <p className="text-xs font-medium text-base-content/50">Round by round</p>
          {records.map(({ roundIndex, pairing, isP1 }) => {
            const opponentId = isP1 ? pairing.player2 : pairing.player1;
            const oppName = usernameOf(tournament, opponentId);
            const berserked = isP1 ? pairing.berserk.p1 : pairing.berserk.p2;

            let resultText = '·';
            let resultColor = 'text-base-content/40';
            if (pairing.status === 'finished') {
              if (opponentId === null) {
                resultText = 'Bye';
              } else if (pairing.result === 'draw') {
                resultText = 'Draw';
                resultColor = 'text-base-content/70';
              } else {
                const won = (isP1 && pairing.result === 'p1') || (!isP1 && pairing.result === 'p2');
                resultText = won ? 'Won' : 'Lost';
                resultColor = won ? 'text-green-400' : 'text-red-400';
              }
            } else if (pairing.status === 'active') {
              resultText = 'Playing';
              resultColor = 'text-amber-400';
            }

            return (
              <div key={roundIndex} className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-1.5 text-base-content/70">
                  <span className="shrink-0 text-xs text-base-content/40">R{roundIndex + 1}</span>
                  {opponentId !== null && (
                    <Avatar username={oppName} gradient={gradientOf(tournament, opponentId)} size="xs" />
                  )}
                  <span className="truncate">
                    {opponentId === null ? 'Bye' : oppName}
                    {berserked && ' ⚔'}
                  </span>
                </span>
                {pairing.status === 'active' && pairing.joinCode ? (
                  <Link to={`/game/${pairing.joinCode}`} className={`shrink-0 font-medium hover:underline ${resultColor}`}>
                    {resultText}
                  </Link>
                ) : (
                  <span className={`shrink-0 font-medium ${resultColor}`}>{resultText}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
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
      <span className="flex min-w-0 items-center gap-1.5 text-base-content">
        <Avatar username={p1Name} gradient={gradientOf(tournament, pairing.player1)} size="xs" />
        <span className="truncate">
          {p1Name}
          {pairing.berserk.p1 && ' ⚔'}
        </span>
        {pairing.player2 && (
          <>
            <span className="text-base-content/40">vs</span>
            <Avatar username={p2Name} gradient={gradientOf(tournament, pairing.player2)} size="xs" />
            <span className="truncate">
              {p2Name}
              {pairing.berserk.p2 && ' ⚔'}
            </span>
          </>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-2">
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
  const [tournament, setTournament] = useState<Tournament | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<{ message: string; isError: boolean } | null>(null);
  const [joinPassword, setJoinPassword] = useState('');
  const [editing, setEditing] = useState(false);
  const [manualRoundIndex, setManualRoundIndex] = useState<number | null>(null);
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

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
  // Defaults to whichever round is actually current, but once someone picks
  // a different tab it stays there across refreshes rather than yanking
  // them back to "current" every time the tournament state re-polls.
  const selectedRoundIndex = manualRoundIndex ?? tournament.currentRoundIndex;
  const selectedRound = tournament.rounds[selectedRoundIndex] ?? tournament.rounds[tournament.rounds.length - 1];
  const selectedPlayer = selectedPlayerId ? tournament.players.find((p) => p.user === selectedPlayerId) : null;

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

        {editing ? (
          <EditTournamentForm tournament={tournament} onSaved={() => setEditing(false)} onCancel={() => setEditing(false)} />
        ) : (
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
                {tournament.scheduledStartAt && <StartCountdown scheduledStartAt={tournament.scheduledStartAt} />}
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
                      {tournament.players.length === 1 && (
                        <Button variant="glass" size="sm" onClick={() => setEditing(true)}>
                          <Pencil className="h-3.5 w-3.5" /> Edit
                        </Button>
                      )}
                      <Button variant="danger" size="sm" onClick={cancel}>
                        Cancel
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
            <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-green-400">
              <Trophy className="h-4 w-4" />
              <Avatar username={usernameOf(tournament, tournament.winner)} gradient={gradientOf(tournament, tournament.winner)} size="xs" />
              {usernameOf(tournament, tournament.winner)} won
              {tournament.runnerUp && (
                <>
                  <span className="text-base-content/40">· runner-up</span>
                  <Avatar username={usernameOf(tournament, tournament.runnerUp)} gradient={gradientOf(tournament, tournament.runnerUp)} size="xs" />
                  {usernameOf(tournament, tournament.runnerUp)}
                </>
              )}
            </p>
          )}
          {tournament.status === 'cancelled' && (
            <p className="text-sm text-red-400">This tournament was cancelled.</p>
          )}
          </Card>
        )}

        {tournament.prizeSchedule.length > 0 && (
          <Card variant="solid">
            <CardHeader>
              <CardTitle>Prize pool — {tournament.prizePoolTokens} R</CardTitle>
            </CardHeader>
            <div className="space-y-1 text-sm text-base-content/70">
              {tournament.prizeSchedule.map((tier, i) => (
                <div key={i} className="flex justify-between">
                  <span>{tier.fromRank === tier.toRank ? `${tier.fromRank}${ordinalSuffix(tier.fromRank)} place` : `${tier.fromRank}${ordinalSuffix(tier.fromRank)}–${tier.toRank}${ordinalSuffix(tier.toRank)} place`}</span>
                  <span className="font-medium text-base-content">{tier.tokens} {tokensLabel(tier)}</span>
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
                <Badge key={p.user} variant="neutral" className="!py-1">
                  <Avatar username={p.username} gradient={p.avatarGradient} size="xs" />
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
                    <td className="py-1">
                      {/* Desktop: anchored popover, opens right where you clicked. */}
                      <span className="hidden md:inline-flex">
                        <Popover
                          align="start"
                          trigger={
                            <button className="flex items-center gap-1.5 text-left hover:underline">
                              <Avatar username={p.username} gradient={p.avatarGradient} size="xs" />
                              {p.username}
                            </button>
                          }
                        >
                          <PlayerTournamentDetails tournament={tournament} player={p} />
                        </Popover>
                      </span>
                      {/* Mobile: opens the shared full-screen modal below —
                       *  a small anchored popover doesn't leave enough room
                       *  on a phone for the round-by-round list. */}
                      <button
                        className="flex items-center gap-1.5 text-left md:hidden"
                        onClick={() => setSelectedPlayerId(p.user)}
                      >
                        <Avatar username={p.username} gradient={p.avatarGradient} size="xs" />
                        {p.username}
                      </button>
                    </td>
                    <td className="py-1 text-right">{p.points}</td>
                    <td className="py-1 text-right">{p.gamesPlayed}</td>
                    <td className="py-1 text-right">{p.berserkWins}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}

        {tournament.rounds.length > 0 && selectedRound && (
          <Card variant="solid">
            <div className="mb-3 overflow-x-auto">
              <Tabs
                layoutId="round-tabs"
                items={tournament.rounds.map((r) => ({ value: String(r.index), label: `Round ${r.index + 1}` }))}
                value={String(selectedRoundIndex)}
                onChange={(v) => setManualRoundIndex(Number(v))}
              />
            </div>
            <CardHeader>
              <CardTitle>
                Round {selectedRound.index + 1}
                {selectedRound.index === currentRound?.index && selectedRound.status === 'active' && (
                  <Badge variant="success" className="ml-2">
                    current
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <div className="space-y-1.5">
              {selectedRound.pairings.map((pairing) => (
                <PairingRow key={pairing.index} tournament={tournament} pairing={pairing} myId={myId} />
              ))}
            </div>
          </Card>
        )}
      </div>

      {/* Mobile counterpart to the desktop Popover above — same content,
       *  full-screen treatment since a phone doesn't have room for a small
       *  anchored panel with a round-by-round list in it. */}
      <Modal open={!!selectedPlayer} onClose={() => setSelectedPlayerId(null)} title={selectedPlayer?.username}>
        {selectedPlayer && <PlayerTournamentDetails tournament={tournament} player={selectedPlayer} />}
      </Modal>
    </Page>
  );
}
