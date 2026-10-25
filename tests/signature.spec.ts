import { describe, expect, it } from 'vitest';
import { assertPngDataUrl } from '../src/utils/signature';
import { signAgreementSchema } from '../src/modules/users/users.validation';
import { AGREEMENT_VERSION, MAX_SIGNATURE_BYTES } from '../src/config/agreement';

/** An 8-byte PNG signature plus padding: enough to be recognised as PNG, no decoder needed. */
const png = (extra = 40) =>
  `data:image/png;base64,${Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(extra, 1),
  ]).toString('base64')}`;

describe('assertPngDataUrl', () => {
  it('accepts a small PNG data URL', () => {
    expect(assertPngDataUrl(png())).toBe(48);
  });

  it.each([
    ['an SVG', `data:image/svg+xml;base64,${Buffer.from('<svg onload="x()"/>').toString('base64')}`],
    ['a plain URL', 'https://example.com/sig.png'],
    ['base64 that is not a PNG', `data:image/png;base64,${Buffer.from('<html>'.repeat(10)).toString('base64')}`],
    ['text after the payload', `${png()}"><script>`],
  ])('rejects %s', (_l, value) => {
    expect(() => assertPngDataUrl(value)).toThrow('PNG');
  });

  it('rejects an oversized image', () => {
    expect(() => assertPngDataUrl(png(MAX_SIGNATURE_BYTES + 1))).toThrow('too large');
  });
});

describe('signAgreementSchema', () => {
  const ok = { signature: png(), accepted: true, version: AGREEMENT_VERSION };

  it('needs the box ticked, not just a signature', () => {
    expect(signAgreementSchema.safeParse(ok).success).toBe(true);
    expect(signAgreementSchema.safeParse({ ...ok, accepted: false }).success).toBe(false);
    expect(signAgreementSchema.safeParse({ ...ok, accepted: undefined }).success).toBe(false);
  });
});
