import { env } from '../config/env.js';

/**
 * Thin wrapper around Resend's HTTP API (https://resend.com) — chosen for
 * the free-tier testing period because it needs no SDK dependency (one
 * plain POST, see sendMail below), no verified sending domain to get
 * started (their shared onboarding@resend.dev sandbox sender works
 * immediately), and a free allowance (100 emails/day, 3,000/month) that's
 * comfortably enough to test signup + verification flows without a card
 * on file. Swapping providers later just means rewriting this one file —
 * every call site only ever imports sendVerificationEmail below, never
 * anything Resend-specific.
 *
 * Deliberately fails soft: if RESEND_API_KEY isn't set (fresh clone, CI,
 * a dev who hasn't set up an account yet), sendMail logs the would-be
 * email to the console and resolves instead of throwing, so signup still
 * works end-to-end locally without needing real credentials. In
 * production, `env.RESEND_API_KEY` should always be set — see .env.example.
 */

interface SendMailInput {
  to: string;
  subject: string;
  html: string;
}

export async function sendMail({ to, subject, html }: SendMailInput): Promise<void> {
  if (!env.RESEND_API_KEY) {
    console.warn(
      `✉️  RESEND_API_KEY not set — skipping send. Would have emailed "${subject}" to ${to}.`,
    );
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [to],
      subject,
      html,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Swallow rather than throw — a failed verification email shouldn't
    // fail the signup/resend request itself (the account still exists,
    // and the person can hit "resend" again); it just means they don't
    // get the email this time. Logged loudly so it's not silently lost.
    console.error(`✉️  Resend send failed (${res.status}) to ${to}:`, body);
  }
}

function wrapEmailHtml(title: string, bodyHtml: string): string {
  // Deliberately minimal, table-free HTML — no external stylesheet, no
  // images, inline styles only — so this renders sanely across the usual
  // range of email clients without a templating library.
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #1c1c1e;">
      <h1 style="font-size: 20px; margin: 0 0 16px;">${title}</h1>
      ${bodyHtml}
      <p style="margin-top: 32px; font-size: 12px; color: #8a8a8e;">Chessr</p>
    </div>
  `;
}

export async function sendVerificationEmail(
  to: string,
  username: string,
  verifyUrl: string,
): Promise<void> {
  await sendMail({
    to,
    subject: 'Confirm your Chessr email',
    html: wrapEmailHtml(
      'Confirm your email',
      `
        <p style="font-size: 15px; line-height: 1.5;">Hi ${username}, click below to confirm this is your email address.</p>
        <p style="margin: 24px 0;">
          <a href="${verifyUrl}" style="display: inline-block; background: #4b7399; color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600;">Verify email</a>
        </p>
        <p style="font-size: 13px; color: #6b6b70; line-height: 1.5;">This link expires in 24 hours. If you didn't create a Chessr account, you can ignore this email.</p>
      `,
    ),
  });
}
