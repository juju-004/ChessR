import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Swords,
  Eye,
  UserPlus,
  UserMinus,
  Pencil,
  Scale,
  Flag,
  MoreHorizontal,
} from "lucide-react";
import {
  getProfile,
  getUserGames,
  type UserProfile,
  type UserGameHistoryItem,
} from "../api/users.js";
import { followUser, unfollowUser } from "../api/follows.js";
import { updateAuthUser } from "../api/authStore.js";
import { ApiRequestError } from "../api/http.js";
import { PageError } from "../components/PageError.js";
import { RATING_CATEGORIES, RATING_CATEGORY_META } from "../timeControls.js";
import { useSocket } from "../contexts/SocketContext.js";
import { useNotify } from "../contexts/NotificationContext.js";
import {
  Page,
  Card,
  Avatar,
  Button,
  Spinner,
  CategoryIcon,
  ResponsiveOverlay,
  Dropdown,
} from "../components/ui/index.js";
import { GameHistoryList } from "../components/lists/GameHistoryList.js";
import {
  GameSettingsFields,
  useGameSettings,
} from "../components/game/GameSettingsFields.js";
import { EditProfileModal } from "../components/EditProfileModal.js";
import { ReportUserModal } from "../components/ReportUserModal.js";
import { OrgBadge } from "../components/organizations/OrgBadge.js";

const GAMES_PER_PAGE = 15;

