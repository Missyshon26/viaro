import type { Server as SocketIOServer, Socket } from 'socket.io';
import { socketAuthMiddleware } from './socketAuth';
import { nsPattern } from './io';
import { logger } from '../utils/logger';
import * as chatService from '../modules/chat/chat.service';
import { chatMessageSchema } from '../modules/chat/chat.validation';

/**
 * '/chat/:tripId' namespace (spec §5, §4.9).
 *
 * Customer and driver on the trip may send and receive. Admins may connect and receive
 * only — the read-only rule is enforced HERE on the server, not by hiding a send button
 * in a client, which is the whole point of the "Monitor Chats" requirement.
 */
export function attachChatNamespace(io: SocketIOServer): void {
  const parent = io.of(nsPattern.chat);

  parent.use(socketAuthMiddleware);

  parent.use(async (socket, next) => {
    const tripId = socket.nsp.name.split('/').pop() as string;
    try {
      const participation = await chatService.assertChatAccess(tripId, socket.user!);
      socket.data.tripId = tripId;
      socket.data.canSend = participation.canSend;
      next();
    } catch (err) {
      next(err instanceof Error ? err : new Error('Chat authorisation failed'));
    }
  });

  parent.on('connection', (socket: Socket) => {
    const tripId = socket.data.tripId as string;
    const user = socket.user!;

    socket.on('message:new', async (payload: unknown) => {
      // Server-side read-only enforcement for admins.
      if (!socket.data.canSend) {
        socket.emit('chat:error', { message: 'Read-only access — admins may monitor chats only' });
        return;
      }

      const parsed = chatMessageSchema.safeParse(payload);
      if (!parsed.success) {
        socket.emit('chat:error', { message: parsed.error.issues[0]?.message ?? 'Invalid message' });
        return;
      }

      try {
        // Same path as POST /trips/:id/chat/messages: saves, broadcasts on this
        // namespace and notifies open chat screens.
        await chatService.postMessage(tripId, user, parsed.data.message);
      } catch (err) {
        logger.warn(`Chat message rejected for trip ${tripId}`, err);
        socket.emit('chat:error', { message: 'Message could not be delivered' });
      }
    });
  });
}
