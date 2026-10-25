import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ findById: vi.fn(), findByIdAndUpdate: vi.fn() }));

vi.mock('../src/models/User', async (orig) => {
  const actual = await orig<typeof import('../src/models/User')>();
  return {
    ...actual,
    User: Object.assign(actual.User, {
      findById: mocks.findById,
      findByIdAndUpdate: mocks.findByIdAndUpdate,
    }),
  };
});

import { getAgreementStatus, signAgreement } from '../src/modules/users/users.service';
import { AGREEMENT_VERSION } from '../src/config/agreement';

const png = `data:image/png;base64,${Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(40, 1),
]).toString('base64')}`;

/** Mongoose query stand-in: chainable select, then lean/await. */
const query = (doc: unknown) => {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.lean = async () => doc;
  q.then = (resolve: (v: unknown) => unknown) => resolve(doc);
  return q;
};

describe('rental agreement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports unsigned for a user who never signed', async () => {
    mocks.findById.mockReturnValue(query({ role: 'customer' }));
    expect(await getAgreementStatus('u1')).toMatchObject({ signed: false, signedAt: null });
  });

  it('treats a signature on an older wording as unsigned', async () => {
    mocks.findById.mockReturnValue(
      query({ agreement: { version: '2020-01', signedAt: new Date('2020-01-01') } }),
    );
    const status = await getAgreementStatus('u1');
    expect(status.signed).toBe(false);
    expect(status.version).toBe('2020-01');
  });

  it('only includes the signature image when asked', async () => {
    const doc = {
      agreement: { version: AGREEMENT_VERSION, signedAt: new Date() },
      signature: png,
    };
    mocks.findById.mockReturnValue(query(doc));
    expect(await getAgreementStatus('u1')).not.toHaveProperty('signature');
    expect(await getAgreementStatus('u1', { withSignature: true })).toMatchObject({ signature: png, signed: true });
  });

  it('refuses a signature against a stale agreement version', async () => {
    await expect(signAgreement('u1', { signature: png, accepted: true, version: 'old' })).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(mocks.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('refuses something that is not a PNG', async () => {
    await expect(
      signAgreement('u1', { signature: 'data:image/png;base64,AAAA', accepted: true, version: AGREEMENT_VERSION }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(mocks.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it('stores the signature and stamps the current version', async () => {
    mocks.findByIdAndUpdate.mockReturnValue(query({ _id: 'u1' }));
    mocks.findById.mockReturnValue(
      query({ agreement: { version: AGREEMENT_VERSION, signedAt: new Date() } }),
    );

    const status = await signAgreement('u1', { signature: png, accepted: true, version: AGREEMENT_VERSION });

    const update = mocks.findByIdAndUpdate.mock.calls[0][1].$set;
    expect(update.signature).toBe(png);
    expect(update.agreement.version).toBe(AGREEMENT_VERSION);
    expect(status.signed).toBe(true);
  });
});
