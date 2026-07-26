import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  listOpenTournaments,
  listMyTournaments,
  FORMAT_LABEL,
  FORMAT_DESCRIPTION,
  formatTimeControl,
  type Tournament,
  type TournamentFormat,
  type TournamentWagerMode,
} from '../api/tournaments.js';
import { useSocket } from '../contexts/SocketContext.js';
import { useAuth } from '../contexts/AuthContext.js';

const TIME_PRESETS: { label: string; baseMinutes: number | null; incrementSeconds: number }[] = [
  { label: 'Bullet · 1+0', baseMinutes: 1, incrementSeconds: 0 },
  { label: 'Bullet · 2+1', baseMinutes: 2, incrementSeconds: 1 },
  { label: 'Blitz · 3+2', baseMinutes: 3, incrementSeconds: 2 },
  { label: 'Blitz · 5+0', baseMinutes: 5, incrementSeconds: 0 },
  { label: 'Rapid · 10+0', baseMinutes: 10, incrementSeconds: 0 },
  { label: 'Rapid · 15+10', baseMinutes: 15, incrementSeconds: 10 },
  { label: 'Classical · 30+0', baseMinutes: 30, incrementSeconds: 0 },
];

const FORMAT_DEFAULT_MAX: Record<TournamentFormat, number> = {
  normal: 16,
  swiss: 12,
  robin: 8,
  round_robin: 6,
};

