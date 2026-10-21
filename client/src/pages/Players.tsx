import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Search,
  Swords,
  UserPlus,
  UserMinus,
  Check,
  TvMinimalPlay,
} from "lucide-react";
import {
  searchUsers,
  listOnlinePlayers,
  type UserSearchResult,
} from "../api/users.js";
import {
  listFollowing,
  listFollowers,
  followUser,
  unfollowUser,
  type PlayerSummary,
} from "../api/follows.js";
import { useSocket } from "../contexts/SocketContext.js";
import { Page } from "@/components/ui/Page.js";
import { Card } from "@/components/ui/Card.js";
import { Input } from "@/components/ui/Input.js";
import { Button } from "@/components/ui/Button.js";
import { ResponsiveOverlay } from "@/components/ui/ResponsiveOverlay.js";
import { CenteredSpinner } from "@/components/ui/CenteredSpinner.js";
import { Tabs } from "@/components/ui/Tabs.js";
import { PlayerRow } from "@/components/lists/PlayerRow.js";
import {
  GameSettingsFields,
  useGameSettings,
} from "@/components/game/GameSettingsFields.js";
import { claimToast } from "../lib/toastClaims.js";

type FollowTab = "following" | "followers";

const SEARCH_PAGE_SIZE = 5;

/** Merged "Players" page: search for anyone, follow players (Lichess style,
 *  one-way and instant, no request to accept), see who follows you, and
 *  challenge any player. */
