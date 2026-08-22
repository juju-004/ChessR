import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

let client: OAuth2Client | null = null;

function getClient(): OAuth2Client {
  if (!env.GOOGLE_CLIENT_ID) {
    // Distinct from an invalid-token 401 — this means the deployment
    // itself hasn't configured Google sign-in yet, which is a server
    // config problem, not something the caller did wrong.
    throw ApiError.internal('Google sign-in is not configured on this server');
  }
  if (!client) client = new OAuth2Client(env.GOOGLE_CLIENT_ID);
  return client;
}

export interface GoogleProfile {
  googleId: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

/**
 * Verifies a Google Identity Services credential (a signed JWT ID token
 * the client gets straight from Google, never touching our server until
 * this call) — checks the signature against Google's published keys, the
 * `aud` claim against our own GOOGLE_CLIENT_ID, and expiry, all inside
 * google-auth-library. Throws ApiError.unauthorized on anything invalid;
 * never trust a credential this hasn't validated.
 */
export async function verifyGoogleCredential(idToken: string): Promise<GoogleProfile> {
  const oauthClient = getClient();

  let payload;
  try {
    const ticket = await oauthClient.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch {
    throw ApiError.unauthorized('Invalid Google credential');
  }

  if (!payload?.sub || !payload.email) {
    throw ApiError.unauthorized('Invalid Google credential');
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified ?? false,
    name: payload.name ?? payload.email.split('@')[0],
  };
}
