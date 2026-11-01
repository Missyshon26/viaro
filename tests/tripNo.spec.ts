import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ update: vi.fn(), exists: vi.fn(), aggregate: vi.fn() }));
vi.mock('../src/models/Counter', () => ({
  Counter: { findOneAndUpdate: () => ({ lean: mocks.update }) },
}));
vi.mock('../src/models/Booking', () => ({ Booking: { exists: mocks.exists, aggregate: mocks.aggregate } }));
vi.mock('../src/utils/logger', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

import { nextTripNo } from '../src/modules/booking/booking.tripNo';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.aggregate.mockResolvedValue([]);
  mocks.exists.mockResolvedValue(null);
});

describe('nextTripNo', () => {
  it('hands back the counter as a plain number string', async () => {
    mocks.update.mockResolvedValue({ seq: 13776 });
    expect(await nextTripNo()).toBe('13776');
  });

  it('steps over a number an imported old booking already holds', async () => {
    mocks.update.mockResolvedValueOnce({ seq: 13776 }).mockResolvedValueOnce({ seq: 13777 });
    mocks.exists.mockResolvedValueOnce({ _id: 'x' }).mockResolvedValueOnce(null);
    expect(await nextTripNo()).toBe('13777');
  });

  it('tries again after a database error, then succeeds', async () => {
    mocks.update.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce({ seq: 5 });
    expect(await nextTripNo()).toBe('5');
  });

  it('never throws: gives undefined so the booking is still saved', async () => {
    mocks.update.mockRejectedValue(new Error('down'));
    await expect(nextTripNo()).resolves.toBeUndefined();
    expect(mocks.update).toHaveBeenCalledTimes(3);
  });
});
