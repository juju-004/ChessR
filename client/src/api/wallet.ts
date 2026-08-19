import { apiFetch } from './http.js';

export interface WalletConfigResponse {
  // Fixed purchase rate — no more plan tiers, just "how much R" someone
  // types in. See BuyTokens.tsx.
  purchase: { nairaPerToken: number; minTokens: number; maxTokens: number };
  withdrawal: { nairaPerToken: number; minTokens: number };
  paystackPublicKey: string;
}

export interface Bank {
  name: string;
  code: string;
  slug: string;
}

export interface Transaction {
  _id: string;
  type:
    | 'purchase'
    | 'withdrawal'
    | 'wager_stake'
    | 'wager_payout'
    | 'wager_refund'
    | 'tournament_reg_fee'
    | 'tournament_prize_fund'
    | 'tournament_payout'
    | 'tournament_reg_revenue'
    | 'tournament_refund';
  status: 'pending' | 'success' | 'failed';
  tokens: number;
  amountKobo: number;
  reference: string;
  accountName?: string;
  failureReason?: string;
  createdAt: string;
}

export interface TransactionsResponse {
  transactions: Transaction[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// Kept at the same '/wallet/plans' path as before (renaming would be a
// server-side route change too) — the response shape moved from a fixed
// `plans` list to a flat `purchase` rate object, see WalletConfigResponse.
export function getWalletConfig() {
  return apiFetch<WalletConfigResponse>('/wallet/plans');
}

export function getBalance() {
  return apiFetch<{ tokenBalance: number }>('/wallet/balance');
}

// tokens replaces planId — there's no fixed plan to reference anymore,
// the person just types how many R Coins they want (see BuyTokens.tsx)
// and the server prices it at the fixed rate returned by getWalletConfig.
export function initPurchase(tokens: number) {
  return apiFetch<{ reference: string; amountKobo: number; tokens: number; paystackPublicKey: string }>(
    '/wallet/purchase',
    { method: 'POST', body: JSON.stringify({ tokens }) },
  );
}

export function verifyPurchase(reference: string) {
  return apiFetch<{ status: string; tokenBalance: number }>('/wallet/purchase/verify', {
    method: 'POST',
    body: JSON.stringify({ reference }),
  });
}

export function getBanks() {
  return apiFetch<{ banks: Bank[] }>('/wallet/banks');
}

export function resolveAccount(accountNumber: string, bankCode: string) {
  return apiFetch<{ account_number: string; account_name: string }>(
    `/wallet/resolve-account?accountNumber=${encodeURIComponent(accountNumber)}&bankCode=${encodeURIComponent(bankCode)}`,
  );
}

export function withdraw(params: { tokens: number; accountNumber: string; bankCode: string; accountName: string }) {
  return apiFetch<{ status: string; reference: string; tokens: number; amountNaira: number }>('/wallet/withdraw', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export function getTransactions(page = 1, limit = 20) {
  return apiFetch<TransactionsResponse>(`/wallet/transactions?page=${page}&limit=${limit}`);
}
