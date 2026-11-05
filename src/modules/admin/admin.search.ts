const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The clauses that let the trips search find a booking by the number the console shows for it:
 * the invoice number ("13777", or "INV-F8E430" when there is no running number) and the older
 * "ABL-F8E430" reference, which is the tail of the booking id.
 */
export function referenceClauses(text: string): Record<string, unknown>[] {
  const pattern = new RegExp(escapeRegex(text), 'i');
  const clauses: Record<string, unknown>[] = [{ tripNo: pattern }, { 'legacy.tripNo': pattern }];
  const hex = text.trim().replace(/^(abl|inv)-?/i, '');
  if (/^[0-9a-f]{3,24}$/i.test(hex)) {
    clauses.push({
      $expr: { $regexMatch: { input: { $toString: '$_id' }, regex: `${escapeRegex(hex)}$`, options: 'i' } },
    });
  }
  return clauses;
}
