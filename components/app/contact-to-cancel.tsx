import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SUPPORT_HOURS, SUPPORT_PHONE, SUPPORT_PHONE_HREF } from "@/lib/constants";

const PHONE = SUPPORT_PHONE;
const HOURS = SUPPORT_HOURS;

/**
 * Cancellations and late changes go through a person.
 *
 * Not a technical limitation — `DELETE /bookings/:id` and the three cancellation routes
 * all exist and work. It is a policy one: the refund a customer gets depends on how
 * close to pickup they are (90% outside the window, nothing inside it), and letting
 * someone discover that by pressing a button and losing the fare is a bad way to learn
 * it. A call means the amount is agreed before anything moves.
 *
 * The number is SUPPORT_PHONE (lib/constants), which ignores a placeholder value — the
 * production build was showing "000000000" here.
 */
export function ContactToCancel({
  reason,
  /**
   * `buttons` where calling us is the only way forward — the locked edit page, the
   * cancel panel on that page.
   *
   * `inline` where the panel already owns a real action. Two full-width buttons beside
   * a live Cancel control read as three equal choices, and the blue one pulled the eye
   * hardest despite being the least consequential of them. As text the offer is still
   * there without competing for the press.
   */
  variant = "buttons",
}: {
  reason: "cancel" | "change";
  variant?: "buttons" | "inline";
}) {
  const label = reason === "cancel" ? "Call us to cancel" : "Call us to change it";

  if (variant === "inline") {
    const linkClass =
      "font-medium text-foreground underline underline-offset-4 transition-colors hover:text-primary";

    return (
      <p className="text-xs leading-relaxed text-muted-foreground">
        Not sure what you would get back?{" "}
        {PHONE ? (
          <a href={SUPPORT_PHONE_HREF} className={linkClass}>
            Call {PHONE}
          </a>
        ) : (
          <Link href="/support/new" className={linkClass}>
            Call us
          </Link>
        )}{" "}
        or{" "}
        <Link href="/support/new" className={linkClass}>
          message support
        </Link>
        .{HOURS ? ` ${HOURS}` : ""}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      {PHONE ? (
        <Button asChild size="lg">
          <a href={SUPPORT_PHONE_HREF}>
            {label} · {PHONE}
          </a>
        </Button>
      ) : (
        <Button asChild size="lg">
          <Link href="/support/new">{label}</Link>
        </Button>
      )}

      <Button asChild variant="outline" size="lg">
        <Link href="/support/new">Message support instead</Link>
      </Button>

      {HOURS ? (
        <p className="text-xs text-muted-foreground sm:ml-1">{HOURS}</p>
      ) : null}
    </div>
  );
}
