import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Crown, Link2, LogOut, Megaphone, Settings as SettingsIcon, Trophy, UserPlus, Users } from "lucide-react";
import { getTeam, leaveTeam, type TeamDetail } from "../api/teams.js";
import { errMsg } from "../lib/errMsg.js";
import { useConfirm } from "../contexts/ConfirmContext.js";
import { useSocket } from "../contexts/SocketContext.js";
import { JoinTeamButton } from "../components/teams/JoinTeamButton.js";
import { TeamAnnouncements } from "../components/teams/TeamAnnouncements.js";
import { TeamLeadersCard } from "../components/teams/TeamLeadersCard.js";
import { TeamSection } from "../components/teams/TeamSection.js";
import { TeamMembersTab } from "../components/teams/TeamMembersTab.js";
import { TeamRequestsTab } from "../components/teams/TeamRequestsTab.js";
import { TeamSettingsTab } from "../components/teams/TeamSettingsTab.js";
import { TeamTournamentsTab } from "../components/teams/TeamTournamentsTab.js";
import { Page } from "@/components/ui/Page.js";
import { Card } from "@/components/ui/Card.js";
import { Button } from "@/components/ui/Button.js";
import { Badge } from "@/components/ui/Badge.js";
import { Spinner } from "@/components/ui/Spinner.js";

/** One team's own page, as card sections. On PC: announcements (3/5) beside
 *  members/join requests (2/5), then tournaments standalone full width, then
 *  settings. On phone it's a single column ordered announcements,
 *  tournaments, members/requests. Non-members see a short preview with the
 *  join controls instead. */
