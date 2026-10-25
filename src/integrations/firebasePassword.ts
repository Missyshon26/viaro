import { env } from '../config/env';

/**
 * Checks an email + password against the old Firebase project, for customers whose
 * password has not yet been carried into this app.
 *
 * Firebase's own "sign in with password" REST call does the check: it holds the stored
 * hash and the secret parameters that make it verifiable, so none of that has to be
 * exported or copied here. The web API key it needs is the public one the old booking
 * site already ships to every browser — it identifies the project, it is not a secret.
 * Nothing in the response is kept except the verdict and Firebase's account id.
 */
export type FirebaseVerdict =
  | { ok: true; uid: string }
  | { ok: false; reason: 'wrong_password' | 'unavailable' };

const ENDPOINT = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';

export const isFirebaseLoginEnabled = (): boolean => Boolean(env.FIREBASE_WEB_API_KEY);

export async function verifyFirebasePassword(
  email: string,
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<FirebaseVerdict> {
  if (!env.FIREBASE_WEB_API_KEY) return { ok: false, reason: 'unavailable' };

  let res: Response;
  try {
    res = await fetchImpl(`${ENDPOINT}?key=${encodeURIComponent(env.FIREBASE_WEB_API_KEY)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: false }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { ok: false, reason: 'unavailable' };
  }

  if (res.ok) {
    const body = (await res.json().catch(() => null)) as { localId?: string } | null;
    return body?.localId ? { ok: true, uid: body.localId } : { ok: false, reason: 'unavailable' };
  }

  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  const code = body?.error?.message ?? '';
  // Wrong password, unknown account, disabled account and throttling all mean "not signed
  // in"; only a transport/server failure is "unavailable".
  if (res.status >= 500) return { ok: false, reason: 'unavailable' };
  if (/INVALID_PASSWORD|INVALID_LOGIN_CREDENTIALS|EMAIL_NOT_FOUND|USER_DISABLED|TOO_MANY_ATTEMPTS/.test(code)) {
    return { ok: false, reason: 'wrong_password' };
  }
  return { ok: false, reason: 'unavailable' };
}
