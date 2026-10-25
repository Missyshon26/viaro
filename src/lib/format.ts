
/**
 * "+15550100005" → "+1 (555) 010-0005". Clash Display draws "1" and "0" narrow and has
 * no tabular figures, so an unbroken run of digits reads as a smudge. Anything that is
 * not a 10-digit North American number is returned unchanged.
 */
export function formatPhone(value?: string | null): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return value;
  return `+1 (${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}
