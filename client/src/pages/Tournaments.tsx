import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
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
  Button,
  CardRow,
  ListCard,
  LoadMoreButton,
  Badge,
  EmojiInput,
  Input,
  Textarea,
  Modal,
  CenteredSpinner,
  DescriptionCard,
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
    <ListCard
      title={title}
      actions={
        onRefresh && (
          <RefreshButton onRefresh={onRefresh} refreshing={!!refreshing} />
        )
      }
      loading={loading}
      empty={tournaments.length === 0}
      emptyMessage={emptyMessage}
      footer={
        <Pagination
          page={safePage}
          pageCount={pageCount}
          onPageChange={setPage}
        />
      }
    >
      {pageItems.map((t) => (
        <TournamentRow key={t._id} t={t} />
      ))}
    </ListCard>
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
    <ListCard
      title={title}
      loading={loading}
      empty={tournaments.length === 0}
      emptyMessage={emptyMessage}
      footer={
        <LoadMoreButton
          hasMore={hasMore}
          loading={loadingMore}
          onClick={onLoadMore}
        />
      }
    >
      {tournaments.map((t) => (
        <TournamentRow key={t._id} t={t} hideFinishedBadgeOnMobile />
      ))}
    </ListCard>
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
    <ListCard
      title="Leagues"
      actions={
        canCreate && (
          <Button variant="secondary" size="sm" onClick={onCreate}>
            <Plus className="h-4 w-4" />
            New
          </Button>
        )
      }
      loading={loading}
      empty={leagues.length === 0}
      emptyMessage="No leagues yet. A league is a series of tournaments whose points add up into one table."
      footer={
        <Pagination
          page={safePage}
          pageCount={pageCount}
          onPageChange={setPage}
        />
      }
    >
      {items.map((c) => (
        <CardRow key={c.id} to={`/leagues/${c.id}`}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Layers className="h-4 w-4 shrink-0 text-(--primary)" />
              <span className="min-w-0 font-medium wrap-break-word text-base-content">
                {c.name}
              </span>
              {c.mine && <Badge variant="primary">Yours</Badge>}
            </div>
            <div className="mt-0.5 text-xs text-base-content/50">
              {c.organizationName} · {c.tournamentCount} of {c.maxTournaments}{" "}
              {c.tournamentCount === 1 ? "tournament" : "tournaments"}
            </div>
          </div>
        </CardRow>
      ))}
    </ListCard>
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
          label="Description"
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
  // Approved organisations only: gates creating a league below.
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
    const nextPage =
      Math.floor(finishedLenRef.current / FINISHED_PAGE_SIZE) + 1;
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

  // True once the first refresh has settled, so the page shows a single
  // spinner and then only the cards that actually have something in them.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    refresh()
      .catch(() => undefined)
      .finally(() => setReady(true));
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

  const showLeagueCard =
    org?.status === "approved" || leagues.some((l) => l.joined || l.mine);
  const hasLeagues = showLeagueCard && leagues.length > 0;
  const hasAnyCard =
    openPending.length > 0 ||
    hasLeagues ||
    mineActive.length > 0 ||
    openActive.length > 0 ||
    finished.length > 0;

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
        {!ready && <CenteredSpinner className="py-8" />}

        {ready && openPending.length > 0 && (
          <PaginatedTournamentCard
            title="Open"
            tournaments={openPending}
            emptyMessage=""
            onRefresh={handleManualRefresh}
            refreshing={refreshing}
            loading={openLoading}
          />
        )}

        {/* Hidden unless you're an approved organisation or are playing in
         *  at least one league, and (for a league player) it has leagues.
         *  An approved organisation keeps the card even when empty, since
         *  it holds the "New" button for starting a league. */}
        {ready && showLeagueCard && (hasLeagues || org?.status === "approved") && (
          <LeagueCard
            leagues={leagues}
            loading={leaguesLoading}
            canCreate={org?.status === "approved"}
            onCreate={() => setCreateLeagueOpen(true)}
          />
        )}

        {ready && mineActive.length > 0 && (
          <ListCard
            title="Active"
            actions={
              <RefreshButton
                onRefresh={handleManualRefresh}
                refreshing={refreshing}
              />
            }
          >
            {mineActive.map((t) => (
              <TournamentRow key={t._id} t={t} />
            ))}
          </ListCard>
        )}

        {ready && openActive.length > 0 && (
          <ListCard
            title="In progress"
            actions={
              <RefreshButton
                onRefresh={handleManualRefresh}
                refreshing={refreshing}
              />
            }
          >
            {openActive.map((t) => (
              <TournamentRow key={t._id} t={t} />
            ))}
          </ListCard>
        )}

        {ready && finished.length > 0 && (
          <FinishedTournamentCard
            title="Finished"
            tournaments={finished}
            hasMore={finished.length < finishedTotal}
            loadingMore={finishedLoadingMore}
            onLoadMore={handleLoadMoreFinished}
            emptyMessage=""
            loading={finishedLoading}
          />
        )}

        {/* Only when every card above is empty. */}
        {ready && !hasAnyCard && (
          <DescriptionCard title="What are tournaments?">
            <p>
              Tournaments are organised events where many players compete
              together: a knockout bracket, a swiss or arena event, or a round
              robin. Join an open one, or create your own and set the time
              control, format and prize pool.
            </p>
            <p>
              Open tournaments, the ones you're in, ones in progress, leagues
              and your finished results will all appear here.
            </p>
          </DescriptionCard>
        )}
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
