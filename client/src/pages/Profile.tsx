import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Swords, Eye, UserPlus, Check } from 'lucide-react';
import { getProfile, getUserGames, type UserProfile, type UserGameHistoryItem } from '../api/users.js';
import { sendFriendRequest } from '../api/friends.js';
import { ApiRequestError } from '../api/http.js';
import { formatTimeControl } from '../timeControls.js';
import { Page, Card, Avatar, Button, Badge, Spinner } from '../components/ui/index.js';

const resultVariant: Record<UserGameHistoryItem['result'], 'success' | 'error' | 'neutral'> = {
  win: 'success',
  loss: 'error',
  draw: 'neutral',
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
    setProfile(null);
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
    return (
      <div className="mx-auto mt-6 max-w-2xl px-4">
        <Card variant="solid" className="border-red-900/50 bg-red-950/20 text-red-300">
          {error}
        </Card>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="flex justify-center pt-16">
        <Spinner className="text-base-content/40" />
      </div>
    );
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

  const gamesPlayed = profile.stats.gamesPlayed || 1;
  const winPct = Math.round((profile.stats.wins / gamesPlayed) * 100);

  return (
    <Page>
      <div className="space-y-4">
        <Card variant="solid">
          <div className="flex flex-wrap items-center gap-4">
            <Avatar username={profile.username} size="lg" />
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-bold text-base-content">{profile.username}</h1>
              <p className="text-sm text-base-content/50">
                Member since {new Date(profile.memberSince).toLocaleDateString()}
              </p>
            </div>
            {!profile.isSelf && (
              <div className="flex flex-wrap items-center gap-2">
                {profile.activeGameCode && (
                  <Link to={`/game/${profile.activeGameCode}`}>
                    <Button variant="secondary" size="sm">
                      <Eye className="h-4 w-4" /> Watch
                    </Button>
                  </Link>
                )}
                {profile.isFriend ? (
                  <Badge variant="success">
                    <Check className="h-3 w-3" /> Friends
                  </Badge>
                ) : friendRequestSent ? (
                  <Badge variant="success">
                    <Check className="h-3 w-3" /> Request sent
                  </Badge>
                ) : (
                  <Button size="sm" onClick={handleAddFriend}>
                    <UserPlus className="h-4 w-4" /> Add friend
                  </Button>
                )}
              </div>
            )}
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2 border-t border-base-300 pt-4 text-center">
            <div>
              <p className="text-lg font-bold text-green-500">{profile.stats.wins}</p>
              <p className="text-xs text-base-content/50">Wins</p>
            </div>
            <div>
              <p className="text-lg font-bold text-red-400">{profile.stats.losses}</p>
              <p className="text-xs text-base-content/50">Losses</p>
            </div>
            <div>
              <p className="text-lg font-bold text-base-content/70">{profile.stats.draws}</p>
              <p className="text-xs text-base-content/50">Draws</p>
            </div>
            <div>
              <p className="text-lg font-bold text-(--primary)">{winPct}%</p>
              <p className="text-xs text-base-content/50">Win rate</p>
            </div>
          </div>
        </Card>

        <Card variant="solid">
          <div className="mb-2 flex items-center gap-2">
            <Swords className="h-4 w-4 text-base-content/50" />
            <h2 className="text-base font-semibold text-base-content">Game history</h2>
          </div>
          {games.length === 0 && <p className="text-sm text-base-content/50">No games played yet.</p>}
          <div className="divide-y divide-base-300">
            {games.map((g) => (
              <Link
                key={g.gameId}
                to={`/replay/${g.joinCode}`}
                className="flex items-center justify-between gap-3 py-2.5 text-sm transition-colors hover:text-(--primary)"
              >
                <span className="min-w-0 truncate text-base-content">
                  {g.color === 'white' ? 'vs' : 'as black vs'} {g.opponent?.username ?? 'Unknown'}
                  <span className="ml-2 text-base-content/40">
                    {formatTimeControl(g.timeControl)} · {g.moveCount} moves ·{' '}
                    {new Date(g.endedAt).toLocaleDateString()}
                  </span>
                </span>
                <Badge variant={resultVariant[g.result]} className="shrink-0 uppercase">
                  {g.result}
                </Badge>
              </Link>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-center gap-3 text-sm">
              <Button variant="glass" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Prev
              </Button>
              <span className="text-base-content/60">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="glass"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          )}
        </Card>
      </div>
    </Page>
  );
}
