import type { Request, Response } from 'express';
import { isAddressedTo, subscribe, type ChangeEvent } from './events.bus';
import { logger } from '../../utils/logger';

/**
 * How often a comment frame is written to keep the connection from being reaped.
 *
 * Proxies and load balancers close idle connections, typically at 60 s. A quiet fleet at
 * 3 a.m. is exactly when a dropped stream would go unnoticed, so the heartbeat is well
 * inside that.
 */
const HEARTBEAT_MS = 25_000;

/**
 * Server-Sent Events stream of change announcements.
 *
 * SSE rather than the socket.io server that already exists here: the three consoles ship
 * with no runtime dependencies beyond next/react/react-dom, and adding a socket client
 * to each of them to carry "your list is stale" would be a large cost for a small
 * message. This endpoint needs no client library at all.
 *
 * Note that the payload deliberately carries no domain data — only a topic, an action
 * and an id. Clients re-read through the ordinary REST endpoints, so role-based response
 * shaping (a driver never seeing fareAmount, a customer never seeing a real phone
 * number) keeps applying exactly as it does everywhere else. A stream that pushed
 * documents would have to re-implement all of it and would eventually get it wrong.
 */
export function stream(req: Request, res: Response): void {
  const viewer = req.user!;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Nginx buffers proxied responses by default, which would hold every frame back
    // until the connection closed — the exact opposite of the point.
    'X-Accel-Buffering': 'no',
  });

  // Flushes headers immediately so the client's stream reader resolves rather than
  // sitting on an open request with nothing to read.
  res.write(`: connected\n\n`);

  const send = (event: ChangeEvent) => {
    if (!isAddressedTo(event, viewer)) return;

    // `roles` and `userIds` are addressing metadata for this server, not information
    // the subscriber asked for — forwarding them would hand every operator console the
    // user id behind each change for no benefit. Only what a client acts on goes out.
    const { topic, action, id, at } = event;
    res.write(`event: change\ndata: ${JSON.stringify({ topic, action, id, at })}\n\n`);
  };

  const unsubscribe = subscribe(send);
  const heartbeat = setInterval(() => res.write(`: ping\n\n`), HEARTBEAT_MS);

  const close = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };

  req.on('close', close);
  res.on('error', (err) => {
    logger.debug(`Event stream for ${viewer.userId} errored: ${String(err)}`);
    close();
  });
}
