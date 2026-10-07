import { apiFetch } from './http.js';
import type { Tournament } from './tournaments.js';

export type TeamJoinMode = 'open' | 'request';
export type TeamRole = 'owner' | 'leader' | 'member';

/** Card-sized view returned by the lists. There's no member cap in here on
 *  purpose, the cap is a server-side detail the UI never shows. */
export interface TeamSummary {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  joinMode: TeamJoinMode;
  /** Whether an entry code is set (never the code itself). */
  hasCode: boolean;
  isMember: boolean;
  isOwner: boolean;
  /** Owner or leader: can post announcements and manage leaders. */
  isLeader: boolean;
  /** I have a pending request to join. */
  requestPending: boolean;
  createdAt: string;
}

export interface TeamDetail extends TeamSummary {
  avgRating: number | null;
  owner: { id: string; username: string; avatarGradient: string | null } | null;
  /** Owner only. */
  entryCode?: string | null;
  /** Owner only. */
  pendingRequests?: number;
}

export interface TeamMember {
  id: string;
  username: string;
  avatarUrl: string | null;
  avatarGradient: string | null;
  rating: number;
  role: TeamRole;
  joinedAt: string;
}

export interface TeamJoinRequestItem {
  id: string;
  createdAt: string;
  user: {
    id: string;
    username: string;
    avatarUrl: string | null;
    avatarGradient: string | null;
    rating: number;
  };
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function listMyTeams() {
  return apiFetch<{ teams: TeamSummary[]; ownedCount: number; ownedLimit: number }>('/teams/mine');
}

export function searchTeams(q: string) {
  return apiFetch<{ teams: TeamSummary[] }>(`/teams/search?q=${encodeURIComponent(q)}`);
}

export function getTeam(id: string) {
  return apiFetch<{ team: TeamDetail }>(`/teams/${id}`);
}

export function listTeamMembers(id: string, page = 1, opts: { q?: string; leadersOnly?: boolean } = {}) {
  const params = new URLSearchParams({ page: String(page) });
  if (opts.q) params.set('q', opts.q);
  if (opts.leadersOnly) params.set('leaders', '1');
  return apiFetch<{ members: TeamMember[] } & PageMeta>(`/teams/${id}/members?${params}`);
}

export function addTeamLeader(id: string, userId: string) {
  return apiFetch<{ id: string }>(`/teams/${id}/leaders`, { method: 'POST', body: JSON.stringify({ userId }) });
}

export function removeTeamLeader(id: string, userId: string) {
  return apiFetch<void>(`/teams/${id}/leaders/${userId}`, { method: 'DELETE' });
}

export interface TeamAnnouncement {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: string;
  author: { id: string; username: string; avatarUrl: string | null; avatarGradient: string | null } | null;
}

export function listTeamAnnouncements(id: string) {
  return apiFetch<{ announcements: TeamAnnouncement[]; maxPinned: number; pinnedCount: number }>(
    `/teams/${id}/announcements`,
  );
}

export function createTeamAnnouncement(id: string, input: { title: string; body: string; pinned: boolean }) {
  return apiFetch<{ id: string }>(`/teams/${id}/announcements`, { method: 'POST', body: JSON.stringify(input) });
}

export function pinTeamAnnouncement(id: string, announcementId: string, pinned: boolean) {
  return apiFetch<{ id: string }>(`/teams/${id}/announcements/${announcementId}`, {
    method: 'PATCH',
    body: JSON.stringify({ pinned }),
  });
}

export function deleteTeamAnnouncement(id: string, announcementId: string) {
  return apiFetch<void>(`/teams/${id}/announcements/${announcementId}`, { method: 'DELETE' });
}

export function createTeam(input: {
  name: string;
  description: string;
  joinMode: TeamJoinMode;
  entryCode?: string;
}) {
  return apiFetch<{ id: string }>('/teams', { method: 'POST', body: JSON.stringify(input) });
}

export function updateTeam(
  id: string,
  patch: { name?: string; description?: string; joinMode?: TeamJoinMode; entryCode?: string | null },
) {
  return apiFetch<{ id: string }>(`/teams/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
}

export function joinTeam(id: string, code?: string) {
  return apiFetch<{ status: 'joined' | 'requested'; id: string }>(`/teams/${id}/join`, {
    method: 'POST',
    body: JSON.stringify(code ? { code } : {}),
  });
}

export function cancelJoinRequest(id: string) {
  return apiFetch<void>(`/teams/${id}/join`, { method: 'DELETE' });
}

export function listJoinRequests(id: string) {
  return apiFetch<{ requests: TeamJoinRequestItem[] }>(`/teams/${id}/requests`);
}

export function respondToJoinRequest(id: string, requestId: string, accept: boolean) {
  return apiFetch<{ status: string }>(`/teams/${id}/requests/${requestId}/respond`, {
    method: 'POST',
    body: JSON.stringify({ accept }),
  });
}

export function leaveTeam(id: string) {
  return apiFetch<{ disbanded: boolean }>(`/teams/${id}/leave`, { method: 'POST' });
}

export function transferTeam(id: string, userId: string) {
  return apiFetch<{ id: string }>(`/teams/${id}/transfer`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}

export function kickTeamMember(id: string, userId: string) {
  return apiFetch<void>(`/teams/${id}/members/${userId}`, { method: 'DELETE' });
}

export function deleteTeam(id: string) {
  return apiFetch<void>(`/teams/${id}`, { method: 'DELETE' });
}

export function listTeamTournaments(id: string, scope: 'upcoming' | 'finished', page = 1) {
  return apiFetch<{ tournaments: Tournament[] } & Partial<PageMeta>>(
    `/teams/${id}/tournaments?scope=${scope}&page=${page}`,
  );
}
