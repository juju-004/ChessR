import { useCallback, useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { listJoinRequests, respondToJoinRequest, type TeamJoinRequestItem } from "../../api/teams.js";
import { errMsg } from "../../lib/errMsg.js";
import { useIsDesktop } from "../../hooks/useIsDesktop.js";
import { Pagination } from "../Pagination.js";
import { TEAM_LIST_PAGE_SIZE } from "./pageSize.js";
import { Avatar } from "../ui/Avatar.js";
import { Button } from "../ui/Button.js";
import { Card } from "../ui/Card.js";
import { Spinner } from "../ui/Spinner.js";

/** Owner-only queue of people asking to join. */
export function TeamRequestsTab({
  teamId,
  refreshKey,
  onChanged,
}: {
  teamId: string;
  refreshKey: number;
  onChanged: () => void;
}) {
  const limit = TEAM_LIST_PAGE_SIZE[useIsDesktop() ? "desktop" : "mobile"];
  const [requests, setRequests] = useState<TeamJoinRequestItem[]>([]);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await listJoinRequests(teamId, page + 1, limit);
      setRequests(r.requests);
      setPageCount(r.totalPages);
      if (r.requests.length === 0 && page > 0) setPage(Math.max(0, r.totalPages - 1));
      setError("");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, [teamId, page, limit]);

  useEffect(() => {
    setPage(0);
  }, [limit]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function respond(id: string, accept: boolean) {
    setBusyId(id);
    try {
      await respondToJoinRequest(teamId, id, accept);
      onChanged();
      await load();
    } catch (err) {
      setError(errMsg(err));
      load();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="flex justify-center py-10"><Spinner /></div>;

  return (
    <div className="space-y-2">
      {error && <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
      {requests.length === 0 ? (
        <Card className="p-8 text-center text-sm text-base-content/60">No pending requests.</Card>
      ) : (
        <Card className="divide-y divide-base-300/60 p-0.5">
          {requests.map((r) => (
            <div key={r.id} className="flex items-center gap-2 px-2 py-1.5">
              <Avatar username={r.user.username} src={r.user.avatarUrl} gradient={r.user.avatarGradient} size="xs" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{r.user.username}</div>
                <div className="text-xs text-base-content/50">Rating {r.user.rating}</div>
              </div>
              <Button size="sm" loading={busyId === r.id} onClick={() => respond(r.id, true)} aria-label={`Accept ${r.user.username}`}>
                <Check className="h-4 w-4" /> Accept
              </Button>
              <Button size="sm" variant="ghost" disabled={busyId === r.id} onClick={() => respond(r.id, false)} aria-label={`Decline ${r.user.username}`}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </Card>
      )}
      <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
    </div>
  );
}
