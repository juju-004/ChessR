import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import {
  listOpenTournaments,
  listMyTournaments,
  listMyFinishedTournaments,
  type Tournament,
} from "../api/tournaments.js";
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
  Spinner,
} from "../components/ui/index.js";

// Client-side page size for the Open tournaments list, which already
// returns its (small, capped) set in one request, so this just slices the
// array that's already in memory. The Finished list is different: it grows
// forever, so it's paged by the server, 5 at a time (see
// listMyFinishedTournaments and ServerPagedTournamentCard below).
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

/** Finished tournaments card. Unlike the client-sliced Open list, each page
 *  is its own request (5 tournaments), so only a handful of rows ever travel
 *  over the wire however many you've finished. */
function ServerPagedTournamentCard({
  title,
  tournaments,
  page,
  pageCount,
  onPageChange,
  emptyMessage,
  loading,
}: {
  title: string;
  tournaments: Tournament[];
  /** 0-based, same as <Pagination>. */
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  emptyMessage: string;
  /** True only until the first page arrives. Later page changes keep the
   *  current rows on screen until the next page lands, no spinner flash. */
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
              <TournamentRow key={t._id} t={t} />
            ))}
            <Pagination
              page={page}
              pageCount={pageCount}
              onPageChange={onPageChange}
            />
          </>
        )}
      </CardContent>
    </Card>
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
  // Finished list: one server page at a time (0-based page for <Pagination>).
  const [finished, setFinished] = useState<Tournament[]>([]);
  const [finishedPage, setFinishedPage] = useState(0);
  const [finishedPageCount, setFinishedPageCount] = useState(1);
  const [finishedLoading, setFinishedLoading] = useState(true);
  // Latest page number for refresh() to re-fetch without it having to be a
  // dependency (which would re-subscribe the socket listeners on every flip).
  const finishedPageRef = useRef(0);

  const loadFinished = useCallback((page: number) => {
    return listMyFinishedTournaments(page + 1)
      .then((res) => {
        setFinished(res.tournaments);
        setFinishedPageCount(res.totalPages);
        // The server clamps a stale page (list shrank) to the last real one.
        finishedPageRef.current = res.page - 1;
        setFinishedPage(res.page - 1);
      })
      .finally(() => setFinishedLoading(false));
  }, []);

  const refresh = useCallback(() => {
    const tasks: Promise<unknown>[] = [
      listOpenTournaments()
        .then((res) => setOpen(res.tournaments))
        .finally(() => setOpenLoading(false)),
    ];
    if (user) {
      tasks.push(listMyTournaments().then((res) => setMine(res.tournaments)));
      tasks.push(loadFinished(finishedPageRef.current));
    } else {
      setFinishedLoading(false);
    }
    return Promise.all(tasks);
  }, [user, loadFinished]);

  const handleFinishedPageChange = useCallback(
    (page: number) => {
      finishedPageRef.current = page;
      setFinishedPage(page);
      loadFinished(page);
    },
    [loadFinished],
  );

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
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigate("/tournaments/new")}
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Create tournament</span>
          <span className="sm:hidden">New</span>
        </Button>
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

        <ServerPagedTournamentCard
          title="Finished"
          tournaments={finished}
          page={finishedPage}
          pageCount={finishedPageCount}
          onPageChange={handleFinishedPageChange}
          emptyMessage="Nothing finished yet."
          loading={finishedLoading}
        />
      </div>
    </Page>
  );
}