function statusBadge(status: Tournament['status']) {
  const styles: Record<Tournament['status'], string> = {
    pending: 'bg-neutral-800 text-neutral-300',
    active: 'bg-green-900/40 text-green-300',
    finished: 'bg-neutral-800 text-neutral-500',
    cancelled: 'bg-red-900/40 text-red-300',
  };
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${styles[status]}`}>{status}</span>;
}

function TournamentRow({ t }: { t: Tournament }) {
  return (
    <Link
      to={`/tournaments/${t.code}`}
      className="flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 hover:border-neutral-700"
    >
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium text-neutral-100">{t.name}</span>
          {statusBadge(t.status)}
        </div>
        <div className="text-xs text-neutral-500">
          {FORMAT_LABEL[t.format]} · {formatTimeControl(t)} · {t.players.length}/{t.maxPlayers} players
          {t.wagerMode === 'entry_fee' && <> · {t.wagerTokens} R entry</>}
          {t.berserkAllowed && <> · Berserk on</>}
        </div>
      </div>
      <span className="text-xs text-neutral-500">#{t.code}</span>
    </Link>
  );
}

export function Tournaments() {
  const socket = useSocket();
  const { user } = useAuth();
  const [open, setOpen] = useState<Tournament[]>([]);
  const [mine, setMine] = useState<Tournament[]>([]);
  const [status, setStatus] = useState<{ message: string; isError: boolean } | null>(null);

  const [name, setName] = useState('');
  const [format, setFormat] = useState<TournamentFormat>('swiss');
  const [presetIdx, setPresetIdx] = useState(3);
  const [variant, setVariant] = useState<'standard' | 'chess960'>('standard');
  const [maxPlayers, setMaxPlayers] = useState(FORMAT_DEFAULT_MAX.swiss);
  const [swissRounds, setSwissRounds] = useState(5);
  const [berserkAllowed, setBerserkAllowed] = useState(true);
  const [wagerMode, setWagerMode] = useState<TournamentWagerMode>('none');
  const [wagerInput, setWagerInput] = useState('0');

  const refresh = useCallback(() => {
    listOpenTournaments().then((res) => setOpen(res.tournaments));
    if (user) listMyTournaments().then((res) => setMine(res.tournaments));
  }, [user]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!socket) return;
    function onCreated(payload: { code: string }) {
      setStatus({ message: 'Tournament created!', isError: false });
      refresh();
      window.location.assign(`/tournaments/${payload.code}`);
    }
    function onError(payload: { message: string }) {
      setStatus({ message: payload.message, isError: true });
    }
    socket.on('tournament:created', onCreated);
    socket.on('tournament:update', refresh);
    socket.on('tournament:started', refresh);
    socket.on('tournament:cancelled', refresh);
    socket.on('tournament:error', onError);
    return () => {
      socket.off('tournament:created', onCreated);
      socket.off('tournament:update', refresh);
      socket.off('tournament:started', refresh);
      socket.off('tournament:cancelled', refresh);
      socket.off('tournament:error', onError);
    };
  }, [socket, refresh]);

  function handleFormatChange(f: TournamentFormat) {
    setFormat(f);
    setMaxPlayers(FORMAT_DEFAULT_MAX[f]);
  }

  function handleCreate() {
    if (!socket) return;
    if (name.trim().length < 3) return setStatus({ message: 'Give it a name (3+ characters).', isError: true });
    const wagerTokens = Math.max(0, Math.floor(Number(wagerInput) || 0));
    if (wagerMode !== 'none' && wagerTokens <= 0) {
      return setStatus({ message: 'Enter an entry fee, or set wager to "No wager".', isError: true });
    }
    const preset = TIME_PRESETS[presetIdx];

    socket.emit('tournament:create', {
      name: name.trim(),
      format,
      variant,
      baseMinutes: preset.baseMinutes,
      incrementSeconds: preset.incrementSeconds,
      maxPlayers,
      berserkAllowed,
      wagerMode,
      wagerTokens,
      swissRounds: format === 'swiss' ? swissRounds : null,
    });
  }

  const openPending = open.filter((t) => t.status === 'pending');
  const openActive = open.filter((t) => t.status === 'active');

  return (
    <div className="mx-auto mt-6 max-w-3xl space-y-4">
      {status && <p className={`text-sm ${status.isError ? 'text-red-400' : 'text-green-400'}`}>{status.message}</p>}

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h1 className="mb-1 text-lg font-semibold text-neutral-100">Create a tournament</h1>
        <p className="mb-4 text-sm text-neutral-400">
          Run a knockout bracket, a swiss event, or a full round-robin — anyone can join until you start it.
        </p>

        <label className="mb-1 block text-sm text-neutral-400">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Friday Night Blitz"
          className="mb-4 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100"
        />

        <label className="mb-1 block text-sm text-neutral-400">Format</label>
        <div className="mb-4 grid grid-cols-2 gap-2">
          {(Object.keys(FORMAT_LABEL) as TournamentFormat[]).map((f) => (
            <button
              key={f}
              onClick={() => handleFormatChange(f)}
              className={`rounded-md border px-3 py-2 text-left text-sm ${
                format === f
                  ? 'border-amber-700 bg-amber-900/20 text-amber-200'
                  : 'border-neutral-800 bg-neutral-950 text-neutral-300 hover:border-neutral-700'
              }`}
            >
              <div className="font-medium">{FORMAT_LABEL[f]}</div>
              <div className="text-xs text-neutral-500">{FORMAT_DESCRIPTION[f]}</div>
            </button>
          ))}
        </div>

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Time control</label>
            <select
              value={presetIdx}
              onChange={(e) => setPresetIdx(Number(e.target.value))}
              className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
            >
              {TIME_PRESETS.map((p, i) => (
                <option key={p.label} value={i}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Variant</label>
            <select
              value={variant}
              onChange={(e) => setVariant(e.target.value as 'standard' | 'chess960')}
              className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
            >
              <option value="standard">Standard</option>
              <option value="chess960">Chess960</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Max players</label>
            <input
              type="number"
              min={2}
              max={64}
              value={maxPlayers}
              onChange={(e) => setMaxPlayers(Number(e.target.value))}
              className="w-24 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
            />
          </div>
          {format === 'swiss' && (
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Rounds</label>
              <input
                type="number"
                min={3}
                max={15}
                value={swissRounds}
                onChange={(e) => setSwissRounds(Number(e.target.value))}
                className="w-20 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
              />
            </div>
          )}
        </div>

        <label className="mb-4 flex items-center gap-2 text-sm text-neutral-300">
          <input type="checkbox" checked={berserkAllowed} onChange={(e) => setBerserkAllowed(e.target.checked)} />
          Allow berserking — halve your own clock (and forfeit your increment) for a shot at a bonus 0.5 point on a win
        </label>

        <div className="mb-4 flex flex-wrap items-end gap-3 border-t border-neutral-800 pt-3">
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Wager</label>
            <select
              value={wagerMode}
              onChange={(e) => setWagerMode(e.target.value as TournamentWagerMode)}
              className="rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
            >
              <option value="none">No wager</option>
              <option value="entry_fee">Entry fee (winner-takes-most prize pool)</option>
            </select>
          </div>
          {wagerMode === 'entry_fee' && (
            <div>
              <label className="mb-1 block text-xs text-neutral-500">Entry fee (R tokens)</label>
              <input
                type="number"
                min={1}
                value={wagerInput}
                onChange={(e) => setWagerInput(e.target.value)}
                className="w-28 rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100"
              />
            </div>
          )}
        </div>

        <button
          onClick={handleCreate}
          className="w-full rounded-md bg-amber-700 px-4 py-2 font-semibold text-neutral-950 hover:bg-amber-600"
        >
          Create tournament
        </button>
      </div>

      {openActive.length > 0 && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="mb-3 text-sm font-semibold text-neutral-200">In progress</h2>
          <div className="space-y-2">
            {openActive.map((t) => (
              <TournamentRow key={t._id} t={t} />
            ))}
          </div>
        </div>
      )}

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-3 text-sm font-semibold text-neutral-200">Open for registration</h2>
        {openPending.length === 0 && <p className="text-sm text-neutral-500">No tournaments waiting for players right now.</p>}
        <div className="space-y-2">
          {openPending.map((t) => (
            <TournamentRow key={t._id} t={t} />
          ))}
        </div>
      </div>

      {mine.length > 0 && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
          <h2 className="mb-3 text-sm font-semibold text-neutral-200">Your tournaments</h2>
          <div className="space-y-2">
            {mine.map((t) => (
              <TournamentRow key={t._id} t={t} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
