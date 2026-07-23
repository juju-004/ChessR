import { apiFetch } from './http.js';

export interface TokenPlan {
  id: string;
  tokens: number;
  priceNaira: number;
}

export interface PlansResponse {
  plans: TokenPlan[];
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
  type: 'purchase' | 'withdrawal';
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

export function getPlans() {
  return apiFetch<PlansResponse>('/wallet/plans');
}

export function getBalance() {
  return apiFetch<{ tokenBalance: number }>('/wallet/balance');
}

export function initPurchase(planId: string) {
  return apiFetch<{ reference: string; amountKobo: number; tokens: number; paystackPublicKey: string }>(
    '/wallet/purchase',
    { method: 'POST', body: JSON.stringify({ planId }) },
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
