/**
 * The refund popup's pure logic: how much is left to refund, and whether what an operator
 * typed is a refundable amount. No React and no fetching, so it can be tested on its own.
 */
const cents = (dollars: number) => Math.round(dollars * 100);

/** What is still refundable on a payment, in dollars (never below zero). */
export function refundable(payment: { amount: number; refundedAmount: number }): number {
  return Math.max(0, (cents(payment.amount) - cents(payment.refundedAmount)) / 100);
}

/** Reads a typed amount: a number of dollars and cents, above zero and not above `remaining`. */
export function parseRefundAmount(
  text: string,
  remaining: number,
): { amount: number | null; error: string | null } {
  const cleaned = text.trim().replace(/^\$/, "").replace(/,/g, "");
  if (cleaned === "") return { amount: null, error: null };
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return { amount: null, error: "Enter dollars and cents, like 25 or 25.50." };

  const amount = Number(cleaned);
  if (amount <= 0) return { amount: null, error: "Enter an amount greater than zero." };
  if (cents(amount) > cents(remaining)) {
    return { amount: null, error: `The most you can refund is $${remaining.toFixed(2)}.` };
  }
  return { amount, error: null };
}

/** One per dialog opening: the server refunds a repeated request once, so a double click is safe. */
export function newRequestId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
