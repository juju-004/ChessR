import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Search,
  Swords,
  UserPlus,
  Check,
  X,
  TvMinimalPlay,
} from "lucide-react";
import { searchUsers, type UserSearchResult } from "../api/users.js";
import {
  listFriends,
  listIncomingRequests,
  respondToFriendRequest,
  sendFriendRequest,
  type Friend,
  type IncomingRequest,
} from "../api/friends.js";
import { useSocket } from "../contexts/SocketContext.js";
import { TIME_CONTROLS } from "../timeControls.js";
import { MAX_WAGER_TOKENS, MIN_STAKE_TOKENS } from "../lib/limits.js";
import { Page } from "@/components/ui/Page.js";
import { Card } from "@/components/ui/Card.js";
import { Select } from "@/components/ui/Select.js";
import { Input } from "@/components/ui/Input.js";
import { Button } from "@/components/ui/Button.js";
import { Avatar } from "@/components/ui/Avatar.js";
import { RCoin } from "@/components/ui/RCoin.js";
import { ResponsiveOverlay } from "@/components/ui/ResponsiveOverlay.js";
import { RatingBadge } from "@/components/RatingBadge.js";

/** Merged "Players" page, search-for-anyone (the old /find) and your
 *  friends list + requests + challenge form (the old /friends) used to be
 *  two separate pages, but they're really one workflow: find someone,
 *  friend them, then challenge them, splitting that across a nav switch
 *  just added a click in the middle of it. Search results now also get an
 *  inline "Add friend" action, which /find never had. */
