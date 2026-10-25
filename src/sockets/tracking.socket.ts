import type { Server as SocketIOServer, Socket } from 'socket.io';
import { Trip } from '../models/Trip';
import { Booking } from '../models/Booking';
import { Driver } from '../models/Driver';
import { socketAuthMiddleware } from './socketAuth';
import { nsPattern } from './io';
import { logger } from '../utils/logger';
import { companyOwnsDriver } from '../utils/roster';
import * as tripService from '../modules/trip/trip.service';
import { locationUpdateSchema } from '../modules/dispatch/dispatch.validation';
import { now, toISO } from '../config/timezone';

/**
 * '/tracking/:tripId' namespace (spec §5) — Live Car Tracking.
 *
 * The assigned driver emits 'location:update'; the server re-broadcasts it to the
 * customer (and admin/company observers) connected to the same trip namespace, and
 * persists the latest position on the Trip document as a REST fallback.
 */
export function attachTrackingNamespace(io: SocketIOServer): void {
  const parent = io.of(nsPattern.tracking);

  parent.use(socketAuthMiddleware);

  parent.use(async (socket, next) => {
    const tripId = socket.nsp.name.split('/').pop() as string;
    const user = socket.user!;

    try {
      const trip = await Trip.findById(tripId).lean();
      if (!trip) return next(new Error('Trip not found'));

      const booking = await Booking.findById(trip.bookingId).lean();
      if (!booking) return next(new Error('Booking not found'));

      if (user.role === 'customer' && String(booking.customerId) !== user.userId) {
        return next(new Error('This trip belongs to another customer'));
      }

      if (user.role === 'driver') {
        const driver = await Driver.findById(trip.driverId).lean();
        if (!driver || String(driver.userId) !== user.userId) {
          return next(new Error('This trip is assigned to another driver'));
        }
      }

      /*
       * A company may watch only its own roster's trips.
       *
       * The namespace had no company branch, so a company token could join the live
       * tracking room for ANY trip on the platform and follow another operator's vehicle
       * in real time — the socket-side twin of the REST leak in listTripsForUser.
       */
      if (user.role === 'company' && !(await companyOwnsDriver(user.userId, trip.driverId))) {
        return next(new Error('That trip was not run by a driver on your roster'));
      }

      socket.data.tripId = tripId;
      next();
    } catch (err) {
      logger.warn('Tracking namespace auth failed', err);
      next(new Error('Tracking authorisation failed'));
    }
  });

  parent.on('connection', (socket: Socket) => {
    const tripId = socket.data.tripId as string;
    const role = socket.user!.role;

    socket.on('location:update', async (payload: unknown) => {
      // Only the driver produces positions; everyone else is a subscriber.
      if (role !== 'driver') return;

      const parsed = locationUpdateSchema.safeParse(payload);
      if (!parsed.success) return;
      const { lat, lng } = parsed.data;

      socket.broadcast.emit('location:update', { tripId, lat, lng, at: toISO(now()) });

      try {
        await tripService.recordTripLocation(tripId, lat, lng);
      } catch (err) {
        logger.warn(`Could not persist location for trip ${tripId}`, err);
      }
    });
  });
}
