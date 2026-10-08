import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Crown, Shield, UserMinus } from "lucide-react";
import { kickTeamMember, listTeamMembers, transferTeam, type TeamMember } from "../../api/teams.js";
import { errMsg } from "../../lib/errMsg.js";
import { useConfirm } from "../../contexts/ConfirmContext.js";
import { useIsDesktop } from "../../hooks/useIsDesktop.js";
import { TEAM_LIST_PAGE_SIZE } from "./pageSize.js";
import { Pagination } from "../Pagination.js";
import { Avatar } from "../ui/Avatar.js";
import { Card } from "../ui/Card.js";
import { Spinner } from "../ui/Spinner.js";

/** Paged member list. The owner can remove people or hand the team over. */
export function TeamMembersTab({
  teamId,
  isOwner,
  refreshKey,
  onChanged,
}: {
  teamId: string;
  isOwner: boolean;
  refreshKey: number;
  onChanged: () => void;
}) {
  const confirm = useConfirm();
  const limit = TEAM_LIST_PAGE_SIZE[useIsDesktop() ? "desktop" : "mobile"];
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await listTeamMembers(teamId, page + 1, { limit });
      setMembers(r.members);
      setPageCount(r.totalPages);
      // The list shrank (someone left, or the page size changed): step back.
      if (r.members.length === 0 && page > 0) setPage(Math.max(0, r.totalPages - 1));
      setError("");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, [teamId, page, limit]);

  // A different page size (resizing across the phone/desktop breakpoint)
  // makes the current page number meaningless, so start over.
  useEffect(() => {
    setPage(0);
  }, [limit]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function kick(m: TeamMember) {
    if (!(await confirm({ title: `Remove ${m.username}?`, confirmLabel: "Remove", variant: "danger" }))) return;
    try {
      await kickTeamMember(teamId, m.id);
      await load();
      onChanged();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  async function makeOwner(m: TeamMember) {
    const ok = await confirm({
      title: `Make ${m.username} the owner?`,
      description: "You'll become a regular member and lose the owner controls.",
      confirmLabel: "Hand over",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await transferTeam(teamId, m.id);
      onChanged();
    } catch (err) {
      setError(errMsg(err));
    }
  }

  if (loading) return <div className="flex justify-center py-10"><Spinner /></div>;

  return (
    <div className="space-y-2">
      {error && <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">{error}</p>}
      <Card className="divide-y divide-base-300/60 p-0.5">
        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-2 px-2 py-1.5">
            <Avatar username={m.username} src={m.avatarUrl} gradient={m.avatarGradient} size="xs" />
            <Link to={`/profile/${m.username}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
              {m.username}
            </Link>
            {m.role === "owner" && <Crown className="h-4 w-4 text-amber-500" aria-label="Owner" />}
            {m.role === "leader" && <Shield className="h-4 w-4 text-(--primary)" aria-label="Leader" />}
            <span className="text-xs text-base-content/50">{m.rating}</span>
            {isOwner && m.role !== "owner" && (
              <>
                <button
                  type="button"
                  onClick={() => makeOwner(m)}
                  aria-label={`Make ${m.username} the owner`}
                  title="Make owner"
                  className="text-base-content/40 hover:text-amber-500"
                >
                  <Crown className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => kick(m)}
                  aria-label={`Remove ${m.username}`}
                  title="Remove"
                  className="text-base-content/40 hover:text-red-500"
                >
                  <UserMinus className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        ))}
      </Card>
      <Pagination page={page} pageCount={pageCount} onPageChange={setPage} />
    </div>
  );
}
