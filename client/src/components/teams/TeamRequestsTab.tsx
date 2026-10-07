import { useCallback, useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { listJoinRequests, respondToJoinRequest, type TeamJoinRequestItem } from "../../api/teams.js";
import { errMsg } from "../../lib/errMsg.js";
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
  const [requests, setRequests] = useState<TeamJoinRequestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await listJoinRequests(teamId);
      setRequests(r.requests);
      setError("");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function respond(id: string, accept: boolean) {
    setBusyId(id);
    try {
      await respondToJoinRequest(teamId, id, accept);
      setRequests((r) => r.filter((x) => x.id !== id));
      onChanged();
    } catch (err) {
      setError(errMsg(err));
      load();
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <div className="flex justify-center py-10"><Spinner /></div>;

  return (
    <div className="space-y-3">
      {error && <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
      {requests.length === 0 ? (
        <Card className="p-8 text-center text-sm text-base-content/60">No pending requests.</Card>
      ) : (
        <Card className="divide-y divide-base-300/60 p-1">
          {requests.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-3 py-2.5">
              <Avatar username={r.user.username} src={r.user.avatarUrl} gradient={r.user.avatarGradient} size="sm" />
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
    </div>
  );
}
