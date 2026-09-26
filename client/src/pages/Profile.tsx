import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Swords,
  Eye,
  UserPlus,
  UserMinus,
  Check,
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
import { sendFriendRequest, removeFriend } from "../api/friends.js";
import { updateAuthUser } from "../api/authStore.js";
import { ApiRequestError } from "../api/http.js";
import { PageError } from "../components/PageError.js";
import { formatTimeControl, TIME_CONTROLS } from "../timeControls.js";
import { MAX_WAGER_TOKENS, MIN_STAKE_TOKENS } from "../lib/limits.js";
import { useSocket } from "../contexts/SocketContext.js";
import { useConfirm } from "../contexts/ConfirmContext.js";
import { useNotify } from "../contexts/NotificationContext.js";
import {
  Page,
  Card,
  Avatar,
  Button,
  Badge,
  Spinner,
  TimeControlIcon,
  Select,
  Input,
  ResponsiveOverlay,
  RCoin,
  Dropdown,
} from "../components/ui/index.js";
import { EditProfileModal } from "../components/EditProfileModal.js";
import { ReportUserModal } from "../components/ReportUserModal.js";
import { RatingBadge, RatingTierHelpTip } from "../components/RatingBadge.js";

const GAMES_PER_PAGE = 15;

const resultVariant: Record<
  UserGameHistoryItem["result"],
  "success" | "error" | "neutral"
> = {
  win: "success",
  loss: "error",
  draw: "neutral",
};

