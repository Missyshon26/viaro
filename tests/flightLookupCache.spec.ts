import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetchFlightDetails: vi.fn() }));

vi.mock('../src/integrations/flightApi', async (orig) => ({
  ...(await orig<typeof import('../src/integrations/flightApi')>()),
  fetchFlightDetails: mocks.fetchFlightDetails,
}));

import { getFlight, resetFlightLookups } from '../src/modules/flight/flight.service';

const real = { flightNumber: 'AS1', status: 'scheduled', scheduledArrival: new Date('2026-11-03T20:00:00Z'), estimatedArrival: null, actualArrival: null, delayMinutes: null, provider: 'aviationstack', placeholder: false };
const placeholder = (reason: string) => ({ ...real, placeholder: true, unavailableReason: reason });

describe('flight lookups for visitors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFlightLookups();
  });

  it('asks the provider once for the same flight and day, then answers from memory', async () => {
    mocks.fetchFlightDetails.mockResolvedValue(real);
    const a = await getFlight('as1', '2026-11-03');
    const b = await getFlight('AS1', '2026-11-03');
    expect(mocks.fetchFlightDetails).toHaveBeenCalledTimes(1);
    expect(a).toMatchObject({ verified: true });
    expect(b).toMatchObject({ verified: true });
  });

  it('keeps "no record yet" but tries again after a failure', async () => {
    mocks.fetchFlightDetails.mockResolvedValue(placeholder('not-found'));
    await getFlight('AS2', '2026-11-03');
    await getFlight('AS2', '2026-11-03');
    expect(mocks.fetchFlightDetails).toHaveBeenCalledTimes(1);

    mocks.fetchFlightDetails.mockResolvedValue(placeholder('error'));
    await getFlight('AS3', '2026-11-03');
    await getFlight('AS3', '2026-11-03');
    expect(mocks.fetchFlightDetails).toHaveBeenCalledTimes(3);
  });

  it('stops calling the provider after the hourly cap and says to try again', async () => {
    mocks.fetchFlightDetails.mockResolvedValue(placeholder('error'));
    for (let i = 0; i < 120; i++) await getFlight(`AS${i}`, '2026-11-03');
    await expect(getFlight('ZZ9', '2026-11-03')).rejects.toMatchObject({ statusCode: 429 });
    expect(mocks.fetchFlightDetails).toHaveBeenCalledTimes(120);
  });
});
