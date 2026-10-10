import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Layers } from "lucide-react";
import {
  listOpenTournaments,
  listMyTournaments,
  listMyFinishedTournaments,
  FINISHED_PAGE_SIZE,
  type Tournament,
} from "../api/tournaments.js";
import {
  getMyOrganization,
  type MyOrganization,
} from "../api/organizations.js";
import {
  listLeagues,
  createLeague,
  MIN_LEAGUE_TOURNAMENTS,
  MAX_LEAGUE_TOURNAMENTS,
  type LeagueSummary,
} from "../api/leagues.js";
import { errMsg } from "../lib/errMsg.js";
import { MAX_EVENT_NAME_LENGTH } from "../lib/limits.js";
import { useSocket } from "../contexts/SocketContext.js";
import { useAuth } from "../contexts/AuthContext.js";
import { Pagination } from "../components/Pagination.js";
import { TournamentRow } from "../components/tournaments/TournamentRow.js";
import { RefreshButton } from "../components/RefreshButton.js";
import {
  Page,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Badge,
  EmojiInput,
  Input,
  Textarea,
  Modal,
  Spinner,
} from "../components/ui/index.js";

// Client-side page size for the Open tournaments list, which already
// returns its (small, capped) set in one request, so this just slices the
// array that's already in memory. The Finished list is different: it grows
// forever, so it's fetched from the server 5 at a time behind a "Load more"
// button (see listMyFinishedTournaments and FinishedTournamentCard below).
const PAGE_SIZE = 8;

/** A card of tournament rows with its own local page state, used for the
 *  two lists that can realistically grow long (Open tournaments, Finished
 *  tourneys). Active tourneys / in-progress stay unpaginated since there's
 *  rarely more than a handful at once. */
