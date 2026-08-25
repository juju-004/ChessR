import { getAdminToken, setAdminToken, clearAdminToken } from './adminAuthStore.js';
import { ApiRequestError } from './http.js';

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

async function adminFetch<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Content-Type', 'application/json');
  const token = getAdminToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(`${API_BASE}/admin${path}`, { ...options, headers });

  if (res.status === 401) {
    clearAdminToken();
  }

  if (!res.ok) {
    let body: any = {};
    try {
      body = await res.json();
    } catch {
      /* no JSON body */
    }
    throw new ApiRequestError(res.status, body.error ?? res.statusText, body.details);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function adminLogin(username: string, password: string) {
  const data = await adminFetch<{ token: string }>('/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
  setAdminToken(data.token);
}

export type ReportStatus = 'pending' | 'reviewing' | 'actioned' | 'dismissed';
export type ReportReason =
  | 'cheating'
  | 'harassment'
  | 'sandbagging'
  | 'payment_dispute'
  | 'other';

export interface AdminReportListItem {
  id: string;
  reporter: { _id: string; username: string; reportingBlocked: boolean } | null;
  reportedUser: { _id: string; username: string; withdrawalBlocked: boolean } | null;
  reason: ReportReason;
  description: string;
  gameCode?: string;
  status: ReportStatus;
  createdAt: string;
  reviewedBy?: string;
  reviewedAt?: string;
}

export function listReports(status?: ReportStatus | 'all') {
  const qs = status && status !== 'all' ? `?status=${status}` : '';
  return adminFetch<AdminReportListItem[]>(`/reports${qs}`);
}

export interface SuspicionSignal {
  type: string;
  detail: string;
}
export interface SuspicionReport {
  side: 'white' | 'black';
  score: number;
  signals: SuspicionSignal[];
  thinkTimesMs: number[];
}

export interface AdminReportDetail extends AdminReportListItem {
  reviewNotes?: string;
  game: {
    id: string;
    joinCode: string;
    variant: string;
    white: { _id: string; username: string } | null;
    black: { _id: string; username: string } | null;
    status: string;
    result: string | null;
    endReason: string | null;
    pgn: string;
    moves: { san: string; from: string; to: string; moveNumber: number; timestampMs: number }[];
    timeControl: { baseSeconds: number | null; incrementSeconds: number };
    wagerTokens: number;
    startedAt?: string;
    endedAt?: string;
    suspicion: SuspicionReport[];
  } | null;
}

export function getReportDetail(id: string) {
  return adminFetch<AdminReportDetail>(`/reports/${id}`);
}

export function updateReport(
  id: string,
  body: { status: ReportStatus; reviewNotes?: string; clearWithdrawalBlock?: boolean },
) {
  return adminFetch<{ id: string; status: ReportStatus }>(`/reports/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export function setUserReportingBlock(username: string, blocked: boolean) {
  return adminFetch<{ username: string; reportingBlocked: boolean }>(
    `/users/${encodeURIComponent(username)}/reporting-block`,
    { method: 'PATCH', body: JSON.stringify({ blocked }) },
  );
}

// --- Platform revenue (rake) -------------------------------------------------
// See PlatformRevenue.ts / wallet.service.ts's computeRake+recordRake on the
// server, a cut of every decisive game/cage-match wager and every
// tournament reg-fee pool.

export type RevenueSource = 'game' | 'cage_match' | 'tournament';

export interface RevenueEntry {
  id: string;
  source: RevenueSource;
  sourceId: string;
  tokens: number;
  grossPotTokens: number;
  ratePercent: number;
  createdAt: string;
}

export interface RevenueSummary {
  balanceTokens: number;
  ratePercent: number;
  bySource: Record<RevenueSource, { tokens: number; count: number }>;
  entries: RevenueEntry[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export function getRevenueSummary(page = 1, limit = 50) {
  return adminFetch<RevenueSummary>(`/revenue?page=${page}&limit=${limit}`);
}
