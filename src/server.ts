import fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import http from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import app from './app';
import { corsOptions, env, isProduction, uploadDir } from './config/env';
import { collapseBullmqEvictionWarning } from './config/bullmqWarnings';
import { connectMongo, disconnectMongo } from './config/db';
import { connectRedis, disconnectRedis } from './config/redis';
import { seedDefaults as seedVehicleClasses } from './modules/vehicle/vehicle.service';
import { logger } from './utils/logger';
import { setIo } from './sockets/io';
import { attachDispatchNamespace } from './sockets/dispatch.socket';
import { attachTrackingNamespace } from './sockets/tracking.socket';
import { attachChatNamespace } from './sockets/chat.socket';
import { attachNotifyNamespace } from './sockets/notify.socket';
import { registerPenaltyWorker } from './jobs/penalty.job';
import { registerCancellationWindowWorker } from './jobs/cancellationWindow.job';
import { registerPayoutWorker, schedulePayoutRuns } from './jobs/payout.job';
import { registerReportWorker } from './jobs/reportExport.job';
import { startCalendarSync, stopCalendarSync } from './modules/calendar/calendar.sync';
import { closeQueues } from './jobs/queues';

export const httpServer = http.createServer(app);

/**
 * Shared Socket.io server instance (spec §5).
 * Services reach it through sockets/io.ts rather than importing this module, which would
 * create a cycle (server -> app -> routes -> service -> server).
 */
export const io = new SocketIOServer(httpServer, { cors: corsOptions() });

export function getIo(): SocketIOServer {
  return io;
}

/**
 * Resolves once the port is bound, rejects if it cannot be.
 *
 * `httpServer.listen()` reports failure by emitting 'error' asynchronously, so without
 * this the process died through the uncaughtException handler — a stack trace for what
 * is nearly always "something else is already on this port".
 */
function listen(port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(port, () => {
      httpServer.removeListener('error', reject);
      resolve();
    });
  });
}

/** Releases anything bootstrap managed to open before it failed. */
async function abortStartup(err: unknown): Promise<never> {
  if ((err as NodeJS.ErrnoException)?.code === 'EADDRINUSE') {
    logger.error(
      `Port ${env.PORT} is already in use — another abl-backend is probably running. ` +
        `Stop it first, or set PORT to something else.`,
    );
  } else {
    logger.error('Failed to start server', err);
  }

  // Mongo, Redis and the queue workers are all opened before the port is bound, so a
  // failed start must hand them back rather than leaving the connections to be reaped.
  try {
    stopCalendarSync();
    await closeQueues();
    await disconnectMongo();
    await disconnectRedis();
  } catch (cleanupErr) {
    logger.error('Error while cleaning up a failed start', cleanupErr);
  }

  process.exit(1);
}

/**
 * Says so, at startup, if photo uploads cannot work properly — rather than the first admin to
 * upload a vehicle photo finding out. Never stops the server: bookings do not need photos.
 *   - the upload folder must exist and be writable;
 *   - in production PUBLIC_API_URL must be set, or stored photos have no address to load from;
 *   - and the folder must be on storage that SURVIVES a deploy (not something this can detect,
 *     so it is named in the log whenever the default folder is in use in production).
 */
async function checkUploadStorage(): Promise<void> {
  try {
    await fs.mkdir(uploadDir, { recursive: true });
    await fs.access(uploadDir, fsConstants.W_OK);
  } catch (err) {
    logger.error(`Upload folder ${uploadDir} is not writable — vehicle photo uploads will fail`, err);
    return;
  }
  if (!isProduction) return;
  if (!env.PUBLIC_API_URL) {
    logger.warn('PUBLIC_API_URL is not set — uploaded vehicle photos will not display. Set it to this API\'s public address.');
  }
  if (!env.UPLOAD_DIR) {
    logger.warn(
      `UPLOAD_DIR is not set, so photos are stored in ${uploadDir}. If this host resets its disk on deploy they will be lost: ` +
        'point UPLOAD_DIR at a persistent volume with room for the photos.',
    );
  }
}

async function bootstrap(): Promise<void> {
  // Queues are built lazily, so installing this before the first one is constructed
  // catches every copy of BullMQ's eviction-policy warning.
  collapseBullmqEvictionWarning();

  await connectMongo();
  await connectRedis();
  await checkUploadStorage();

  // Fills an empty vehicle catalogue from config/vehicles.ts. Insert-only, so it never
  // overwrites a multiplier operations has tuned; safe on every boot.
  await seedVehicleClasses();

  setIo(io);
  attachDispatchNamespace(io); // /dispatch
  attachTrackingNamespace(io); // /tracking/:tripId
  attachChatNamespace(io); //     /chat/:tripId
  attachNotifyNamespace(io); //   /notify/:userId

  registerPenaltyWorker(); //            2-minute driver response penalty (spec §8 rule 5)
  registerCancellationWindowWorker(); // refund-window closing alerts (spec §8 rule 6)
  registerPayoutWorker(); //             weekly driver payout run (spec §1)
  registerReportWorker(); //             async CSV/PDF report exports (spec §4.10)
  await schedulePayoutRuns(); //         upserts the repeatable Monday 09:00 PT scheduler
  startCalendarSync(); //                bookings -> the shared operations calendar (off until configured)

  await listen(env.PORT);
  logger.info(`abl-backend listening on port ${env.PORT} (${env.NODE_ENV})`);
}

async function shutdown(signal: string): Promise<void> {
  logger.warn(`${signal} received — shutting down`);
  try {
    await closeQueues();
    await io.close();
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await disconnectMongo();
    await disconnectRedis();
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error('Error during shutdown', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => logger.error('Unhandled promise rejection', reason));
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', err);
  process.exit(1);
});

bootstrap().catch((err) => void abortStartup(err));