export function Players() {
  const socket = useSocket();
  const navigate = useNavigate();
  const [following, setFollowing] = useState<PlayerSummary[]>([]);
  const [followers, setFollowers] = useState<PlayerSummary[]>([]);
  const [tab, setTab] = useState<FollowTab>("following");
  // True only until the very first fetch resolves; background refreshes on
  // presence events shouldn't re-flash a spinner over an already-loaded list.
  const [listsLoading, setListsLoading] = useState(true);
  // Top online players (excluding you), see GET /users/online/players. Empty
  // until the first fetch resolves, and the whole card stays hidden while
  // it's empty, so there's no loading state to render.
  const [onlinePlayers, setOnlinePlayers] = useState<PlayerSummary[]>([]);
  const [listSearch, setListSearch] = useState("");
  const gameSettings = useGameSettings(2);
  const [status, setStatus] = useState<{
    message: string;
    isError: boolean;
  } | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  // Search results are shown SEARCH_PAGE_SIZE at a time, "Show more" adds
  // another batch.
  const [shownResults, setShownResults] = useState(SEARCH_PAGE_SIZE);
  const [searchError, setSearchError] = useState("");
  /** Players with a follow/unfollow request in flight, so a double tap can't
   *  fire it twice. */
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  /** Which row currently has its challenge overlay open, null means none.
   *  Only one at a time, so a single piece of state (rather than a per-row
   *  open flag) is enough, and it lets the "Send challenge" button close
   *  its own overlay after sending. Keyed by list + player id, since the
   *  same player can appear in more than one list at once (online players
   *  and following, say) and only the row that was clicked should open. */
  const [challengingKey, setChallengingKey] = useState<string | null>(null);

  const refreshFollowing = useCallback(() => {
    return listFollowing()
      .then((res) => setFollowing(res.following))
      .catch(() => {
        // Keep showing what we had on a failed background refresh.
      });
  }, []);

  const refreshFollowers = useCallback(() => {
    return listFollowers()
      .then((res) => setFollowers(res.followers))
      .catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([refreshFollowing(), refreshFollowers()]).finally(() =>
      setListsLoading(false),
    );
  }, [refreshFollowing, refreshFollowers]);

  const refreshOnlinePlayers = useCallback(() => {
    listOnlinePlayers()
      .then((res) => setOnlinePlayers(res.players))
      .catch(() => {
        // Non-essential card: on a failed refresh keep showing what we had.
      });
  }, []);

  // Only players you follow get a live presence push (follow:presence), so everyone
  // else's online/offline changes are picked up by a light poll instead,
  // paused while the tab is hidden, plus an immediate refresh on return.
  useEffect(() => {
    refreshOnlinePlayers();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refreshOnlinePlayers();
    }, 30_000);
    function onVisible() {
      if (document.visibilityState === "visible") refreshOnlinePlayers();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshOnlinePlayers]);

  useEffect(() => {
    if (!socket) return;

    // Someone you follow (or, on the Followers tab, someone who follows
    // you) came online / went offline. Only the visible list is refetched.
    function onPresence() {
      if (tab === "following") void refreshFollowing();
      else void refreshFollowers();
      refreshOnlinePlayers();
    }
    // Someone just followed you: keep the Followers list and count current.
    function onFollowed() {
      void refreshFollowers();
    }
    function onSent() {
      setStatus({
        message: "Challenge sent. Waiting for a response…",
        isError: false,
      });
    }
    function onError(payload: { message: string }) {
      setStatus({ message: payload.message, isError: true });
    }

    socket.on("follow:presence", onPresence);
    socket.on("follow:new", onFollowed);
    socket.on("challenge:sent", onSent);
    const release0 = claimToast("challenge:error");
    socket.on("challenge:error", onError);

    return () => {
      socket.off("follow:presence", onPresence);
      socket.off("follow:new", onFollowed);
      socket.off("challenge:sent", onSent);
      release0();
      socket.off("challenge:error", onError);
    };
  }, [socket, tab, refreshFollowing, refreshFollowers, refreshOnlinePlayers]);

  function handleChallenge(targetId: string) {
    if (!socket) return;
    // Wagers are opt-in: 0 = a free game.
    const { timeControl: tc, variant, wagerTokens } = gameSettings;
    socket.emit("challenge:send", {
      toUserId: targetId,
      baseMinutes: tc.baseMinutes,
      incrementSeconds: tc.incrementSeconds,
      variant,
      wagerTokens,
    });
    setStatus({
      message: `Challenge sent. Waiting for a response…`,
      isError: false,
    });
    setChallengingKey(null);
  }

  function handleSearchChange(value: string) {
    setQuery(value);
    setShownResults(SEARCH_PAGE_SIZE);
    if (!value.trim()) {
      setResults([]);
      return;
    }
    searchUsers(value.trim())
      .then((res) => {
        setResults(res.users);
        setSearchError("");
      })
      .catch(() => setSearchError("Search failed."));
  }

  async function toggleFollow(userId: string, follow: boolean) {
    if (busyIds.has(userId)) return;
    setBusyIds((prev) => new Set(prev).add(userId));
    try {
      if (follow) await followUser(userId);
      else await unfollowUser(userId);
      // Both lists carry an `isFollowing` flag / membership that changed.
      await Promise.all([refreshFollowing(), refreshFollowers()]);
    } catch {
      // Non-fatal: the button stays as it was so they can retry.
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  }

  // Search matches on username substring (case-insensitive). Online players
  // come first so the people you can actually challenge right now surface
  // without hunting through a long offline list; the server order (most
  // recent follow first) is kept within each group.
  const activeList = tab === "following" ? following : followers;
  const visibleList = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    const filtered = q
      ? activeList.filter((f) => f.username.toLowerCase().includes(q))
      : activeList;
    return [...filtered].sort((a, b) => Number(b.online) - Number(a.online));
  }, [activeList, listSearch]);

  const followingIds = useMemo(
    () => new Set(following.map((f) => f.id)),
    [following],
  );

  /** Watch (if they're mid-game) or Challenge, shared by every list on this
   *  page (search results, online players, following, followers), since anyone can
   *  challenge anyone, followed or not. Time control/variant/wager (for a live
   *  challenge) and the cage match option both live in the one overlay;
   *  those settings persist across players (same tcIndex/variant/wagerInput
   *  state) so re-challenging with the same setup is still one click. The
   *  trigger itself stays open-able even when the player's offline (a cage
   *  match invite doesn't need them online right now the way an instant
   *  challenge does), only "Send" is gated on presence. */
  function renderPlayerAction(
    p: {
      id: string;
      username: string;
      online: boolean;
      activeGameCode?: string | null;
    },
    list: string,
  ) {
    if (p.activeGameCode) {
      return (
        <Link to={`/game/${p.activeGameCode}`}>
          <Button variant="glass" size="sm">
            <TvMinimalPlay className="h-4 w-4" />{" "}
            <span className="hidden! sm:flex">Watch</span>
          </Button>
        </Link>
      );
    }
    const key = `${list}:${p.id}`;
    return (
      <ResponsiveOverlay
        title={`Challenge ${p.username}`}
        align="end"
        className="w-72 max-w-[calc(100vw-2rem)]"
        open={challengingKey === key}
        onOpenChange={(open) => setChallengingKey(open ? key : null)}
        icon={<Swords></Swords>}
        trigger={
          <Button size="sm" variant="secondary">
            <Swords className="size-3" />
            <span className="sm:flex hidden">Challenge</span>
          </Button>
        }
      >
        <div className="space-y-3 px-4 md:px-2">
          <GameSettingsFields settings={gameSettings} />
          <span className="w-full gap-2 grid grid-cols-2">
            <Button
              variant="secondary"
              onClick={() => handleChallenge(p.id)}
              disabled={!p.online || gameSettings.wagerBelowFloor}
            >
              {p.online ? "Send" : "offline"}
            </Button>

            <Link
              to={`/cage/new?challenge=${p.id}&name=${encodeURIComponent(p.username)}`}
              onClick={() => setChallengingKey(null)}
            >
              <Button variant="glass" className="w-full">
                <Swords className="h-4 w-4" /> Cage
              </Button>
            </Link>
          </span>
        </div>
      </ResponsiveOverlay>
    );
  }

  return (
    <Page
      playersPage
      title="Players"
      description="Search for anyone, follow players, and challenge any player."
    >
      <div className="space-y-4">
        {status && (
          <p
            className={`text-sm ${status.isError ? "text-red-400" : "text-green-400"}`}
          >
            {status.message}
          </p>
        )}

        <Card variant="solid">
          <h1 className="mb-2 flex items-center gap-2 text-lg font-semibold text-base-content">
            Search players
          </h1>
          <Input
            type="text"
            placeholder=""
            value={query}
            onChange={(e) => handleSearchChange(e.target.value)}
            leadingIcon={<Search className="h-4 w-4 mb-3.5" />}
            className="mb-3.5"
          />

          {searchError && (
            <p className="mt-3 text-sm text-red-400">{searchError}</p>
          )}
          {results.length === 0 && query.trim() && !searchError && (
            <p className="mt-3 text-sm text-base-content/50">No users found.</p>
          )}

          <div>
            {results.slice(0, shownResults).map((u) => {
              const isFollowing = followingIds.has(u._id);
              const busy = busyIds.has(u._id);
              return (
                <PlayerRow
                  key={u._id}
                  username={u.username}
                  avatarGradient={u.avatarGradient}
                  rating={u.rating}
                  ratingCategory={u.ratingCategory}
                  onClick={() => navigate(`/profile/${u.username}`)}
                  actions={
                    isFollowing ? (
                      <Button variant="glass" size="sm" disabled>
                        <Check className="h-4 w-4" />{" "}
                        <span className="hidden sm:flex">Following</span>
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => toggleFollow(u._id, true)}
                      >
                        <UserPlus className="h-4 w-4" />{" "}
                        <span className="hidden sm:flex">Follow</span>
                      </Button>
                    )
                  }
                />
              );
            })}
            {results.length > shownResults && (
              <Button
                variant="glass"
                size="sm"
                className="mt-2 w-full"
                onClick={() => setShownResults((n) => n + SEARCH_PAGE_SIZE)}
              >
                Show more ({results.length - shownResults} more)
              </Button>
            )}
          </div>
        </Card>

        {onlinePlayers.length > 0 && (
          <Card variant="solid" className="w-full">
            <h1 className="mb-3 text-lg font-semibold text-base-content">
              Online players
            </h1>
            {onlinePlayers.map((p) => (
              <PlayerRow
                key={p.id}
                username={p.username}
                avatarGradient={p.avatarGradient}
                online
                rating={p.rating}
                ratingCategory={p.ratingCategory}
                onClick={() => navigate(`/profile/${p.username}`)}
                actions={renderPlayerAction(p, "online")}
              />
            ))}
          </Card>
        )}

        <Card variant="solid" className="w-full">
          <Tabs
            className="mb-3.5"
            items={[
              {
                value: "following",
                label: `Following${following.length > 0 ? ` (${following.length})` : ""}`,
              },
              {
                value: "followers",
                label: `Followers${followers.length > 0 ? ` (${followers.length})` : ""}`,
              },
            ]}
            value={tab}
            onChange={(v) => {
              setTab(v as FollowTab);
              setListSearch("");
              // Presence can have moved while the other tab was hidden.
              if (v === "following") void refreshFollowing();
              else void refreshFollowers();
            }}
          />

          <div className="mb-3.5 flex gap-2 sm:items-end">
            <div className="flex-1">
              <Input
                value={listSearch}
                onChange={(e) => setListSearch(e.target.value)}
                placeholder="Find a player by username…"
                leadingIcon={<Search className="h-4 w-4" />}
              />
            </div>
          </div>

          {listsLoading ? (
            <CenteredSpinner className="py-6" />
          ) : (
            <>
              {activeList.length === 0 && (
                <p className="text-sm text-base-content/60">
                  {tab === "following"
                    ? "You're not following anyone yet. Search for players above and follow some!"
                    : "No followers yet."}
                </p>
              )}
              {activeList.length > 0 && visibleList.length === 0 && (
                <p className="text-sm text-base-content/60">
                  No players match "{listSearch}".
                </p>
              )}
              {visibleList.map((p) => (
                <PlayerRow
                  key={p.id}
                  username={p.username}
                  avatarGradient={p.avatarGradient}
                  online={p.online}
                  rating={p.rating}
                  ratingCategory={p.ratingCategory}
                  onClick={() => navigate(`/profile/${p.username}`)}
                  actions={
                    <div className="flex items-center gap-1.5">
                      {tab === "following" ? (
                        <Button
                          variant="glass"
                          size="sm"
                          disabled={busyIds.has(p.id)}
                          onClick={() => toggleFollow(p.id, false)}
                          aria-label={`Unfollow ${p.username}`}
                        >
                          <UserMinus className="h-4 w-4" />
                        </Button>
                      ) : (
                        !p.isFollowing && (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busyIds.has(p.id)}
                            onClick={() => toggleFollow(p.id, true)}
                          >
                            <UserPlus className="h-4 w-4" />{" "}
                            <span className="hidden sm:flex">Follow back</span>
                          </Button>
                        )
                      )}
                      {renderPlayerAction(p, tab)}
                    </div>
                  }
                />
              ))}
            </>
          )}
        </Card>
      </div>
    </Page>
  );
}
