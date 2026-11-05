import { describe, expect, it } from 'vitest';
import { referenceClauses } from '../src/modules/admin/admin.search';

const hasId = (c: Record<string, unknown>[]) => c.find((x) => '$expr' in x) as { $expr: { $regexMatch: { regex: string } } } | undefined;

describe('trips search by the number the console shows', () => {
  it('finds a booking by its running invoice number, current or old-site', () => {
    const c = referenceClauses('13777');
    expect(c[0]).toEqual({ tripNo: /13777/i });
    expect(c[1]).toEqual({ 'legacy.tripNo': /13777/i });
  });

  it('matches the tail of the id for the INV- and ABL- forms alike', () => {
    expect(hasId(referenceClauses('INV-F8E430'))?.$expr.$regexMatch.regex).toBe('F8E430$');
    expect(hasId(referenceClauses('abl-f8e430'))?.$expr.$regexMatch.regex).toBe('f8e430$');
    expect(hasId(referenceClauses('F8E430'))?.$expr.$regexMatch.regex).toBe('F8E430$');
  });

  it('does not treat free text as an id, and escapes regex characters', () => {
    expect(hasId(referenceClauses('Bellevue'))).toBeUndefined();
    expect(referenceClauses('a.b')[0]).toEqual({ tripNo: /a\.b/i });
  });
});
