import { env } from '../config/env.js';

/**
 * Sends a WhatsApp message to the owner through CallMeBot
 * (https://www.callmebot.com), a free personal-use gateway: one GET request,
 * no SDK, no business verification. The owner activates it once from their
 * own WhatsApp and gets an API key.
 *
 * CallMeBot can only message the number that activated it, and this file
 * deliberately has no way to pass a different recipient: every alert goes to
 * WHATSAPP_NOTIFY_NUMBER.
 *
 * Fails soft, like the mailer: if the env vars aren't set it logs and
 * resolves, and a failed send is logged, never thrown, so a WhatsApp outage
 * can never fail or roll back a withdrawal request. Messages can be delayed
 * by up to a minute on CallMeBot's side.
 */

async function sendWhatsAppMessage(message: string): Promise<void> {
  const phone = env.WHATSAPP_NOTIFY_NUMBER;
  const apikey = env.CALLMEBOT_API_KEY;
  if (!phone || !apikey) {
    console.warn('💬 WhatsApp not configured, skipping send. Would have sent:', message);
    return;
  }

  const url = new URL('https://api.callmebot.com/whatsapp.php');
  url.searchParams.set('phone', phone);
  url.searchParams.set('text', message);
  url.searchParams.set('apikey', apikey);

  try {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`💬 WhatsApp send failed (${res.status}):`, body.slice(0, 300));
    }
  } catch (err) {
    console.error('💬 WhatsApp send failed:', err);
  }
}

export interface WithdrawalAlert {
  username: string;
  tokens: number;
  amountKobo: number;
  reference: string;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  accountName?: string | null;
}

/** Tells the owner that a new withdrawal request is waiting. */
export async function notifyWithdrawalRequested(w: WithdrawalAlert): Promise<void> {
  const naira = (w.amountKobo / 100).toLocaleString('en-NG');
  const lines = [
    '💸 New withdrawal request',
    `User: ${w.username}`,
    `Amount: ₦${naira} (${w.tokens} R Coins)`,
    `Bank: ${w.bankName ?? 'N/A'}`,
    `Account: ${w.bankAccountNumber ?? 'N/A'}${w.accountName ? ` (${w.accountName})` : ' (name not verified)'}`,
    `Ref: ${w.reference}`,
  ];
  await sendWhatsAppMessage(lines.join('\n'));
}
