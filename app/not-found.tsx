import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center bg-black px-6">
      <div className="max-w-md text-center">
        <p className="text-sm uppercase tracking-[0.08em] text-brand">404</p>
        <h1 className="mt-4 font-sans text-3xl font-bold text-foreground">
          We could not find that
        </h1>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          The page may have moved, or the link may be out of date.
        </p>
        <Button asChild className="mt-8">
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </main>
  );
}
