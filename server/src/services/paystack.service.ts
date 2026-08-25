import crypto from "crypto";
import { env } from "../config/env.js";

const BASE_URL = "https://api.paystack.co";

class PaystackError extends Error {
  constructor(
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

async function paystackFetch<T = any>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  const body: any = await res.json().catch(() => null);

  if (!res.ok || (body && body.status === false)) {
    throw new PaystackError(
      body?.message ?? `Paystack request failed (${res.status})`,
      body,
    );
  }

  return body as T;
}

export interface PaystackVerifyResult {
  status: "success" | "failed" | "abandoned" | string;
  reference: string;
  amount: number; // kobo
  currency: string;
}

/** Server-side verification of a transaction, this, not the client's success
 *  callback, is what we actually trust before crediting tokens. */
export async function verifyTransaction(
  reference: string,
): Promise<PaystackVerifyResult> {
  const res = await paystackFetch<{ data: PaystackVerifyResult }>(
    `/transaction/verify/${encodeURIComponent(reference)}`,
  );
  return res.data;
}

export interface PaystackBank {
  name: string;
  code: string;
  slug: string;
}

export async function listBanks(): Promise<PaystackBank[]> {
  const res = await paystackFetch<{ data: PaystackBank[] }>(
    "/bank?country=nigeria&currency=NGN",
  );
  return res.data;
}

export async function resolveAccountNumber(
  accountNumber: string,
  bankCode: string,
): Promise<{ account_number: string; account_name: string }> {
  const res = await paystackFetch<{
    data: { account_number: string; account_name: string };
  }>(
    `/bank/resolve?account_number=${encodeURIComponent(accountNumber)}&bank_code=${encodeURIComponent(bankCode)}`,
  );
  return res.data;
}

export async function createTransferRecipient(params: {
  name: string;
  accountNumber: string;
  bankCode: string;
}): Promise<{ recipient_code: string }> {
  const res = await paystackFetch<{ data: { recipient_code: string } }>(
    "/transferrecipient",
    {
      method: "POST",
      body: JSON.stringify({
        type: "nuban",
        name: params.name,
        account_number: params.accountNumber,
        bank_code: params.bankCode,
        currency: "NGN",
      }),
    },
  );
  return res.data;
}

export interface PaystackTransferResult {
  transfer_code: string;
  status: string; // 'pending' | 'success' | 'otp' | 'failed' etc.
}

export async function initiateTransfer(params: {
  amountKobo: number;
  recipientCode: string;
  reason: string;
  reference: string;
}): Promise<PaystackTransferResult> {
  const res = await paystackFetch<{ data: PaystackTransferResult }>(
    "/transfer",
    {
      method: "POST",
      body: JSON.stringify({
        source: "balance",
        amount: params.amountKobo,
        recipient: params.recipientCode,
        reason: params.reason,
        reference: params.reference,
      }),
    },
  );
  return res.data;
}

/** Verifies the `x-paystack-signature` header against the raw request body.
 *  MUST be checked before trusting any webhook payload, otherwise anyone
 *  who finds the webhook URL could POST a fake "charge.success" event and
 *  get free tokens credited. Requires the RAW (unparsed) request body; see
 *  app.ts for why this route is wired up before the global JSON body parser. */
export function verifyWebhookSignature(
  rawBody: Buffer,
  signature: string | undefined,
): boolean {
  if (!signature) return false;
  const hash = crypto
    .createHmac("sha512", env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest("hex");
  // Constant-time comparison, a plain === here would leak timing information
  // about how many leading characters matched, which is a real (if niche)
  // attack vector against signature checks.
  const a = Buffer.from(hash);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
