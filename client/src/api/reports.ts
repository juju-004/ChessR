import { apiFetch } from './http.js';

export type ReportReason =
  | 'cheating'
  | 'harassment'
  | 'sandbagging'
  | 'payment_dispute'
  | 'other';

export interface SubmitReportParams {
  reportedUsername: string;
  reason: ReportReason;
  description: string;
  gameCode?: string;
}

export function submitReport(params: SubmitReportParams) {
  return apiFetch<{ id: string; status: string; createdAt: string }>('/reports', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}
