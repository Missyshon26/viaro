import type { Server as SocketIOServer, Socket } from 'socket.io';
import { socketAuthMiddleware } from './socketAuth';
import { nsPattern } from './io';
import { logger } from '../utils/logger';

/**
 * '/notify/:userId' namespace (spec §5) — personal notification feed.
 *
 * A user may only subscribe to their own feed; admins are not given a backdoor here
 * because notifications are personal, unlike chat which has an explicit monitoring
 * requirement.
 *
 * Emits: notification:new (published by notifications.service.send)
 */
export function attachNotifyNamespace(io: SocketIOServer): void {
  const parent = io.of(nsPattern.notify);

  parent.use(socketAuthMiddleware);

  parent.use((socket, next) => {
    const userId = socket.nsp.name.split('/').pop();
    if (userId !== socket.user?.userId) {
      next(new Error('You can only subscribe to your own notification feed'));
      return;
    }
    next();
  });

  parent.on('connection', (socket: Socket) => {
    logger.info(`User ${socket.user?.userId} subscribed to ${socket.nsp.name}`);
  });
}
