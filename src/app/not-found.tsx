import Link from "next/link";
import { buttonClass } from "@/components/ui/Button";
import { Card } from "@/components/ui/Surfaces";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[40rem] py-16">
      <Card className="p-8 text-center">
        <p className="text-label font-bold uppercase tracking-wider text-accent">404</p>
        <h1 className="mt-3 text-card font-bold text-fg">We could not find that</h1>
        <p className="mt-3 text-note leading-relaxed text-fg-muted">
          The page may have moved, or the link may be out of date.
        </p>
        <Link href="/" className={`${buttonClass("accent")} mt-6`}>
          Back to the dashboard
        </Link>
      </Card>
    </div>
  );
}
