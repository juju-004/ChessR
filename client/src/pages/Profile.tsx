import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Swords, Eye, UserPlus, Check, Pencil, Scale } from 'lucide-react';
import { getProfile, getUserGames, type UserProfile, type UserGameHistoryItem } from '../api/users.js';
import { sendFriendRequest } from '../api/friends.js';
import { ApiRequestError } from '../api/http.js';
import { formatTimeControl } from '../timeControls.js';
import { Page, Card, Avatar, Button, Badge, Spinner } from '../components/ui/index.js';
import { EditProfileModal } from '../components/EditProfileModal.js';

const GAMES_PER_PAGE = 15;

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
  const [totalGames, setTotalGames] = useState(0);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [error, setError] = useState('');
  const [friendRequestSent, setFriendRequestSent] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    if (!username) return;
    setError('');
    setProfile(null);
    getProfile(username)
      .then(setProfile)
      .catch((err) => setError(err instanceof ApiRequestError ? err.message : 'Profile not found'));
  }, [username]);

  // Lazy-loaded in pages of GAMES_PER_PAGE via "Load more" below, rather
  // than click-through pagination — each click appends to `games` instead
  // of replacing it, so scroll position and everything already rendered
  // above stays put.
  useEffect(() => {
    if (!username) return;
    setGames([]);
    setPage(1);
    setGamesLoading(true);
    getUserGames(username, 1, GAMES_PER_PAGE)
      .then((res) => {
        setGames(res.games);
        setTotalGames(res.total);
      })
      .finally(() => setGamesLoading(false));
  }, [username]);

  function loadMoreGames() {
    if (!username || gamesLoading) return;
    const nextPage = page + 1;
    setGamesLoading(true);
    getUserGames(username, nextPage, GAMES_PER_PAGE)
      .then((res) => {
        setGames((prev) => [...prev, ...res.games]);
        setPage(nextPage);
        setTotalGames(res.total);
      })
      .finally(() => setGamesLoading(false));
  }

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
  const hasMoreGames = games.length < totalGames;
  const h2hTotal = profile.h2h ? profile.h2h.wins + profile.h2h.losses + profile.h2h.draws : 0;

  return (
    <Page>
      <div className="space-y-4">
        <Card variant="solid">
          <div className="flex flex-wrap items-center gap-4">
            <Avatar username={profile.username} size="lg" gradient={profile.avatarGradient} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-base-content">{profile.username}</h1>
                {profile.isSelf && (
                  <button
                    onClick={() => setEditOpen(true)}
                    aria-label="Edit profile"
                    className="rounded-full p-1.5 text-base-content/40 transition-colors hover:bg-base-200 hover:text-base-content"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
              </div>
              <p className="text-sm text-base-content/50">
                Member since {new Date(profile.memberSince).toLocaleDateString()}
              </p>
              {profile.bio && <p className="mt-1 text-sm text-base-content/70">{profile.bio}</p>}
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

        {profile.h2h && (
          <Card variant="solid">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Scale className="h-4 w-4 text-base-content/50" />
                <h2 className="text-base font-semibold text-base-content">
                  Head-to-head with {profile.username}
                </h2>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="font-semibold text-green-500">{profile.h2h.wins}W</span>
                <span className="font-semibold text-red-400">{profile.h2h.losses}L</span>
                <span className="font-semibold text-base-content/60">{profile.h2h.draws}D</span>
              </div>
            </div>
            {/* Simple proportional bar — wins/losses/draws as thirds of a
             *  strip rather than a number-only summary, since it reads
             *  faster at a glance than three digits do. */}
            <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-base-300">
              {profile.h2h.wins > 0 && (
                <div
                  className="bg-green-500"
                  style={{ width: `${(profile.h2h.wins / h2hTotal) * 100}%` }}
                />
              )}
              {profile.h2h.draws > 0 && (
                <div
                  className="bg-base-content/30"
                  style={{ width: `${(profile.h2h.draws / h2hTotal) * 100}%` }}
                />
              )}
              {profile.h2h.losses > 0 && (
                <div
                  className="bg-red-400"
                  style={{ width: `${(profile.h2h.losses / h2hTotal) * 100}%` }}
                />
              )}
            </div>
          </Card>
        )}

        <Card variant="solid">
          <div className="mb-2 flex items-center gap-2">
            <Swords className="h-4 w-4 text-base-content/50" />
            <h2 className="text-base font-semibold text-base-content">Game history</h2>
          </div>
          {!gamesLoading && games.length === 0 && (
            <p className="text-sm text-base-content/50">No games played yet.</p>
          )}
          <div className="divide-y divide-base-300">
            {games.map((g) => (
              <Link
                key={g.gameId}
                to={`/replay/${g.joinCode}`}
                className="flex items-center justify-between gap-3 py-2.5 text-sm transition-colors hover:text-(--primary)"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar
                    username={g.opponent?.username ?? '?'}
                    size="xs"
                    gradient={g.opponent?.avatarGradient}
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-base-content">
                      {g.opponent?.username ?? 'Unknown'}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-base-content/40">
                      <span
                        className={
                          g.color === 'white'
                            ? 'inline-block h-2 w-2 rounded-full border border-base-content/30 bg-white'
                            : 'inline-block h-2 w-2 rounded-full border border-base-content/30 bg-black'
                        }
                      />
                      <span className="capitalize">{g.color}</span>
                      <span>·</span>
                      <span>{formatTimeControl(g.timeControl)}</span>
                      <span>·</span>
                      <span>{g.moveCount} moves</span>
                      <span>·</span>
                      <span>{new Date(g.endedAt).toLocaleDateString()}</span>
                    </p>
                  </div>
                </div>
                <Badge variant={resultVariant[g.result]} className="shrink-0 uppercase">
                  {g.result}
                </Badge>
              </Link>
            ))}
          </div>

          {gamesLoading && (
            <div className="flex justify-center py-4">
              <Spinner size="sm" className="text-base-content/40" />
            </div>
          )}

          {!gamesLoading && hasMoreGames && (
            <div className="mt-3 flex justify-center">
              <Button variant="glass" size="sm" onClick={loadMoreGames}>
                Load more
              </Button>
            </div>
          )}
        </Card>
      </div>

      {profile.isSelf && (
        <EditProfileModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          username={profile.username}
          currentGradient={profile.avatarGradient}
          currentBio={profile.bio}
          onSaved={(patch) =>
            setProfile((prev) => (prev ? { ...prev, ...patch } : prev))
          }
        />
      )}
    </Page>
  );
}
