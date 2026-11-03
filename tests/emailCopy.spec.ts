import { describe, expect, it, vi } from 'vitest';

describe('the blind copy on invoice and payment-link emails', () => {
  it('goes to reservations by default', async () => {
    const { copyFor } = await import('../src/integrations/emailCopy');
    expect(copyFor('pat@example.com')).toEqual({ bcc: 'reservations@allblacklimoseattle.com' });
  });

  it('is skipped when the customer is that address, so they do not get it twice', async () => {
    const { copyFor } = await import('../src/integrations/emailCopy');
    expect(copyFor(' Reservations@AllBlackLimoSeattle.com ')).toEqual({});
  });

  it('can be switched off by blanking INVOICE_BCC_EMAIL', async () => {
    vi.resetModules();
    vi.doMock('../src/config/env', async (orig) => {
      const actual = await orig<typeof import('../src/config/env')>();
      return { ...actual, env: { ...actual.env, INVOICE_BCC_EMAIL: '' } };
    });
    const { copyFor } = await import('../src/integrations/emailCopy');
    expect(copyFor('pat@example.com')).toEqual({});
    vi.doUnmock('../src/config/env');
  });
});
