import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  // This server's OWN public origin, e.g. https://your-app.up.railway.app in
  // production. Only used to build absolute URLs for assets a link-preview
  // crawler needs to fetch directly (og:image, see og.controller.ts), since
  // those tags require a full URL, not a relative path. Defaults to
  // localhost:PORT for local dev; MUST be set to the real deployed URL in
  // production or shared-link previews will point at an unreachable address.
  API_ORIGIN: z.string().optional(),

  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),

  COOKIE_SECURE: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

  PAYSTACK_SECRET_KEY: z.string().min(1, 'PAYSTACK_SECRET_KEY is required'),
  PAYSTACK_PUBLIC_KEY: z.string().min(1, 'PAYSTACK_PUBLIC_KEY is required'),

  // The platform's cut of every wagered pot, normal games, cage matches,
  // and tournament registration-fee pools all run through the same
  // computeRake() helper in wallet.service.ts, so this one knob controls
  // all three. A whole-number percent, 0-100 (0 = rake disabled entirely).
  // See wallet.service.ts's computeRake for the actual math.
  RAKE_PERCENT: z.coerce.number().min(0).max(100).default(10),

  // Fixed credentials for the single expert-review admin account (see
  // admin.controller.ts), deliberately NOT a User document, so it never
  // shows up in player search, leaderboards, matchmaking, etc, and can't
  // be funded or play games. Optional at the schema level so existing
  // deployments that haven't set these up yet don't fail to boot; the
  // admin login route itself refuses to work until both are set.
  ADMIN_USERNAME: z.string().optional(),
  ADMIN_PASSWORD: z.string().min(12).optional(),

  // Resend (resend.com) sends the "confirm your email" mail, its free
  // tier is generous enough for testing/small-scale use (100/day, 3000/mo)
  // without needing a card on file, and its API is one plain HTTP POST
  // (see mailer.service.ts), so no SDK dependency either. Optional at the
  // schema level so a deployment that hasn't set this up yet still boots;
  // mailer.service.ts logs a warning and no-ops a send instead of
  // throwing when it's missing, so local dev never needs a real account.
  RESEND_API_KEY: z.string().optional(),
  // Must be on a domain verified with Resend, EXCEPT for their shared
  // onboarding@resend.dev sandbox sender, which works immediately with no
  // domain setup, exactly what you want during the "just get this
  // working" testing period the account starts in.
  MAIL_FROM: z.string().default('Chessr <onboarding@resend.dev>'),

  // OAuth 2.0 client ID from Google Cloud Console, the same value the
  // client uses to initialize Google Identity Services (VITE_GOOGLE_CLIENT_ID,
  // see main.tsx) is passed here too, since verifying a Google ID token
  // means checking its `aud` claim matches this exact client id (see
  // auth.controller.ts's googleSignIn). Optional at the schema level so a
  // deployment that hasn't set up Google sign-in yet still boots; that
  // route itself refuses to work until this is set.
  GOOGLE_CLIENT_ID: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
