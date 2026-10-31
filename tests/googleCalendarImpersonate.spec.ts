import { beforeEach, describe, expect, it, vi } from 'vitest';

const jwtOptions: Record<string, unknown>[] = [];
vi.mock('google-auth-library', () => ({
  JWT: class {
    constructor(options: Record<string, unknown>) {
      jwtOptions.push(options);
    }
    async request() {
      return { data: { summary: 'reservations' } };
    }
  },
}));

const fakeEnv: Record<string, string | undefined> = {};
vi.mock('../src/config/env', () => ({ env: fakeEnv }));

const key = JSON.stringify({
  client_email: 'abl-calendar@proj.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----\n',
});

beforeEach(() => {
  jwtOptions.length = 0;
  for (const k of Object.keys(fakeEnv)) delete fakeEnv[k];
  vi.resetModules();
});

const load = async () => (await import('../src/integrations/googleCalendar.js')).getCalendarApi();

describe('writing to a person\'s own calendar (domain-wide delegation)', () => {
  it('signs in as that user when GOOGLE_CALENDAR_IMPERSONATE is set', async () => {
    Object.assign(fakeEnv, {
      GOOGLE_CALENDAR_ID: 'reservations@allblacklimoseattle.com',
      GOOGLE_SERVICE_ACCOUNT_JSON: key,
      GOOGLE_CALENDAR_IMPERSONATE: ' reservations@allblacklimoseattle.com ',
    });
    const api = await load();
    expect(api).not.toBeNull();
    await api!.check();
    expect(jwtOptions[0]).toMatchObject({ email: 'abl-calendar@proj.iam.gserviceaccount.com', subject: 'reservations@allblacklimoseattle.com' });
  });

  it('signs in as the robot itself when it is not set (a calendar shared with it)', async () => {
    Object.assign(fakeEnv, { GOOGLE_CALENDAR_ID: 'abc@group.calendar.google.com', GOOGLE_SERVICE_ACCOUNT_JSON: key });
    const api = await load();
    await api!.check();
    expect(jwtOptions[0]).not.toHaveProperty('subject');
  });

  it('is off without a calendar id', async () => {
    Object.assign(fakeEnv, { GOOGLE_SERVICE_ACCOUNT_JSON: key, GOOGLE_CALENDAR_IMPERSONATE: 'reservations@allblacklimoseattle.com' });
    expect(await load()).toBeNull();
  });
});