export function Profile() {
  const { username } = useParams<{ username: string }>();
  const socket = useSocket();
  const confirmDialog = useConfirm();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [games, setGames] = useState<UserGameHistoryItem[]>([]);
  const [page, setPage] = useState(1);
  const [totalGames, setTotalGames] = useState(0);
  const [gamesLoading, setGamesLoading] = useState(false);
  const [error, setError] = useState("");
  const [friendRequestSent, setFriendRequestSent] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const { notify } = useNotify();
  // Same challenge-form fields/defaults as the Players page's popover —
  // kept local here rather than shared state since this page only ever
  // challenges the one profile it's showing.
  const [challengeOpen, setChallengeOpen] = useState(false);
  const [tcIndex, setTcIndex] = useState(0);
  const [variant, setVariant] = useState<"standard" | "chess960">("standard");
  const [wagerInput, setWagerInput] = useState("0");

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

  // Lets a still-pending "Request sent" state on this profile flip to
  // "Friends" live if the person it's for accepts while you're sitting
  // here, same fix as the friends list on the Players page, just for the
  // one-profile case, "by" on this event is whoever just resolved the
  // request, i.e. the person this profile belongs to.
  useEffect(() => {
    if (!socket || !profile) return;
    function onRequestResolved(payload: { accepted: boolean; by: string }) {
      if (!payload.accepted || payload.by !== profile!.id) return;
      setFriendRequestSent(false);
      setProfile((prev) => (prev ? { ...prev, isFriend: true } : prev));
    }
    // The other direction: this profile's owner just unfriended you (from
    // their own friends list, or their own view of your profile) while
    // you happened to be looking at theirs, flip the Unfriend button back
    // to "Add friend" live instead of leaving a stale "Unfriend" button
    // that would 204-and-do-nothing (or worse, silently re-friend them)
    // the next time it's clicked.
    function onFriendRemoved(payload: { by: string }) {
      if (payload.by !== profile!.id) return;
      setProfile((prev) => (prev ? { ...prev, isFriend: false } : prev));
    }
    // Keeps the online dot live while this friend's profile is open, same
    // way the friends list does (Players.tsx). Only ever fires for actual
    // friends — friend:presence is only broadcast to a user's friends
    // server-side (see notifyFriends in presenceSocket.ts) — so a
    // stranger's dot stays a snapshot from whenever the page loaded.
    function onPresence(payload: { userId: string; online: boolean }) {
      if (payload.userId !== profile!.id) return;
      setProfile((prev) => (prev ? { ...prev, online: payload.online } : prev));
    }
    socket.on("friend:request_resolved", onRequestResolved);
    socket.on("friend:removed", onFriendRemoved);
    socket.on("friend:presence", onPresence);
    return () => {
      socket.off("friend:request_resolved", onRequestResolved);
      socket.off("friend:removed", onFriendRemoved);
      socket.off("friend:presence", onPresence);
    };
  }, [socket, profile?.id]);

  // Same events the Players page's challenge popover listens for — the
  // server doesn't ack challenge:send directly, success/failure come back
  // as their own separate events instead.
  useEffect(() => {
    if (!socket) return;
    function onSent() {
      notify("Challenge sent. Waiting for a response…", [], 3000);
    }
    function onError(payload: { message: string }) {
      notify(payload.message, [], 4000);
    }
    socket.on("challenge:sent", onSent);
    socket.on("challenge:error", onError);
    return () => {
      socket.off("challenge:sent", onSent);
      socket.off("challenge:error", onError);
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

  async function handleAddFriend() {
    if (!profile) return;
    try {
      await sendFriendRequest(profile.id);
      setFriendRequestSent(true);
    } catch {
      // Non-fatal, keep the button visible so they can retry.
    }
  }

  async function handleUnfriend() {
    if (!profile) return;
    const ok = await confirmDialog({
      title: `Unfriend ${profile.username}?`,
      description: "You can always send another friend request later.",
      variant: "danger",
      confirmLabel: "Unfriend",
    });
    if (!ok) return;
    await removeFriend(profile.id);
    setProfile((prev) => (prev ? { ...prev, isFriend: false } : prev));
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
    const tc = TIME_CONTROLS[tcIndex];
    const wagerTokens = Math.min(
      MAX_WAGER_TOKENS,
      Math.max(0, Math.floor(Number(wagerInput) || 0)),
    );
    socket.emit("challenge:send", {
      toUserId: profile.id,
      baseMinutes: tc.baseMinutes,
      incrementSeconds: tc.incrementSeconds,
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
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <RatingBadge
                    category={profile.ratingCategory}
                    gamesUntilRanked={profile.ratedGamesUntilRanked}
                    showProgress={profile.isSelf}
                  />
                  <RatingTierHelpTip />
                </div>
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
              // relationship action (Add friend / Unfriend / pending state)
              // takes the lead, everything else collapses to same-size
              // icon-only buttons alongside it — Watch and Challenge when
              // relevant, and a "more" overflow menu for the one
              // infrequent/meta action (Report), rather than every action
              // competing for attention as its own labeled button.
              <div className="flex items-center gap-2">
                {profile.isFriend ? (
                  <Button
                    variant="glass"
                    className=""
                    onClick={handleUnfriend}
                    aria-label={`Unfriend ${profile.username}`}
                  >
                    <UserMinus className="h-4 w-4" /> Unfriend
                  </Button>
                ) : friendRequestSent ? (
                  <Badge
                    variant="success"
                    className="h-10 flex-1 justify-center py-2! text-sm!"
                  >
                    <Check className="h-3.5 w-3.5" /> Request sent
                  </Badge>
                ) : (
                  <Button
                    className="flex-1"
                    onClick={handleAddFriend}
                    aria-label={`Add ${profile.username} as a friend`}
                  >
                    <UserPlus className="h-4 w-4" /> Add friend
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
                {/* Only friends can be challenged (the server enforces this
                    too — see challenge:send's own isFriend check — this just
                    keeps the UI from offering an action that would only
                    come back as an error). Being in a game right now
                    doesn't hide it, see handleChallenge for that case. */}
                {profile.isFriend && (
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
                      <Select
                        label="Time control"
                        value={tcIndex}
                        onChange={(e) => setTcIndex(Number(e.target.value))}
                      >
                        {TIME_CONTROLS.map((tc, i) => (
                          <option key={tc.label} value={i}>
                            {tc.label}
                          </option>
                        ))}
                      </Select>
                      <Select
                        label="Variant"
                        value={variant}
                        onChange={(e) =>
                          setVariant(e.target.value as "standard" | "chess960")
                        }
                      >
                        <option value="standard">Standard</option>
                        <option value="chess960">
                          Chess960 (Fischer Random)
                        </option>
                      </Select>
                      <Input
                        label={
                          <span className="inline-flex items-center gap-1">
                            <RCoin size={12} /> Coin wager (optional)
                          </span>
                        }
                        type="number"
                        min={0}
                        max={MAX_WAGER_TOKENS}
                        step={1}
                        value={wagerInput}
                        onChange={(e) => setWagerInput(e.target.value)}
                        error={
                          Number(wagerInput) > 0 &&
                          Math.floor(Number(wagerInput) || 0) < MIN_STAKE_TOKENS
                            ? `Enter 0 for a free game, or at least ${MIN_STAKE_TOKENS} R`
                            : undefined
                        }
                      />
                      <Button
                        className="w-full"
                        variant="secondary"
                        onClick={handleChallenge}
                        disabled={
                          Math.floor(Number(wagerInput) || 0) > 0 &&
                          Math.floor(Number(wagerInput) || 0) < MIN_STAKE_TOKENS
                        }
                      >
                        Send
                      </Button>
                    </div>
                  </ResponsiveOverlay>
                )}

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
          {!gamesLoading && games.length === 0 && (
            <p className="text-sm text-base-content/50">No games played yet.</p>
          )}
          <div className="divide-y divide-base-300">
            {games.map((g) => (
              <Link
                key={g.gameId}
                to={`/game/${g.joinCode}`}
                className="flex items-center justify-between gap-3 py-2.5 text-sm transition-colors hover:text-(--primary)"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar
                    username={g.opponent?.username ?? "?"}
                    size="xs"
                    gradient={g.opponent?.avatarGradient}
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-base-content">
                      {g.opponent?.username ?? "Unknown"}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-base-content/40">
                      <span
                        className={
                          g.color === "white"
                            ? "inline-block h-2 w-2 rounded-full border border-base-content/30 bg-white"
                            : "inline-block h-2 w-2 rounded-full border border-base-content/30 bg-black"
                        }
                      />
                      <span className="capitalize">{g.color}</span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <TimeControlIcon
                          baseSeconds={g.timeControl.baseSeconds}
                          size={12}
                        />
                        {formatTimeControl(g.timeControl)}
                      </span>
                      <span>·</span>
                      <span>{g.moveCount} moves</span>
                      <span>·</span>
                      <span>{new Date(g.endedAt).toLocaleDateString()}</span>
                    </p>
                  </div>
                </div>
                <Badge
                  variant={resultVariant[g.result]}
                  className="shrink-0 uppercase"
                >
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
