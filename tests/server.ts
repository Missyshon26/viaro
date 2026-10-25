import http from 'node:http';
import type { RequestListener } from 'node:http';
import { afterAll } from 'vitest';

/**
 * One long-lived HTTP server for a test file, for use with supertest: `request(server)`.
 *
 * `request(app)` starts a NEW server on a random port for every request. Over a few
 * thousand requests, a later server occasionally lands on a port an earlier one used and is
 * answered by the wrong socket — Node itself replies "400 Bad Request" before any
 * application code runs, or a request never completes, or a status belonging to another
 * request comes back. Different tests failed about one full run in six, and none of it was
 * the code under test. A single server per file has no port to reuse.
 *
 * Call it once at the top of a spec; it closes itself after the file's last test.
 */
export function useServer(app: RequestListener): http.Server {
  const server = http.createServer(app).listen(0, '127.0.0.1');
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return server;
}
