import { Card } from "@/components/ui/Surfaces";

/** Skeleton shaped like the console body, so the layout does not jump. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="h-7 w-56 animate-pulse rounded-md bg-surface" />
      <div className="mt-3 h-4 w-80 animate-pulse rounded bg-surface" />

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="p-5">
            <div className="h-3 w-20 animate-pulse rounded bg-surface" />
            <div className="mt-3 h-7 w-24 animate-pulse rounded bg-surface" />
          </Card>
        ))}
      </div>

      <Card className="mt-4 p-6">
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-4 w-full animate-pulse rounded bg-surface" />
          ))}
        </div>
      </Card>
    </div>
  );
}
