import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import {
  deleteLeague,
  getLeague,
  type LeagueDetailResponse,
} from "../api/leagues.js";
import { useConfirm } from "../contexts/ConfirmContext.js";
import { useSocket } from "../contexts/SocketContext.js";
import { useAuth } from "../contexts/AuthContext.js";
import { LeagueStandings } from "../components/tournaments/LeagueStandings.js";
import { TournamentRow } from "../components/tournaments/TournamentRow.js";
import { RefreshButton } from "../components/RefreshButton.js";
import { errMsg } from "../lib/errMsg.js";
import {
  Page,
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Spinner,
} from "../components/ui/index.js";

export function LeagueDetail() {
  const { id = "" } = useParams<{ id: string }>();
  const socket = useSocket();
  const { user } = useAuth();
  const navigate = useNavigate();
  const confirm = useConfirm();
  const [deleting, setDeleting] = useState(false);
  const [data, setData] = useState<LeagueDetailResponse | null>(null);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    return getLeague(id)
      .then((res) => {
        setData(res);
        setError("");
      })
      .catch((err) => setError(errMsg(err)));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Same live-refresh events the Tournaments list already listens to, a stage
  // starting, finishing or filling up changes this page's table or rows.
  useEffect(() => {
    if (!socket) return;
    socket.on("tournament:update", load);
    socket.on("tournament:started", load);
    socket.on("tournament:finished", load);
    socket.on("tournament:cancelled", load);
    return () => {
      socket.off("tournament:update", load);
      socket.off("tournament:started", load);
      socket.off("tournament:finished", load);
      socket.off("tournament:cancelled", load);
    };
  }, [socket, load]);

  if (!data) {
    return (
      <Page title="League" back="/tournaments">
        {error ? (
          <p className="text-sm text-red-400">{error}</p>
        ) : (
          <div className="flex justify-center py-10">
            <Spinner className="text-base-content/40" />
          </div>
        )}
      </Page>
    );
  }

  const { league, tournaments, standings, throughTournament } = data;

  async function handleDelete() {
    const ok = await confirm({
      title: `Delete "${league.name}"?`,
      description:
        "The league table goes away. Its tournaments are kept and carry on as normal standalone tournaments, but their points no longer add up here.",
      confirmLabel: "Delete league",
      variant: "danger",
    });
    if (!ok) return;
    setDeleting(true);
    try {
      await deleteLeague(league.id);
      navigate("/tournaments", { replace: true });
    } catch (err) {
      setError(errMsg(err));
      setDeleting(false);
    }
  }
  const full = league.tournamentCount >= league.maxTournaments;

  return (
    <Page
      title={league.name}
      back="/tournaments"
      description={`${league.organizationName} · ${tournaments.length} of ${league.maxTournaments} tournaments`}
      actions={
        league.mine ? (
          <div className="flex items-center gap-2">
            <Button
              variant="danger"
              size="sm"
              loading={deleting}
              onClick={handleDelete}
              aria-label="Delete league"
            >
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">Delete</span>
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={full}
              title={full ? `This league already has its ${league.maxTournaments} tournaments` : undefined}
              onClick={() => navigate(`/tournaments/new?league=${league.id}`)}
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Add tournament</span>
              <span className="sm:hidden">Add</span>
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className="mx-auto space-y-4">
        {error && <p className="text-sm text-red-400">{error}</p>}
        {league.description && (
          <Card variant="solid">
            <p className="whitespace-pre-wrap text-sm text-base-content/70">
              {league.description}
            </p>
          </Card>
        )}

        <LeagueStandings
          rows={standings}
          myId={user?.id}
          pageSize={20}
          subtitle={
            throughTournament > 0
              ? `After tournament ${throughTournament} of ${tournaments.length}. Points from every tournament add up here.`
              : undefined
          }
        />

        <Card variant="solid">
          <CardHeader>
            <CardTitle>Tournaments</CardTitle>
            <RefreshButton
              onRefresh={() => {
                setRefreshing(true);
                load().finally(() => setRefreshing(false));
              }}
              refreshing={refreshing}
            />
          </CardHeader>
          <CardContent className="space-y-2">
            {tournaments.length === 0 && (
              <p className="text-sm text-base-content/50">
                No tournaments added yet.
                {league.mine && " Use “Add tournament” to create the first one."}
              </p>
            )}
            {tournaments.map((t, i) => (
              <div key={t._id} className="flex items-center gap-2">
                <span className="w-6 shrink-0 text-center text-xs font-semibold text-base-content/40">
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <TournamentRow t={t} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
