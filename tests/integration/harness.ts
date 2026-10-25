import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { DateTime } from 'luxon';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RequestListener } from 'node:http';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { env } from '../../src/config/env';
import { PricingRule } from '../../src/models/PricingRule';
import { VehicleClass } from '../../src/models/VehicleClass';
import { User } from '../../src/models/User';
import * as vehicles from '../../src/modules/vehicle/vehicle.service';

/**
 * Shared set-up for the integration suites: a real in-memory MongoDB, a Seattle pricing
 * rule and the default vehicle catalogue (with a $15 sedan stop fee so stops are priced).
 *
 * Nothing connects at import time: the app only talks to a database once startDatabase()
 * has pointed mongoose at the in-memory one.
 */
let server: MongoMemoryServer | null = null;

export async function startDatabase(): Promise<void> {
  server = await MongoMemoryServer.create();
  await mongoose.connect(server.getUri(), { dbName: 'abl-integration' });
}

export async function stopDatabase(): Promise<void> {
  await mongoose.disconnect();
  await server?.stop();
  server = null;
}

export async function seedCatalogue(): Promise<void> {
  await PricingRule.create({ city: 'seattle', baseFare: 129, peakMultiplier: 1.18 });
  await vehicles.seedDefaults();
  await VehicleClass.updateOne({ value: 'sedan' }, { $set: { stopFee: 15 } });
}

export async function resetData(): Promise<void> {
  const { collections } = mongoose.connection;
  for (const name of Object.keys(collections)) {
    if (['pricingrules', 'vehicleclasses'].includes(name)) continue;
    await collections[name].deleteMany({});
  }
}

export async function accessTokenFor(userId: string, role: string): Promise<string> {
  return `Bearer ${jwt.sign({ userId, role }, env.JWT_ACCESS_SECRET, { expiresIn: '10m' })}`;
}

/** A Pacific wall-clock pickup string `daysAhead` days from now at the given hour. */
export function pickupIn(daysAhead: number, hour = 14): string {
  return DateTime.now()
    .setZone('America/Los_Angeles')
    .plus({ days: daysAhead })
    .set({ hour, minute: 0, second: 0, millisecond: 0 })
    .toFormat("yyyy-MM-dd'T'HH:mm:ss");
}

export const point = (address: string) => ({ lat: 47.6, lng: -122.3, address });

/** A 1x1 PNG, drawn from its real bytes so the server's PNG check has something genuine to read. */
export const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

/** Creates an account directly in the database and returns its id and a bearer token. */
export async function makeUser(
  role: 'customer' | 'admin',
  over: Record<string, unknown> = {},
): Promise<{ id: string; auth: string }> {
  const seq = Math.random().toString(36).slice(2, 8);
  const user = await User.create({
    role,
    name: role === 'admin' ? 'Ops' : 'Pat Rider',
    email: `${role}-${seq}@example.com`,
    phone: '+12065550100',
    passwordHash: 'x',
    ...over,
  });
  return { id: String(user._id), auth: await accessTokenFor(String(user._id), role) };
}

/**
 * One HTTP server for the whole test file, instead of supertest's default of a new one on a
 * random port for every request.
 *
 * Node reuses keep-alive connections, so a request occasionally lands on a socket left over
 * from an earlier server that happened to have the same port, and is answered "400 Bad
 * Request" by Node itself — before any of our code runs, which is why it left no trace in the
 * app's own logs. About one run in twenty failed that way. A single server removes the
 * port reuse, and with it the flake.
 */
export function listen(app: RequestListener): { server: http.Server; close: () => Promise<void> } {
  const server = http.createServer(app).listen(0, '127.0.0.1');
  return {
    server,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

export const portOf = (server: http.Server): number => (server.address() as AddressInfo).port;
