import { env } from '../config/env.js';

/**
 * Sends an alert to the owners through a Telegram bot (Bot API, one POST per
 * recipient, no SDK, free). Each owner starts the bot once and sends it a
 * message; their numeric chat ids go in TELEGRAM_CHAT_ID, comma-separated
 * (e.g. "123456789,987654321").
 *
 * The bot can only reach the chat ids listed in TELEGRAM_CHAT_ID; this file
 * has no way to pass a different recipient.
 *
 * Fails soft, like the mailer: if the env vars aren't set it logs and
 * resolves, and a failed send is logged, never thrown, so a Telegram outage
 * (or one owner blocking the bot) can never fail or roll back a withdrawal
 * request or stop the other owners getting the alert.
 */

async function sendToChat(token: string, chatId: string, message: string): Promise<void> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`💬 Telegram send to ${chatId} failed (${res.status}):`, body.slice(0, 300));
    }
  } catch (err) {
    console.error(`💬 Telegram send to ${chatId} failed:`, err);
  }
}

async function sendOwnerAlert(message: string): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatIds = (env.TELEGRAM_CHAT_ID ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
  if (!token || chatIds.length === 0) {
    console.warn('💬 Telegram not configured, skipping send. Would have sent:', message);
    return;
  }

  await Promise.all(chatIds.map((id) => sendToChat(token, id, message)));
}

export interface WithdrawalAlert {
  transactionId: string;
  username: string;
  tokens: number;
  amountKobo: number;
  reference: string;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  accountName?: string | null;
}

// Frontend origin, same lookup the link-preview controller uses (og.controller.ts).
const CLIENT_URL = (process.env.CLIENT_URL ?? env.CLIENT_ORIGIN).replace(/\/+$/, '');

/** Tells the owners that a new withdrawal request is waiting, with a direct link to its approval page. */
export async function notifyWithdrawalRequested(w: WithdrawalAlert): Promise<void> {
  const naira = (w.amountKobo / 100).toLocaleString('en-NG');
  const lines = [
    '💸 New withdrawal request',
    `User: ${w.username}`,
    `Amount: ₦${naira} (${w.tokens} R Coins)`,
    `Bank: ${w.bankName ?? 'N/A'}`,
    `Account: ${w.bankAccountNumber ?? 'N/A'}${w.accountName ? ` (${w.accountName})` : ' (name not verified)'}`,
    `Ref: ${w.reference}`,
    '',
    `Review & approve: ${CLIENT_URL}/admin/withdrawals/${encodeURIComponent(w.transactionId)}`,
  ];
  await sendOwnerAlert(lines.join('\n'));
}