export function Profile() {
  const { username } = useParams<{ username: string }>();
  const socket = useSocket();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [games, setGames] = useState<UserGameHistoryItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalGames, setTotalGames] = useState(0);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [error, setError] = useState("");
  const [followBusy, setFollowBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const { notify } = useNotify();
  // Same challenge-form fields/defaults as the Players page's popover —
  // kept local here rather than shared state since this page only ever
  // challenges the one profile it's showing.
  const [challengeOpen, setChallengeOpen] = useState(false);
  const gameSettings = useGameSettings(0);

  useEffect(() => {
    if (!username) return;
    setError("");
    setProfile(null);
    getProfile(username)
      .then(setProfile)
      .catch((err) =>
        setError(
          err instanceof ApiRequestError ? err.message : "Profile not found",
        ),
      );
  }, [username]);

  // Keeps the online dot live while this profile is open for a player you
  // follow, same way the Players page does. follow:presence is only sent to
  // a player's followers, so a stranger's dot stays a snapshot from
  // whenever the page loaded.
  useEffect(() => {
    if (!socket || !profile) return;
    function onPresence(payload: { userId: string; online: boolean }) {
      if (payload.userId !== profile!.id) return;
      setProfile((prev) => (prev ? { ...prev, online: payload.online } : prev));
    }
    socket.on("follow:presence", onPresence);
    return () => {
      socket.off("follow:presence", onPresence);
    };
  }, [socket, profile?.id]);

  // Same events the Players page's challenge popover listens for — the
  // server doesn't ack challenge:send directly, success/failure come back
  // as their own separate events instead.
  useEffect(() => {
    if (!socket) return;
    function onSent(payload?: { offline?: boolean }) {
      notify(
        payload?.offline
          ? "Challenge sent. They're offline and will see it when they come back online."
          : "Challenge sent. Waiting for a response…",
        [],
        3000,
      );
    }
    // No challenge:error handler here: GlobalListeners already toasts it, and
    // a second toast from this page made every rejection show twice.
    socket.on("challenge:sent", onSent);
    return () => {
      socket.off("challenge:sent", onSent);
    };
  }, [socket, notify]);

  // Lazy-loaded in pages of GAMES_PER_PAGE via "Load more" below, rather
  // than click-through pagination, each click appends to `games` instead
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
    return <PageError message={error} className="px-4" />;
  }

  if (!profile) {
    return (
      <div className="flex justify-center pt-16">
        <Spinner className="text-base-content/40" />
      </div>
    );
  }

  async function handleFollow() {
    if (!profile || followBusy) return;
    setFollowBusy(true);
    try {
      await followUser(profile.id);
      setProfile((prev) =>
        prev
          ? { ...prev, isFollowing: true, followerCount: prev.followerCount + 1 }
          : prev,
      );
    } catch {
      // Non-fatal, keep the button visible so they can retry.
    } finally {
      setFollowBusy(false);
    }
  }

  async function handleUnfollow() {
    if (!profile || followBusy) return;
    setFollowBusy(true);
    try {
      await unfollowUser(profile.id);
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              isFollowing: false,
              followerCount: Math.max(0, prev.followerCount - 1),
            }
          : prev,
      );
    } catch {
      // Non-fatal, the button stays as "Following" so they can retry.
    } finally {
      setFollowBusy(false);
    }
  }

  function handleChallenge() {
    if (!socket || !profile) return;
    // Being in a game doesn't block the challenge (they can just answer it
    // once that game's done) — this is only a heads-up so it isn't a
    // surprise later that the challenge sat unanswered for a while.
    if (profile.activeGameCode) {
      notify(
        `${profile.username} is currently in a game — sending anyway.`,
        [],
        3000,
      );
    }
    const { timeControl: tc, odds, variant, wagerTokens } = gameSettings;
    socket.emit("challenge:send", {
      toUserId: profile.id,
      baseMinutes: tc.baseMinutes,
      incrementSeconds: tc.incrementSeconds,
      // Odds: the other player's clock, when it differs from yours.
      odds: odds
        ? { baseMinutes: odds.baseMinutes, incrementSeconds: odds.incrementSeconds }
        : null,
      variant,
      wagerTokens,
    });
    setChallengeOpen(false);
  }

  const gamesPlayed = profile.stats.gamesPlayed || 1;
  const winPct = Math.round((profile.stats.wins / gamesPlayed) * 100);
  const hasMoreGames = games.length < totalGames;
  const h2hTotal = profile.h2h
    ? profile.h2h.wins + profile.h2h.losses + profile.h2h.draws
    : 0;

  return (
    <Page>
      <div className="space-y-4">
        <Card variant="solid">
          <div className="flex flex-col gap-4">
            <div className="flex items-start gap-3 sm:gap-4">
              <Avatar
                username={profile.username}
                size="lg"
                gradient={profile.avatarGradient}
                status={profile.online ? "online" : "offline"}
                className="shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <h1 className="min-w-0 truncate text-2xl font-bold text-base-content">
                    {profile.username}
                  </h1>
                  {profile.isSelf && (
                    <button
                      onClick={() => setEditOpen(true)}
                      aria-label="Edit profile"
                      className="shrink-0 rounded-full p-1.5 text-base-content/40 transition-colors hover:bg-base-200 hover:text-base-content"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {profile.organization && (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <OrgBadge name={profile.organization.name} />
                  </div>
                )}
                <p className="mt-1 text-sm text-base-content/70">
                  <span className="font-semibold text-base-content">
                    {profile.followerCount}
                  </span>{" "}
                  {profile.followerCount === 1 ? "follower" : "followers"}
                  {" · "}
                  <span className="font-semibold text-base-content">
                    {profile.followingCount}
                  </span>{" "}
                  following
                </p>
                <p className="mt-1 text-sm text-base-content/50">
                  Member since{" "}
                  {new Date(profile.memberSince).toLocaleDateString()}
                </p>
              </div>
            </div>

            {profile.bio && (
              <p className="ml-5 text-sm text-base-content/70">{profile.bio}</p>
            )}

            {!profile.isSelf && (
              // Standard mobile profile-actions row: one prominent
              // relationship action (Follow / Unfollow)
              // takes the lead, everything else collapses to same-size
              // icon-only buttons alongside it — Watch and Challenge when
              // relevant, and a "more" overflow menu for the one
              // infrequent/meta action (Report), rather than every action
              // competing for attention as its own labeled button.
              <div className="flex items-center gap-2">
                {profile.isFollowing ? (
                  <Button
                    variant="glass"
                    className="flex-1"
                    disabled={followBusy}
                    onClick={handleUnfollow}
                    aria-label={`Unfollow ${profile.username}`}
                  >
                    <UserMinus className="h-4 w-4" /> Unfollow
                  </Button>
                ) : (
                  <Button
                    className="flex-1"
                    disabled={followBusy}
                    onClick={handleFollow}
                    aria-label={`Follow ${profile.username}`}
                  >
                    <UserPlus className="h-4 w-4" />{" "}
                    Follow
                  </Button>
                )}

                {profile.activeGameCode && (
                  <Link to={`/game/${profile.activeGameCode}`}>
                    <Button
                      variant="glass"
                      size="icon"
                      aria-label={`Watch ${profile.username}'s game`}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </Link>
                )}
                {/* Anyone can challenge anyone, followed or not (the server
                    allows it, see challenge:send). Being in a game right
                    now doesn't hide it, see handleChallenge for that case. */}
                <ResponsiveOverlay
                    title={`Challenge ${profile.username}`}
                    align="end"
                    className="w-72 max-w-[calc(100vw-2rem)]"
                    open={challengeOpen}
                    onOpenChange={setChallengeOpen}
                    icon={<Swords />}
                    trigger={
                      <Button
                        variant="glass"
                        size="icon"
                        aria-label={`Challenge ${profile.username}`}
                      >
                        <Swords className="h-4 w-4" />
                      </Button>
                    }
                  >
                    <div className="space-y-3 px-4 md:px-2">
                      {profile.activeGameCode && (
                        <p className="text-xs text-base-content/50">
                          {profile.username} is currently in a game — you can
                          still send this, they'll see it once they're free.
                        </p>
                      )}
                      {!profile.online && !profile.activeGameCode && (
                        <p className="text-xs text-base-content/50">
                          {profile.username} is offline. They'll see your
                          challenge as soon as they come back online.
                        </p>
                      )}
                      <GameSettingsFields settings={gameSettings} challenge />
                      <Button
                        className="w-full"
                        variant="secondary"
                        onClick={handleChallenge}
                        disabled={gameSettings.wagerBelowFloor || gameSettings.clockInvalid}
                      >
                        Send
                      </Button>
                    </div>
                </ResponsiveOverlay>

                <Dropdown
                  align="end"
                  trigger={
                    <Button
                      variant="glass"
                      size="icon"
                      aria-label="More options"
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  }
                  items={[
                    {
                      label: `Report ${profile.username}`,
                      icon: Flag,
                      onClick: () => setReportOpen(true),
                      danger: true,
                    },
                  ]}
                />
              </div>
            )}
          </div>

          {/* Ratings, one tile per ladder (bullet, blitz, rapid, Chess960,
              Crazyhouse), between the main details and the win/loss record.
              Five tiles don't fit on one line, so the row scrolls sideways
              instead of squeezing them: every tile keeps a minimum width
              (shrink-0) and grows to share the space only when there is
              room. Phone: compact stacked tiles (icon, big number, label).
              From sm up: wider tiles with the icon in a round chip beside
              the label and number. */}
          {profile.ratings && (
            <div className="mt-4 flex snap-x snap-proximity gap-2 overflow-x-auto overscroll-x-contain border-t border-base-300 pt-4 pb-1.5 [scrollbar-width:thin] sm:gap-3">
              {RATING_CATEGORIES.map((c) => {
                const rating = profile.ratings![c];
                return (
                  <div
                    key={c}
                    title={`${RATING_CATEGORY_META[c].label} rating${rating != null ? ` ${rating}` : ""}`}
                    className="flex min-w-28 flex-1 shrink-0 snap-start flex-col items-center gap-1.5 rounded-xl border border-base-300 bg-base-100/50 px-2 py-3 text-center sm:min-w-44 sm:flex-row sm:gap-3 sm:px-4 sm:py-3.5 sm:text-left"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-(--primary)/10 text-(--primary) sm:h-11 sm:w-11">
                      <CategoryIcon category={c} size={22} />
                    </span>
                    <div>
                      <p className="text-xl leading-none font-bold tabular-nums text-base-content sm:text-2xl">
                        {rating ?? "—"}
                      </p>
                      <p className="mt-1 text-[11px] font-medium tracking-wide whitespace-nowrap text-base-content/50 uppercase sm:text-xs">
                        {RATING_CATEGORY_META[c].label}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-4 grid grid-cols-4 gap-2 border-t border-base-300 pt-4 text-center">
            <div>
              <p className="text-lg font-bold text-green-500">
                {profile.stats.wins}
              </p>
              <p className="text-xs text-base-content/50">Wins</p>
            </div>
            <div>
              <p className="text-lg font-bold text-red-400">
                {profile.stats.losses}
              </p>
              <p className="text-xs text-base-content/50">Losses</p>
            </div>
            <div>
              <p className="text-lg font-bold text-base-content/70">
                {profile.stats.draws}
              </p>
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
                  H2H with {profile.username}
                </h2>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="font-semibold text-green-500">
                  {profile.h2h.wins}W
                </span>
                <span className="font-semibold text-red-400">
                  {profile.h2h.losses}L
                </span>
                <span className="font-semibold text-base-content/60">
                  {profile.h2h.draws}D
                </span>
              </div>
            </div>
            {/* Simple proportional bar, wins/losses/draws as thirds of a
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
            <h2 className="text-base font-semibold text-base-content">
              Game history
            </h2>
          </div>
          <GameHistoryList
            games={games}
            loading={gamesLoading}
            hasMore={hasMoreGames}
            onLoadMore={loadMoreGames}
            linkFor={(g) => `/game/${g.joinCode}`}
          />
        </Card>
      </div>

      {profile.isSelf && (
        <EditProfileModal
          open={editOpen}
          onClose={() => setEditOpen(false)}
          username={profile.username}
          currentGradient={profile.avatarGradient}
          currentBio={profile.bio}
          onSaved={(patch) => {
            setProfile((prev) => (prev ? { ...prev, ...patch } : prev));
            // The navbar (and anywhere else) reads the avatar from the auth
            // store, not this page's local profile state, push it there
            // too so a changed avatar shows up immediately, not just after
            // the next login/token refresh.
            if (profile.isSelf && patch.avatarGradient !== undefined) {
              updateAuthUser({ avatarGradient: patch.avatarGradient });
            }
          }}
        />
      )}
      {!profile.isSelf && (
        <ReportUserModal
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          username={profile.username}
        />
      )}
    </Page>
  );
}
