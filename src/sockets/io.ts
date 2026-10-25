import type { Server as SocketIOServer } from 'socket.io';
import { logger } from '../utils/logger';

/**
 * Socket.io instance registry.
 *
 * server.ts creates the instance and registers it here. Services import from THIS module
 * rather than from server.ts, which would otherwise create an import cycle
 * (server -> app -> routes -> service -> server).
 */
let ioInstance: SocketIOServer | null = null;

export function setIo(io: SocketIOServer): void {
  ioInstance = io;
}

export function getIo(): SocketIOServer | null {
  return ioInstance;
}

/** Namespace name builders — one place, so emitters and listeners can never drift apart. */
export const ns = {
  dispatch: '/dispatch',
  tracking: (tripId: string) => `/tracking/${tripId}`,
  chat: (tripId: string) => `/chat/${tripId}`,
  notify: (userId: string) => `/notify/${userId}`,
};

/** Regex forms used to register the dynamic (per-id) namespaces. */
export const nsPattern = {
  tracking: /^\/tracking\/[a-fA-F0-9]{24}$/,
  chat: /^\/chat\/[a-fA-F0-9]{24}$/,
  notify: /^\/notify\/[a-fA-F0-9]{24}$/,
};

/**
 * Emit into a dynamic namespace only if it actually exists — i.e. somebody is (or was)
 * connected. Calling io.of(name) blindly would materialise a brand-new namespace that
 * bypasses the parent's auth middleware, so we look it up instead.
 */
export function emitTo(namespace: string, event: string, payload: unknown): boolean {
  const io = ioInstance;
  if (!io) {
    logger.debug(`Socket.io not initialised; dropped ${event} for ${namespace}`);
    return false;
  }

  const nsp = io._nsps.get(namespace);
  if (!nsp) return false;

  nsp.emit(event, payload);
  return true;
}
