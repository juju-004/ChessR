import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getProfile, getUserGames, type UserProfile, type UserGameHistoryItem } from '../api/users.js';
import { sendFriendRequest } from '../api/friends.js';
import { ApiRequestError } from '../api/http.js';
import { formatTimeControl } from '../timeControls.js';

const resultStyles: Record<UserGameHistoryItem['result'], string> = {
  win: 'text-green-400',
  loss: 'text-red-400',
  draw: 'text-base-content/60',
};

export function Profile() {
  const { username } = useParams<{ username: string }>();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [games, setGames] = useState<UserGameHistoryItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [error, setError] = useState('');
  const [friendRequestSent, setFriendRequestSent] = useState(false);

  useEffect(() => {
    if (!username) return;
    setError('');
    getProfile(username)
      .then(setProfile)
      .catch((err) => setError(err instanceof ApiRequestError ? err.message : 'Profile not found'));
  }, [username]);

  useEffect(() => {
    if (!username) return;
    getUserGames(username, page, 15).then((res) => {
      setGames(res.games);
      setTotalPages(res.totalPages);
    });
  }, [username, page]);

  if (error) {
    return <div className="mx-auto mt-6 max-w-2xl rounded-lg border border-red-900 bg-red-950/40 p-5 text-red-400">{error}</div>;
  }

  if (!profile) {
    return <div className="mx-auto mt-6 max-w-2xl text-base-content/60">Loading profile…</div>;
  }

  async function handleAddFriend() {
    if (!profile) return;
    try {
      await sendFriendRequest(profile.id);
      setFriendRequestSent(true);
    } catch {
      // Non-fatal — keep the button visible so they can retry.
    }
  }

  return (
    <div className="mx-auto mt-6 max-w-2xl space-y-4">
      <div className="rounded-lg border border-base-300 bg-base-200 p-5">
        <h1 className="text-2xl font-bold text-base-content">{profile.username}</h1>
        <p className="mb-3 text-sm text-base-content/60">
          Member since {new Date(profile.memberSince).toLocaleDateString()}
        </p>

        <div className="mb-3 flex gap-4 text-sm">
          <span className="text-green-400">{profile.stats.wins}W</span>
          <span className="text-red-400">{profile.stats.losses}L</span>
          <span className="text-base-content/60">{profile.stats.draws}D</span>
          <span className="text-base-content/50">({profile.stats.gamesPlayed} games)</span>
        </div>

        {!profile.isSelf && (
          <div className="flex flex-wrap items-center gap-2">
            {profile.isFriend ? (
              <p className="text-sm text-green-400">✓ Friends</p>
            ) : friendRequestSent ? (
              <p className="text-sm text-green-400">✓ Friend request sent</p>
            ) : (
              <button
                onClick={handleAddFriend}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
              >
                Add friend
              </button>
            )}
            {profile.activeGameCode && (
              <Link
                to={`/game/${profile.activeGameCode}`}
                className="rounded-md bg-green-800 px-4 py-2 text-sm font-semibold text-green-100 hover:bg-green-700"
              >
                Watch — currently playing
              </Link>
            )}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-base-300 bg-base-200 p-5">
        <h2 className="mb-2 text-lg font-semibold text-base-content">Game history</h2>
        {games.length === 0 && <p className="text-sm text-base-content/60">No games played yet.</p>}
        {games.map((g) => (
          <Link
            key={g.gameId}
            to={`/replay/${g.joinCode}`}
            className="flex items-center justify-between border-b border-base-300 py-2 text-sm last:border-none hover:bg-base-300/50"
          >
            <span className="text-base-content">
              {g.color === 'white' ? 'vs' : 'as black vs'} {g.opponent?.username ?? 'Unknown'}
              <span className="ml-2 text-base-content/50">
                {formatTimeControl(g.timeControl)} · {g.moveCount} moves · {new Date(g.endedAt).toLocaleDateString()}
              </span>
            </span>
            <span className={`font-semibold uppercase ${resultStyles[g.result]}`}>{g.result}</span>
          </Link>
        ))}

        {totalPages > 1 && (
          <div className="mt-3 flex items-center justify-center gap-3 text-sm">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-md bg-base-300 px-3 py-1 text-base-content disabled:opacity-30"
            >
              Prev
            </button>
            <span className="text-base-content/60">
              Page {page} of {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md bg-base-300 px-3 py-1 text-base-content disabled:opacity-30"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