export function Players() {
  const socket = useSocket();
  const navigate = useNavigate();
  const [requests, setRequests] = useState<IncomingRequest[]>([]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [friendSearch, setFriendSearch] = useState("");
  const [tcIndex, setTcIndex] = useState(2);
  const [variant, setVariant] = useState<"standard" | "chess960">("standard");
  const [wagerInput, setWagerInput] = useState("20");
  const [status, setStatus] = useState<{
    message: string;
    isError: boolean;
  } | null>(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [searchError, setSearchError] = useState("");
  const [sentRequestIds, setSentRequestIds] = useState<Set<string>>(new Set());
  /** Which friend's row currently has its challenge overlay open, null
   *  means none. Only one at a time, so a single piece of state (rather
   *  than a per-friend open flag) is enough, and it lets the "Send
   *  challenge" button close its own overlay after sending. */
  const [challengingFriendId, setChallengingFriendId] = useState<string | null>(
    null,
  );

  const refreshRequests = useCallback(() => {
    listIncomingRequests().then((res) => setRequests(res.requests));
  }, []);

  const refreshFriends = useCallback(() => {
    listFriends().then((res) => setFriends(res.friends));
  }, []);

  useEffect(() => {
    refreshRequests();
    refreshFriends();
  }, [refreshRequests, refreshFriends]);

  useEffect(() => {
    if (!socket) return;

    function onRequestReceived() {
      refreshRequests();
    }
    function onPresence() {
      refreshFriends();
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

    socket.on("friend:request_received", onRequestReceived);
    socket.on("friend:presence", onPresence);
    socket.on("challenge:sent", onSent);
    socket.on("challenge:error", onError);

    return () => {
      socket.off("friend:request_received", onRequestReceived);
      socket.off("friend:presence", onPresence);
      socket.off("challenge:sent", onSent);
      socket.off("challenge:error", onError);
    };
  }, [socket, refreshFriends]);

  async function handleAccept(requestId: string) {
    await respondToFriendRequest(requestId, true);
    refreshRequests();
    refreshFriends();
  }

  async function handleDecline(requestId: string) {
    await respondToFriendRequest(requestId, false);
    refreshRequests();
  }

  function handleChallenge(friendId: string) {
    if (!socket) return;
    const tc = TIME_CONTROLS[tcIndex];
    const wagerTokens = Math.min(
      MAX_WAGER_TOKENS,
      Math.max(MIN_STAKE_TOKENS, Math.floor(Number(wagerInput) || 0)),
    );
    socket.emit("challenge:send", {
      toUserId: friendId,
      baseMinutes: tc.baseMinutes,
      incrementSeconds: tc.incrementSeconds,
      variant,
      wagerTokens,
    });
    setStatus({
      message: `Challenge sent (${tc.label}${variant === "chess960" ? ", Chess960" : ""}, ${wagerTokens} R wager). Waiting for a response…`,
      isError: false,
    });
    setChallengingFriendId(null);
  }

  function handleSearchChange(value: string) {
    setQuery(value);
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

  async function handleAddFriend(userId: string) {
    await sendFriendRequest(userId);
    setSentRequestIds((prev) => new Set(prev).add(userId));
  }

  // Search matches on username substring (case-insensitive); sort mode
  // "online" groups online friends first (alphabetical within each group)
  // so the people you can actually challenge right now surface without
  // hunting through a long offline list, "alphabetical" ignores online
  // status entirely for a straight a-z list.
  const visibleFriends = useMemo(() => {
    const q = friendSearch.trim().toLowerCase();
    const filtered = q
      ? friends.filter((f) => f.username.toLowerCase().includes(q))
      : friends;
    return [...filtered].sort((a) => {
      return a.online ? -1 : 1;
    });
  }, [friends, friendSearch]);

  const friendIds = useMemo(() => new Set(friends.map((f) => f.id)), [friends]);

  return (
    <Page
      title="Players"
      description="Search for anyone, manage friends, and send challenges."
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
            <Search className="h-4 w-4 text-base-content/50" /> Search players
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
            {results.map((u) => {
              const alreadyFriend = friendIds.has(u._id);
              const requestSent = sentRequestIds.has(u._id);
              return (
                <div
                  key={u._id}
                  onClick={() => navigate(`/profile/${u.username}`)}
                  className="-mx-2 flex cursor-pointer flex-wrap items-center justify-between gap-2 rounded-lg border-b border-base-300 px-2 py-2 transition-colors last:border-none hover:bg-base-100/60"
                >
                  <span className="flex min-w-0 items-center gap-2.5 text-sm text-base-content">
                    <Avatar
                      username={u.username}
                      size="sm"
                      gradient={u.avatarGradient}
                    />
                    <span className="truncate">{u.username}</span>
                    <RatingBadge
                      className="md:hidden"
                      compact
                      category={u.ratingCategory}
                    />
                    <RatingBadge
                      className="hidden! md:flex!"
                      category={u.ratingCategory}
                    />
                  </span>
                  <span
                    className="flex flex-wrap gap-2"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {!alreadyFriend && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={requestSent}
                        onClick={() => handleAddFriend(u._id)}
                      >
                        {requestSent ? (
                          <>
                            <Check className="h-4 w-4" /> Sent
                          </>
                        ) : (
                          <>
                            <UserPlus className="h-4 w-4" />{" "}
                            <span className="hidden sm:flex">Add friend</span>
                          </>
                        )}
                      </Button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card variant="solid">
          <h1 className="mb-2 text-lg font-semibold text-base-content">
            Friend requests
          </h1>
          {requests.length === 0 && (
            <p className="text-sm text-base-content/60">No pending requests.</p>
          )}
          {requests.map((r) => (
            <div
              key={r._id}
              onClick={() => navigate(`/profile/${r.from.username}`)}
              className="-mx-2 flex cursor-pointer flex-wrap items-center justify-between gap-2 rounded-lg border-b border-base-300 px-2 py-2 transition-colors last:border-none hover:bg-base-100/60"
            >
              <span className="flex min-w-0 items-center gap-2.5 text-sm text-base-content">
                <Avatar
                  username={r.from.username}
                  size="sm"
                  gradient={r.from.avatarGradient}
                />
                <span className="truncate">{r.from.username}</span>
                <RatingBadge
                  className="md:hidden"
                  compact
                  category={r.from.ratingCategory}
                />
                <RatingBadge
                  className="hidden! md:flex!"
                  category={r.from.ratingCategory}
                />
              </span>
              <span
                className="flex flex-wrap gap-2"
                onClick={(e) => e.stopPropagation()}
              >
                <Button size="sm" onClick={() => handleAccept(r._id)}>
                  <Check className="h-4 w-4" />
                  <span className="hidden sm:flex">Accept</span>
                </Button>
                <Button
                  variant="glass"
                  size="sm"
                  onClick={() => handleDecline(r._id)}
                >
                  <X className="h-4 w-4" />
                  <span className="hidden sm:flex">Decline</span>
                </Button>
              </span>
            </div>
          ))}
        </Card>

        <Card variant="solid" className="w-full">
          <h1 className="mb-3 text-lg font-semibold text-base-content">
            Friends
          </h1>

          <div className="mb-3.5 flex gap-2 sm:items-end">
            <div className="flex-1">
              <Input
                value={friendSearch}
                onChange={(e) => setFriendSearch(e.target.value)}
                placeholder="Find a friend by username…"
                leadingIcon={<Search className="h-4 w-4" />}
              />
            </div>
          </div>

          {friends.length === 0 && (
            <p className="text-sm text-base-content/60">
              No friends yet. Search for players above and add some!
            </p>
          )}
          {friends.length > 0 && visibleFriends.length === 0 && (
            <p className="text-sm text-base-content/60">
              No friends match "{friendSearch}".
            </p>
          )}
          {visibleFriends.map((f) => (
            <div
              key={f.id}
              onClick={() => navigate(`/profile/${f.username}`)}
              className="-mx-2  flex cursor-pointer flex-wrap items-center justify-between gap-2 rounded-lg border-b border-base-300 px-2 py-2 transition-colors last:border-none hover:bg-base-100/60!"
            >
              <span className="flex min-w-0 items-center gap-2.5 text-sm text-base-content">
                <Avatar
                  username={f.username}
                  size="sm"
                  gradient={f.avatarGradient}
                  status={f.online ? "online" : "offline"}
                />
                <span className="truncate">{f.username}</span>
                <RatingBadge
                  className="md:hidden"
                  compact
                  category={f.ratingCategory}
                />
                <RatingBadge
                  className="hidden! md:flex!"
                  category={f.ratingCategory}
                />
              </span>
              <span
                className="flex flex-wrap gap-2"
                onClick={(e) => e.stopPropagation()}
              >
                {f.activeGameCode ? (
                  <Link to={`/game/`}>
                    <Button variant="glass" size="sm">
                      <TvMinimalPlay className="h-4 w-4" />{" "}
                      <span className="hidden! sm:flex">Watch</span>
                    </Button>
                  </Link>
                ) : (
                  // Time control/variant/wager (for a live challenge) and
                  // the cage match option both live in this one overlay now
                  //, settings persist across friends (same tcIndex/
                  // variant/wagerInput state) so re-challenging someone
                  // with the same setup is still one click. The trigger
                  // itself stays open-able even when the friend's offline
                  // (a cage match invite doesn't need them online right
                  // now the way an instant challenge does), only "Send
                  // challenge" is gated on presence.
                  <ResponsiveOverlay
                    title={`Challenge ${f.username}`}
                    align="end"
                    className="w-72 max-w-[calc(100vw-2rem)]"
                    open={challengingFriendId === f.id}
                    onOpenChange={(open) =>
                      setChallengingFriendId(open ? f.id : null)
                    }
                    icon={<Swords></Swords>}
                    trigger={
                      <Button size="sm" variant="secondary">
                        <Swords className="size-3" />
                        <span className="sm:flex hidden">Challenge</span>
                      </Button>
                    }
                  >
                    <div className="space-y-3 px-4 md:px-2">
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
                            <RCoin size={12} /> Coin wager (per player)
                          </span>
                        }
                        type="number"
                        min={MIN_STAKE_TOKENS}
                        max={MAX_WAGER_TOKENS}
                        step={1}
                        value={wagerInput}
                        onChange={(e) => setWagerInput(e.target.value)}
                      />

                      <Button
                        className="w-full"
                        variant="secondary"
                        onClick={() => handleChallenge(f.id)}
                        disabled={
                          !f.online ||
                          Math.floor(Number(wagerInput) || 0) < MIN_STAKE_TOKENS
                        }
                      >
                        {f.online ? "Send challenge" : "Friend is offline"}
                      </Button>

                      <Link
                        to={`/cage/new?challenge=${f.id}`}
                        className="block"
                        onClick={() => setChallengingFriendId(null)}
                      >
                        <Button variant="glass" className="w-full">
                          <Swords className="h-4 w-4" /> Cage match instead
                        </Button>
                      </Link>
                    </div>
                  </ResponsiveOverlay>
                )}
              </span>
            </div>
          ))}
        </Card>
      </div>
    </Page>
  );
}
