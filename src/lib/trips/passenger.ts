/**
 * What to send the API when the travelling passenger's name or phone is edited. Each is
 * optional on its own. The API reads `passengerName: null` as "I am the passenger after all"
 * and clears the phone with it, unless a phone is sent along to keep. Only fields that
 * changed are sent, so each change is recorded once.
 */
export function passengerChanges(
  before: { name: string; phone: string },
  now: { name: string; phone: string },
): { passengerName?: string | null; passengerPhone?: string | null } {
  const name = now.name.trim();
  const phone = now.phone.trim();
  if (name === before.name && phone === before.phone) return {};

  const out: { passengerName?: string | null; passengerPhone?: string | null } = {};
  if (name && name !== before.name) out.passengerName = name;
  else if (!name && before.name) out.passengerName = null;

  if (phone && phone !== before.phone) out.passengerPhone = phone;
  // Clearing the name already clears the phone on the API; only clear it separately when the
  // name stays, or there was no name to clear.
  else if (!phone && before.phone && (name || !before.name)) out.passengerPhone = null;
  // A cleared name with a phone that did not change: send the phone so it is kept.
  else if (phone && out.passengerName === null) out.passengerPhone = phone;
  return out;
}
