import { redirect } from "next/navigation";

// Keep old bookmarks working; creation now lives in the Trips modal.
export default function NewTripPage() {
  redirect("/trips");
}
