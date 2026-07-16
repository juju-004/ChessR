import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Chess } from 'chess.js';
import { createGame, listFriendsActiveGames, type ActiveFriendGame } from '../api/games.js';
import { ApiRequestError } from '../api/http.js';
import { useAuth } from '../contexts/AuthContext.js';
import { TIME_CONTROLS, formatTimeControl } from '../timeControls.js';
import { turnColor } from '../chessUtils.js';

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [tcIndex, setTcIndex] = useState(2);
  const [joinCodeInput, setJoinCodeInput] = useState('');
  const [error, setError] = useState('');
  const [activeGames, setActiveGames] = useState<ActiveFriendGame[] | null>(null);
  const [gamesError, setGamesError] = useState('');

  useEffect(() => {
    let cancelled = false;
    listFriendsActiveGames()
      .then((res) => !cancelled && setActiveGames(res.games))
      .catch(() => !cancelled && setGamesError('Failed to load active games.'));
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate() {
    const tc = TIME_CONTROLS[tcIndex];
    setError('');
    try {
      const { joinCode } = await createGame({ baseMinutes: tc.baseMinutes, incrementSeconds: tc.incrementSeconds });
      navigate(`/game/${joinCode}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Could not create game');
    }
  }

  function handleJoinByCode() {
    const code = joinCodeInput.trim().toUpperCase();
    if (code) navigate(`/game/${code}`);
  }

  console.log(activeGames);
  
  return (
    <div className="mx-auto mt-6 max-w-2xl space-y-4">
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h1 className="text-xl font-bold text-neutral-100">Welcome, {user?.username}</h1>
        <p className="mb-3 text-sm text-neutral-400">Rating: {user?.rating}</p>

        <label className="mb-1 block text-sm text-neutral-400">Time control</label>
        <select
          value={tcIndex}
          onChange={(e) => setTcIndex(Number(e.target.value))}
          className="mb-3 w-full rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-neutral-100"
        >
          {TIME_CONTROLS.map((tc, i) => (
            <option key={tc.label} value={i}>
              {tc.label}
            </option>
          ))}
        </select>

        <button
          onClick={handleCreate}
          className="rounded-md bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500"
        >
          Create game
        </button>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-2 text-lg font-semibold text-neutral-100">Join a game by code</h2>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="e.g. 7K3M9P"
            maxLength={10}
            value={joinCodeInput}
            onChange={(e) => setJoinCodeInput(e.target.value.toUpperCase())}
            className="flex-1 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 uppercase text-neutral-100"
          />
          <button
            onClick={handleJoinByCode}
            className="rounded-md bg-neutral-700 px-4 py-2 font-semibold text-neutral-100 hover:bg-neutral-600"
          >
            Go to game
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
        <h2 className="mb-2 text-lg font-semibold text-neutral-100">Friends currently playing</h2>
        {gamesError && <p className="text-sm text-red-400">{gamesError}</p>}
        {!gamesError && activeGames === null && <p className="text-sm text-neutral-400">Loading…</p>}
        {activeGames && activeGames.length === 0 && (
          <p className="text-sm text-neutral-400">None of your friends are in a game right now.</p>
        )}
        {activeGames &&
          activeGames.map((g) => {
            const toMove = turnColor(new Chess(g.fen));
            return (
              <div key={g._id} className="flex items-center justify-between border-b border-neutral-800 py-2 last:border-none">
                {/* <div className="text-sm text-neutral-200">
                  <Link to={`/profile/${g.white.username}`} className="hover:underline">
                    {g.white.username}
                  </Link>{' '}
                  vs{' '}
                  <Link to={`/profile/${g.black.username}`} className="hover:underline">
                    {g.black.username}
                  </Link>
                  <span className="ml-2 text-neutral-500">
                    · move {g.moves.length} · {toMove} to move · {formatTimeControl(g.timeControl)}
                  </span>
                </div> */}
                <Link
                  to={`/game/${g.joinCode}`}
                  className="rounded-md bg-neutral-700 px-3 py-1.5 text-sm font-semibold text-neutral-100 hover:bg-neutral-600"
                >
                  Watch
                </Link>
              </div>
            );
          })}
      </div>
    </div>
  );
}