export function TeamPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const socket = useSocket();
  const confirm = useConfirm();

  const [team, setTeam] = useState<TeamDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Bumped whenever the server says something about the team changed, so
  // the member/request lists refetch too.
  const [refreshKey, setRefreshKey] = useState(0);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      const { team } = await getTeam(id);
      setTeam(team);
      setError("");
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Join the team's live-update room (members only) so the page refreshes
  // when members, requests or announcements change.
  useEffect(() => {
    if (!socket) return;
    const watch = () => socket.emit("team:watch", { teamId: id });
    watch();
    socket.on("connect", watch);
    return () => {
      socket.off("connect", watch);
      socket.emit("team:unwatch", { teamId: id });
    };
  }, [socket, id]);

  useEffect(() => {
    if (!socket) return;
    const onUpdate = (p: { teamId: string }) => {
      if (p.teamId !== id) return;
      load();
      setRefreshKey((k) => k + 1);
    };
    // Removed from / deleted while looking at it.
    const onGone = (p: { teamId: string }) => {
      if (p.teamId === id) navigate("/teams", { replace: true });
    };
    // My own pending request got answered (non-members aren't in the room).
    const onResolved = (p: { teamId: string }) => {
      if (p.teamId === id) load();
    };
    socket.on("team:update", onUpdate);
    socket.on("team:removed", onGone);
    socket.on("team:deleted", onGone);
    socket.on("team:request_resolved", onResolved);
    return () => {
      socket.off("team:update", onUpdate);
      socket.off("team:removed", onGone);
      socket.off("team:deleted", onGone);
      socket.off("team:request_resolved", onResolved);
    };
  }, [socket, id, load, navigate]);

  async function handleLeave() {
    if (!team) return;
    const ok = await confirm({ title: `Leave ${team.name}?`, confirmLabel: "Leave", variant: "danger" });
    if (!ok) return;
    try {
      await leaveTeam(team.id);
      navigate("/teams", { replace: true });
    } catch (err) {
      setError(errMsg(err));
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/teams/${id}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked, nothing useful to do */
    }
  }

  if (loading) {
    return (
      <Page back="/teams">
        <div className="flex justify-center py-16"><Spinner /></div>
      </Page>
    );
  }

  if (!team) {
    return (
      <Page title="Team" back="/teams">
        <Card className="p-8 text-center text-sm text-base-content/60">{error || "Team not found."}</Card>
      </Page>
    );
  }

  return (
    <Page
      title={
        <span className="flex items-center gap-2">
          {team.name}
          {team.isOwner && <Crown className="h-5 w-5 text-amber-500" aria-label="Owner" />}
        </span>
      }
      description={team.description || undefined}
      back="/teams"
      actions={
        team.isMember ? (
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={copyInvite}>
              <Link2 className="h-4 w-4" /> {copied ? "Copied" : "Invite link"}
            </Button>
            {!team.isOwner && (
              <Button size="sm" variant="ghost" onClick={handleLeave}>
                <LogOut className="h-4 w-4" /> Leave
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      <p className="mb-4 text-sm text-base-content/60">
        {team.memberCount} {team.memberCount === 1 ? "member" : "members"}
        {team.avgRating !== null && <> · avg rating {team.avgRating}</>}
        {team.owner && <> · owned by {team.owner.username}</>}
      </p>

      {error && (
        <p role="alert" className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
          {error}
        </p>
      )}

      {!team.isMember ? (
        <Card className="flex flex-col items-start gap-3 p-6">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">Join this team</h2>
            {team.hasCode && <Badge variant="neutral">Entry code</Badge>}
            {team.joinMode === "request" && <Badge variant="neutral">Approval needed</Badge>}
          </div>
          <p className="text-sm text-base-content/60">
            In-house tournaments, announcements and the member list are only visible to members.
          </p>
          <JoinTeamButton
            team={team}
            size="md"
            onError={setError}
            onChanged={() => load()}
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {/* One grid so phone can reorder: announcements, tournaments, then
           *  members/requests. On PC, announcements (3/5) + members/requests
           *  (2/5) share the first row and tournaments stands alone below. */}
          <div className="grid gap-6 lg:grid-cols-5">
            <div className="order-1 min-w-0 lg:col-span-3">
              <TeamSection title="Announcements" icon={<Megaphone className="h-4 w-4" />}>
                <TeamAnnouncements teamId={team.id} isLeader={team.isLeader} refreshKey={refreshKey} />
              </TeamSection>
            </div>

            <div className="order-3 min-w-0 space-y-6 lg:order-2 lg:col-span-2">
              <TeamSection
                title="Members"
                icon={<Users className="h-4 w-4" />}
                badge={<Badge variant="neutral">{team.memberCount}</Badge>}
              >
                <TeamMembersTab teamId={team.id} isOwner={team.isOwner} refreshKey={refreshKey} onChanged={load} />
              </TeamSection>

              {team.isOwner && (
                <TeamSection
                  title="Join requests"
                  icon={<UserPlus className="h-4 w-4" />}
                  badge={team.pendingRequests ? <Badge variant="primary">{team.pendingRequests}</Badge> : undefined}
                >
                  <TeamRequestsTab teamId={team.id} refreshKey={refreshKey} onChanged={load} />
                </TeamSection>
              )}
            </div>

            <div className="order-2 min-w-0 lg:order-3 lg:col-span-5">
              <TeamSection title="Tournaments" icon={<Trophy className="h-4 w-4" />}>
                <TeamTournamentsTab teamId={team.id} isOwner={team.isOwner} />
              </TeamSection>
            </div>
          </div>

          {/* Settings stand alone, full width, and split in two on PC. */}
          {team.isLeader && (
            <TeamSection title="Settings" icon={<SettingsIcon className="h-4 w-4" />}>
              {team.isOwner ? (
                <TeamSettingsTab
                  team={team}
                  onSaved={load}
                  onDeleted={() => navigate("/teams", { replace: true })}
                  middle={<TeamLeadersCard teamId={team.id} refreshKey={refreshKey} onChanged={load} />}
                />
              ) : (
                <TeamLeadersCard teamId={team.id} refreshKey={refreshKey} onChanged={load} />
              )}
            </TeamSection>
          )}
        </div>
      )}
    </Page>
  );
}
