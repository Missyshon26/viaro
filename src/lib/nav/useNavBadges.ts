"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { collectBadgeIds } from "./sources";
import { useLiveChanges } from "@/lib/live/useLiveChanges";


/** Bounded so a long-lived browser cannot grow the entry without limit. */
const MAX_REMEMBERED = 300;

const STORAGE_PREFIX = "abl-seen:";

/**
 * Lets a page tell the sidebar it just changed something.
 *
 * Without this the badges only move on the poll, so acting on an item left its count
 * stale for up to half a minute — exactly when someone is looking for confirmation. The
 * listener set is module-level because the hook lives in the shell while the action
 * happens in a page, with no component tree between them to pass a callback down.
 */
const listeners = new Set<() => void>();

/** Call after any action that adds to or removes from a badged section. */
export function refreshNavBadges() {
  for (const listener of listeners) listener();
}

function readSeen(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    // Private mode, cleared storage, or corrupt JSON — treat everything as unseen.
    return new Set();
  }
}

function writeSeen(key: string, ids: Iterable<string>) {
  try {
    localStorage.setItem(
      STORAGE_PREFIX + key,
      JSON.stringify([...ids].slice(-MAX_REMEMBERED)),
    );
  } catch {
    /* Storage unavailable: badges simply stop persisting across reloads. */
  }
}

export function useNavBadges(): Record<string, number> {
  const pathname = usePathname();
  const [ids, setIds] = useState<Record<string, string[]>>({});
  // Bumped when a section is marked seen, so the memo recomputes against fresh storage.
  const [seenVersion, setSeenVersion] = useState(0);

  const poll = useCallback(async () => {
    const next = await collectBadgeIds();
    // Merge rather than replace: a source that failed this round returns nothing, and
    // dropping its key would blank a badge that is still valid.
    setIds((prev) => ({ ...prev, ...next }));
  }, []);

  useEffect(() => {
    void poll();

    const onDemand = () => void poll();
    listeners.add(onDemand);

    return () => {
      listeners.delete(onDemand);
    };
  }, [poll]);

  /*
   * The badge is the one thing on screen whose whole job is to be current, and a 30 s
   * timer meant it could be more than half a minute behind the thing it counts. The
   * stream announces the change; the hook keeps a slower poll of its own as a fallback,
   * so nothing is lost if the connection cannot be held.
   */
  useLiveChanges(["booking", "trip", "dispatch", "notification"], () => void poll());

  /**
   * Opening a section marks everything currently in it as seen.
   *
   * Keyed on the ids as well as the path: sitting on a screen while new items arrive
   * should still clear them, and it does, because the next poll produces an id this
   * effect has not yet stored.
   */
  useEffect(() => {
    const key = Object.keys(ids).find(
      (candidate) => pathname === candidate || pathname.startsWith(`${candidate}/`),
    );
    if (!key) return;

    const current = ids[key] ?? [];
    if (current.length === 0) return;

    const seen = readSeen(key);
    const missing = current.filter((id) => !seen.has(id));
    if (missing.length === 0) return;

    for (const id of missing) seen.add(id);
    writeSeen(key, seen);
    setSeenVersion((v) => v + 1);
  }, [pathname, ids]);

  return useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [key, list] of Object.entries(ids)) {
      const seen = readSeen(key);
      counts[key] = list.filter((id) => !seen.has(id)).length;
    }
    return counts;
    // seenVersion is the dependency that matters: it changes when storage does, which
    // useMemo cannot observe on its own.
  }, [ids, seenVersion]);
}