function PaginatedTournamentCard({
  title,
  tournaments,
  emptyMessage,
  onRefresh,
  refreshing,
  loading = false,
}: {
  title: string;
  tournaments: Tournament[];
  emptyMessage: string;
  /** True until the list's first fetch resolves. Shows a spinner instead of
   *  the empty message / rows, otherwise the card briefly claims "Nothing
   *  finished yet" (the state's initial []) before the real list lands. */
  loading?: boolean;
  /** Omit to render the card without a refresh button (e.g. Finished
   *  tourneys, which doesn't need one). */
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(tournaments.length / PAGE_SIZE));
  // Clamp rather than reset to 0 outright, keeps you on the same page
  // after a list shrinks by one (e.g. a tournament you were tracking just
  // finished and moved lists) instead of always bouncing back to page 1.
  const safePage = Math.min(page, pageCount - 1);
  const pageItems = tournaments.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );

  return (
    <Card variant="solid">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {onRefresh && (
          <RefreshButton onRefresh={onRefresh} refreshing={!!refreshing} />
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner className="text-base-content/40" />
          </div>
        ) : (
          <>
            {tournaments.length === 0 && (
              <p className="text-sm text-base-content/50">{emptyMessage}</p>
            )}
            {pageItems.map((t) => (
              <TournamentRow key={t._id} t={t} />
            ))}
            <Pagination
              page={safePage}
              pageCount={pageCount}
              onPageChange={setPage}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Finished tournaments card. No pager: it shows the newest few and a
 *  "Load more" button appends the next batch underneath. Each batch is its
 *  own request (5 tournaments), so only what you've scrolled to ever travels
 *  over the wire however many you've finished. */
function FinishedTournamentCard({
  title,
  tournaments,
  hasMore,
  loadingMore,
  onLoadMore,
  emptyMessage,
  loading,
}: {
  title: string;
  tournaments: Tournament[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  emptyMessage: string;
  /** True only until the first batch arrives. */
  loading: boolean;
}) {
  return (
    <Card variant="solid">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner className="text-base-content/40" />
          </div>
        ) : (
          <>
            {tournaments.length === 0 && (
              <p className="text-sm text-base-content/50">{emptyMessage}</p>
            )}
            {tournaments.map((t) => (
              <TournamentRow key={t._id} t={t} hideFinishedBadgeOnMobile />
            ))}
            {hasMore && (
              <Button
                variant="ghost"
                size="sm"
                fullWidth
                loading={loadingMore}
                onClick={onLoadMore}
              >
                Load more
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** Leagues. Every league stays listed here; opening
 *  one shows its running league table and its stages. Approved organisations
 *  get a "New" button to start a league. */
function LeagueCard({
  leagues,
  loading,
  canCreate,
  onCreate,
}: {
  leagues: LeagueSummary[];
  loading: boolean;
  canCreate: boolean;
  onCreate: () => void;
}) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(leagues.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const items = leagues.slice(
    safePage * PAGE_SIZE,
    safePage * PAGE_SIZE + PAGE_SIZE,
  );
  return (
    <Card variant="solid">
      <CardHeader>
        <CardTitle>Leagues</CardTitle>
        {canCreate && (
          <Button variant="secondary" size="sm" onClick={onCreate}>
            <Plus className="h-4 w-4" />
            New
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          <div className="flex justify-center py-6">
            <Spinner className="text-base-content/40" />
          </div>
        ) : (
          <>
            {leagues.length === 0 && (
              <p className="text-sm text-base-content/50">
                No leagues yet. A league is a series of tournaments whose points
                add up into one table.
              </p>
            )}
            {items.map((c) => (
              <Link
                key={c.id}
                to={`/leagues/${c.id}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-base-300 bg-base-100/60 px-3 py-2.5 transition-colors hover:border-(--primary)/40"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Layers className="h-4 w-4 shrink-0 text-(--primary)" />
                    <span className="min-w-0 font-medium wrap-break-word text-base-content">
                      {c.name}
                    </span>
                    {c.mine && <Badge variant="primary">Yours</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-base-content/50">
                    {c.organizationName} · {c.tournamentCount} of{" "}
                    {c.maxTournaments}{" "}
                    {c.tournamentCount === 1 ? "tournament" : "tournaments"}
                  </div>
                </div>
              </Link>
            ))}
            <Pagination
              page={safePage}
              pageCount={pageCount}
              onPageChange={setPage}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CreateLeagueModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [limitInput, setLimitInput] = useState(String(MAX_LEAGUE_TOURNAMENTS));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (name.trim().length < 3)
      return setError("Give it a name (3+ characters).");
    const maxTournaments = Math.floor(Number(limitInput));
    if (
      !Number.isFinite(maxTournaments) ||
      maxTournaments < MIN_LEAGUE_TOURNAMENTS ||
      maxTournaments > MAX_LEAGUE_TOURNAMENTS
    )
      return setError(
        `Choose between ${MIN_LEAGUE_TOURNAMENTS} and ${MAX_LEAGUE_TOURNAMENTS} tournaments.`,
      );
    setBusy(true);
    setError("");
    try {
      await createLeague({
        name: name.trim(),
        description: description.trim() || null,
        maxTournaments,
      });
      setName("");
      setDescription("");
      onCreated();
      onClose();
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New league" icon={<Layers />}>
      <div className="space-y-3">
        <p className="text-xs text-base-content/60">
          A series of Swiss or Arena tournaments. Players join each tournament
          separately and their points carry forward into one league table.
        </p>
        <EmojiInput
          label="Name"
          value={name}
          onChange={setName}
          maxLength={MAX_EVENT_NAME_LENGTH}
          placeholder="Season 1 League"
        />
        <Input
          label="Number of tournaments"
          type="number"
          min={MIN_LEAGUE_TOURNAMENTS}
          max={MAX_LEAGUE_TOURNAMENTS}
          value={limitInput}
          onChange={(e) => setLimitInput(e.target.value)}
          hint={`How many tournaments this league will have (${MIN_LEAGUE_TOURNAMENTS}-${MAX_LEAGUE_TOURNAMENTS}). It can't be changed later.`}
        />
        <Textarea
          label="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={500}
          rows={3}
        />
        {error && <p className="text-sm text-red-400">{error}</p>}
        <Button variant="secondary" fullWidth onClick={submit} disabled={busy}>
          {busy ? "Creating…" : "Create league"}
        </Button>
      </div>
    </Modal>
  );
}

export function Tournaments() {
  const socket = useSocket();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState<Tournament[]>([]);
  const [mine, setMine] = useState<Tournament[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  // True only until each list's FIRST fetch settles (success or failure),
  // background refreshes from socket events never flip these back, so an
  // already-loaded list doesn't flash a spinner every time it updates.
  const [openLoading, setOpenLoading] = useState(true);
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [leaguesLoading, setLeaguesLoading] = useState(true);
  const [createLeagueOpen, setCreateLeagueOpen] = useState(false);
  // Team battles are for approved organisations only: the button below only
  // shows for them, everyone else gets a pointer to the request form.
  const [org, setOrg] = useState<MyOrganization | null>(null);
  useEffect(() => {
    if (!user) return;
    getMyOrganization()
      .then((r) => setOrg(r.organization))
      .catch(() => setOrg(null));
  }, [user]);
  // Finished list: newest first, loaded 5 at a time and appended by "Load
  // more". `finishedTotal` is the server's full count, so the button shows
  // only while there's more to fetch.
  const [finished, setFinished] = useState<Tournament[]>([]);
  const [finishedTotal, setFinishedTotal] = useState(0);
  const [finishedLoading, setFinishedLoading] = useState(true);
  const [finishedLoadingMore, setFinishedLoadingMore] = useState(false);
  // Latest length for loadMore to read without it being a dependency.
  const finishedLenRef = useRef(0);

  // Merges a freshly fetched batch into what's already loaded: the batch
  // goes first (it's the newest data for those rows), then anything loaded
  // earlier that the batch doesn't repeat, keeping its order.
  const mergeFinished = useCallback((batch: Tournament[]) => {
    setFinished((prev) => {
      const seen = new Set(batch.map((t) => t._id));
      const next = [...batch, ...prev.filter((t) => !seen.has(t._id))];
      finishedLenRef.current = next.length;
      return next;
    });
  }, []);

  // Refresh path: re-reads the first batch only, so a tournament that just
  // finished shows up on top without reloading everything you've scrolled.
  const loadFinished = useCallback(() => {
    return listMyFinishedTournaments(1)
      .then((res) => {
        mergeFinished(res.tournaments);
        setFinishedTotal(res.total);
      })
      .finally(() => setFinishedLoading(false));
  }, [mergeFinished]);

  const handleLoadMoreFinished = useCallback(() => {
    // floor(len / size) + 1 never skips a row even if the list shifted by a
    // newly finished tournament since the last fetch (an overlap is deduped).
    const nextPage = Math.floor(finishedLenRef.current / FINISHED_PAGE_SIZE) + 1;
    setFinishedLoadingMore(true);
    listMyFinishedTournaments(nextPage)
      .then((res) => {
        mergeFinished(res.tournaments);
        setFinishedTotal(res.total);
      })
      .catch(() => undefined)
      .finally(() => setFinishedLoadingMore(false));
  }, [mergeFinished]);

  const refresh = useCallback(() => {
    const tasks: Promise<unknown>[] = [
      listOpenTournaments()
        .then((res) => setOpen(res.tournaments))
        .finally(() => setOpenLoading(false)),
      listLeagues()
        .then((res) => setLeagues(res.leagues))
        .catch(() => undefined)
        .finally(() => setLeaguesLoading(false)),
    ];
    if (user) {
      tasks.push(listMyTournaments().then((res) => setMine(res.tournaments)));
      tasks.push(loadFinished());
    } else {
      setFinishedLoading(false);
    }
    return Promise.all(tasks);
  }, [user, loadFinished]);

  const handleManualRefresh = useCallback(() => {
    setRefreshing(true);
    refresh().finally(() => setRefreshing(false));
  }, [refresh]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!socket) return;
    socket.on("tournament:update", refresh);
    socket.on("tournament:started", refresh);
    socket.on("tournament:cancelled", refresh);
    return () => {
      socket.off("tournament:update", refresh);
      socket.off("tournament:started", refresh);
      socket.off("tournament:cancelled", refresh);
    };
  }, [socket, refresh]);

  const openPending = useMemo(
    () => open.filter((t) => t.status === "pending"),
    [open],
  );
  const openActive = useMemo(
    () => open.filter((t) => t.status === "active"),
    [open],
  );
  // "Active tourneys", yours, currently pending or under way, i.e.
  // anything you'd still want to check in on. Split out from "Finished
  // tourneys" below so the two don't get mixed together under one
  // ever-growing list.
  const mineActive = useMemo(
    () => mine.filter((t) => t.status === "pending" || t.status === "active"),
    [mine],
  );

  return (
    <Page
      title="Tournaments"
      responsiveDescription
      description="Run a knockout bracket, a swiss or arena event, or a round-robin."
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate("/tournaments/new")}
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Create tournament</span>
            <span className="sm:hidden">New</span>
          </Button>
        </div>
      }
    >
      <div className="mx-auto space-y-4">
        <PaginatedTournamentCard
          title="Open"
          tournaments={openPending}
          emptyMessage="No public tournaments waiting for players right now."
          onRefresh={handleManualRefresh}
          refreshing={refreshing}
          loading={openLoading}
        />

        <LeagueCard
          leagues={leagues}
          loading={leaguesLoading}
          canCreate={org?.status === "approved"}
          onCreate={() => setCreateLeagueOpen(true)}
        />

        {mineActive.length > 0 && (
          <Card variant="solid">
            <CardHeader>
              <CardTitle>Active</CardTitle>
              <RefreshButton
                onRefresh={handleManualRefresh}
                refreshing={refreshing}
              />
            </CardHeader>
            <CardContent className="space-y-2">
              {mineActive.map((t) => (
                <TournamentRow key={t._id} t={t} />
              ))}
            </CardContent>
          </Card>
        )}

        {openActive.length > 0 && (
          <Card variant="solid">
            <CardHeader>
              <CardTitle>In progress</CardTitle>
              <RefreshButton
                onRefresh={handleManualRefresh}
                refreshing={refreshing}
              />
            </CardHeader>
            <CardContent className="space-y-2">
              {openActive.map((t) => (
                <TournamentRow key={t._id} t={t} />
              ))}
            </CardContent>
          </Card>
        )}

        <FinishedTournamentCard
          title="Finished"
          tournaments={finished}
          hasMore={finished.length < finishedTotal}
          loadingMore={finishedLoadingMore}
          onLoadMore={handleLoadMoreFinished}
          emptyMessage="Nothing finished yet."
          loading={finishedLoading}
        />
      </div>
      <CreateLeagueModal
        open={createLeagueOpen}
        onClose={() => setCreateLeagueOpen(false)}
        onCreated={() => {
          listLeagues()
            .then((res) => setLeagues(res.leagues))
            .catch(() => undefined);
        }}
      />
    </Page>
  );
}
