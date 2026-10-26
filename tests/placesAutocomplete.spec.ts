import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/env', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/config/env')>();
  return { ...real, env: { ...real.env, GOOGLE_MAPS_SERVER_KEY: 'test-key' } };
});

import { autocompletePlaces } from '../src/integrations/placesAutocomplete';

const reply = (body: unknown) => vi.fn(async (_url: unknown) => ({ json: async () => body }) as Response);

afterEach(() => vi.unstubAllGlobals());

describe('autocompletePlaces', () => {
  it('returns descriptions and ids, at most five, from Google with the server key', async () => {
    const fetchMock = reply({
      status: 'OK',
      predictions: Array.from({ length: 7 }, (_, i) => ({ description: `Place ${i}`, place_id: `id${i}` })),
    });
    vi.stubGlobal('fetch', fetchMock);
    const out = await autocompletePlaces('sea');
    expect(out).toHaveLength(5);
    expect(out[0]).toEqual({ description: 'Place 0', placeId: 'id0' });
    expect(String(fetchMock.mock.calls[0][0])).toContain('key=test-key');
  });

  it('does not ask Google for fewer than three characters', async () => {
    const fetchMock = reply({ status: 'OK', predictions: [] });
    vi.stubGlobal('fetch', fetchMock);
    expect(await autocompletePlaces('se')).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('answers no suggestions, not an error, when Google refuses or is unreachable', async () => {
    vi.stubGlobal('fetch', reply({ status: 'REQUEST_DENIED' }));
    expect(await autocompletePlaces('seattle')).toEqual([]);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await autocompletePlaces('seattle')).toEqual([]);
  });
});
