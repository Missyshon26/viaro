"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * The sign-in gate renders in place on every URL, so this page only ever mounts once
 * the visitor is signed in — its whole job is to move them off /login and onto the
 * dashboard instead of leaving them on a 404 shell.
 */
export default function LoginPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/");
  }, [router]);

  return null;
}
