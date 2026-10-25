/**
 * The "Tax, tips and discounts" form: turning what was typed into what the API takes, with
 * the same limits the API enforces so a mistake is caught on the form, in words, before it
 * is saved. No React and no fetching, so it can be tested on its own.
 *
 * A blank box is an error, never a zero: this console once saved a live city at $0.00
 * because an empty field was read as 0. "No discount" is typed as 0.
 */
export interface ExtrasForm {
  taxPct: string;
  welcomeDiscount: string;
  loyaltyDiscount: string;
  loyaltyEveryNth: string;
}

export interface ExtrasPayload {
  taxPct: number;
  welcomeDiscount: number;
  loyaltyDiscount: number;
  loyaltyEveryNth: number;
}

export type ExtrasResult =
  | { ok: true; payload: ExtrasPayload }
  | { ok: false; errors: Partial<Record<keyof ExtrasForm, string>> };

const cleaned = (text: string) => text.trim().replace(/^\$/, "").replace(/%$/, "").replace(/,/g, "");

function amount(text: string, max: number, what: string): { value?: number; error?: string } {
  const t = cleaned(text);
  if (t === "") return { error: `Enter ${what}, or 0 for none.` };
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { error: "Enter a number like 20 or 7.5." };
  const value = Number(t);
  if (value > max) return { error: `That is more than the ${max} allowed.` };
  return { value };
}

export function parseExtras(form: ExtrasForm): ExtrasResult {
  const errors: Partial<Record<keyof ExtrasForm, string>> = {};

  const tax = amount(form.taxPct, 30, "the tax percentage");
  if (tax.error) errors.taxPct = tax.error.replace("the 30 allowed", "the 30% allowed");
  else if ((tax.value as number) > 30) errors.taxPct = "Tax above 30% is probably a typo.";

  const welcome = amount(form.welcomeDiscount, 1000, "the welcome discount");
  if (welcome.error) errors.welcomeDiscount = welcome.error;

  const loyalty = amount(form.loyaltyDiscount, 1000, "the loyalty discount");
  if (loyalty.error) errors.loyaltyDiscount = loyalty.error;

  const nthText = cleaned(form.loyaltyEveryNth);
  let nth: number | undefined;
  if (nthText === "") errors.loyaltyEveryNth = "Enter which trip earns it, like 4 for every 4th.";
  else if (!/^\d+$/.test(nthText)) errors.loyaltyEveryNth = "Enter a whole number like 4.";
  else {
    nth = Number(nthText);
    if (nth < 2) errors.loyaltyEveryNth = "At least every 2nd trip.";
    else if (nth > 50) errors.loyaltyEveryNth = "At most every 50th trip.";
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    payload: {
      taxPct: tax.value as number,
      welcomeDiscount: welcome.value as number,
      loyaltyDiscount: loyalty.value as number,
      loyaltyEveryNth: nth as number,
    },
  };
}

/** "every 4th trip" — the loyalty rule in the words a customer would read. */
export function ordinal(n: number): string {
  const rest = n % 100;
  if (rest >= 11 && rest <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}
