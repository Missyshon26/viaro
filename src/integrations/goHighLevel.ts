import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * GoHighLevel (the CRM), as old ABL used it: the customer becomes a contact tagged
 * "service completed" the moment a trip is completed, and a workflow already built inside
 * GoHighLevel ("Post-Service Feedback Survey") watches for that tag and sends the feedback email
 * itself. The email's wording, its timing and any follow-ups live entirely there — not here.
 *
 * Everything the caller needs is the GoHighLevel interface below, so tests (and any future CRM)
 * can stand in for the real one. A call that fails is reported to the caller, never thrown.
 */
export interface GoHighLevelContact {
  email: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
}

export type GoHighLevelResult = { ok: true } | { ok: false; reason: string };

export interface GoHighLevel {
  /** Creates or updates the contact and gives it the "service completed" tag. */
  tagServiceCompleted(contact: GoHighLevelContact): Promise<GoHighLevelResult>;
}

const BASE_URL = 'https://services.leadconnectorhq.com';
const API_VERSION = '2021-07-28';
export const DEFAULT_TAG = 'service completed';
const TIMEOUT_MS = 10_000;

function realClient(token: string, locationId: string, tag: string): GoHighLevel {
  return {
    async tagServiceCompleted(contact) {
      try {
        const res = await fetch(`${BASE_URL}/contacts/upsert`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            Version: API_VERSION,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            locationId,
            email: contact.email,
            phone: contact.phone || undefined,
            firstName: contact.firstName || undefined,
            lastName: contact.lastName || undefined,
            tags: [tag],
          }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) {
          const detail = (await res.text().catch(() => '')).slice(0, 300);
          return { ok: false, reason: `GoHighLevel answered ${res.status}${detail ? `: ${detail}` : ''}` };
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, reason: (err as Error).message || 'GoHighLevel could not be reached' };
      }
    },
  };
}

let override: GoHighLevel | null = null;

/** For tests: use this in place of GoHighLevel. Pass null to go back to the real one. */
export function setGoHighLevel(client: GoHighLevel | null): void {
  override = client;
}

export function getGoHighLevel(): GoHighLevel | null {
  if (override) return override;
  const token = env.GHL_API_TOKEN?.trim();
  const locationId = env.GHL_LOCATION_ID?.trim();
  if (!token || !locationId) return null;
  return realClient(token, locationId, env.GHL_SERVICE_COMPLETED_TAG?.trim() || DEFAULT_TAG);
}

export function isGoHighLevelEnabled(): boolean {
  return getGoHighLevel() !== null;
}

/** Logged once at boot, so "why did no survey go out" has an answer in the log. */
export function logGoHighLevelStatus(): void {
  if (isGoHighLevelEnabled()) logger.info('GoHighLevel is on: completed trips are tagged for the feedback survey');
  else logger.info('GoHighLevel is off (GHL_API_TOKEN and GHL_LOCATION_ID are not both set)');
}
