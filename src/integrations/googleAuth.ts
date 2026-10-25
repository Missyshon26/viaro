import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';

/**
 * Checks a "Sign in with Google" ID token and says who it belongs to.
 *
 * Google signs the token; verifyIdToken checks that signature against Google's published
 * keys, that it was issued for OUR client id (a token minted for some other site is
 * refused), and that it has not expired. Nothing the browser says about itself is trusted
 * beyond that.
 */
export interface GoogleProfile {
  /** Google's stable account id — unlike an email address it never changes hands. */
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  givenName?: string;
  familyName?: string;
}

let client: OAuth2Client | null = null;

export const isGoogleSignInEnabled = (): boolean => Boolean(env.GOOGLE_CLIENT_ID);

export async function verifyGoogleCredential(credential: string): Promise<GoogleProfile> {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new ApiError(503, 'Google sign-in is not available right now.', { code: 'GOOGLE_DISABLED' });
  }
  client ??= new OAuth2Client(env.GOOGLE_CLIENT_ID);

  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: env.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    throw ApiError.unauthorized('Google could not confirm that sign-in. Please try again.');
  }
  if (!payload?.sub || !payload.email) {
    throw ApiError.unauthorized('Google did not share an email address for that account.');
  }

  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: payload.email_verified === true,
    name: payload.name?.trim() || payload.email.split('@')[0],
    givenName: payload.given_name,
    familyName: payload.family_name,
  };
}
