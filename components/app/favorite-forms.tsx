"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { addFavoriteAction } from "@/lib/actions/trip";

/**
 * Saves a chauffeur the passenger has ridden with.
 *
 * Replaces a form that asked for a 24-character driver id (a Mongo ObjectId) — nobody
 * could know one. Favourites are now offered from trip history, the trip page and the
 * "chauffeurs you've ridden with" list, and the API only accepts a chauffeur who has
 * completed a trip for this passenger.
 */
export function AddFavoriteButton({
  driverId,
  name,
  already = false,
  size = "default",
}: {
  driverId: string;
  name?: string | null;
  already?: boolean;
  size?: "default" | "sm";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(already);

  return (
    <Button
      type="button"
      variant={saved ? "outline" : "default"}
      size={size}
      disabled={pending || saved}
      className="w-full gap-2 sm:w-auto"
      onClick={() =>
        start(async () => {
          const result = await addFavoriteAction(driverId);
          if (result?.error) {
            toast.error(result.error);
            return;
          }
          setSaved(true);
          toast.success(`${name ?? "Chauffeur"} added to your favourites`);
          router.refresh();
        })
      }
    >
      <Heart className={`h-4 w-4 ${saved ? "fill-azure text-azure" : ""}`} />
      {saved ? "In your favourites" : pending ? "Saving…" : "Add to favourites"}
    </Button>
  );
}
