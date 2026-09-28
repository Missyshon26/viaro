import type { Router } from 'express';

import authRoutes from '../src/modules/auth/auth.routes';
import usersRoutes from '../src/modules/users/users.routes';
import {
  adminPricingRouter,
  pricingRouter,
  subscriptionRouter,
} from '../src/modules/pricing/pricing.routes';
import { bookingRouter, customerRidesRouter } from '../src/modules/booking/booking.routes';
import { adminDispatchRouter, dispatchRouter } from '../src/modules/dispatch/dispatch.routes';
import driverRoutes from '../src/modules/driver/driver.routes';
import { adminVehicleRouter, vehicleRouter } from '../src/modules/vehicle/vehicle.routes';
import supportRoutes from '../src/modules/support/support.routes';
import tripRoutes from '../src/modules/trip/trip.routes';
import cancellationRoutes from '../src/modules/cancellation/cancellation.routes';
import chatRoutes from '../src/modules/chat/chat.routes';
import { paymentsRouter, walletRouter } from '../src/modules/wallet/wallet.routes';
import notificationRoutes from '../src/modules/notifications/notifications.routes';
import eventRoutes from '../src/modules/events/events.routes';
import flightRoutes from '../src/modules/flight/flight.routes';
import reportRoutes from '../src/modules/reports/reports.routes';
import adminRoutes, { publicSettingsRouter } from '../src/modules/admin/admin.routes';

/**
 * Mirrors the `app.use(...)` calls in src/app.ts.
 *
 * Express 5 does not expose a mounted router's prefix (`layer.path` is only populated
 * while matching), so the prefixes are declared here rather than reflected. The suite
 * guards against this drifting by asserting the number of mounted routers on the real
 * app equals this table's length — adding a mount to app.ts without adding it here
 * fails the run.
 */
export const MOUNTS: [prefix: string, router: Router][] = [
  ['/auth', authRoutes],
  ['/users', usersRoutes],
  ['/users/me/rides', customerRidesRouter],
  ['/subscriptions', subscriptionRouter],
  ['/pricing', pricingRouter],
  ['/bookings', bookingRouter],
  ['/drivers', driverRoutes],
  ['/dispatch', dispatchRouter],
  ['/support', supportRoutes],
  ['/trips', tripRoutes],
  ['/trips', cancellationRoutes],
  ['/trips', chatRoutes],
  ['/events', eventRoutes],
  ['/wallet', walletRouter],
  ['/payments', paymentsRouter],
  ['/notifications', notificationRoutes],
  ['/flight', flightRoutes],
  ['/reports', reportRoutes],
  ['/vehicle-classes', vehicleRouter],
  ['/admin/vehicle-classes', adminVehicleRouter],
  ['/admin/pricing', adminPricingRouter],
  ['/admin/dispatch', adminDispatchRouter],
  ['/admin', adminRoutes],
  ['/settings', publicSettingsRouter],
];

export interface DiscoveredRoute {
  method: string;
  path: string;
}

interface RouteLayer {
  route?: { path: string | string[]; methods: Record<string, boolean> };
}

/** Every (method, full path) pair the app actually serves. */
export function discoverRoutes(): DiscoveredRoute[] {
  const found: DiscoveredRoute[] = [];

  for (const [prefix, router] of MOUNTS) {
    const stack = (router as unknown as { stack: RouteLayer[] }).stack ?? [];

    for (const layer of stack) {
      if (!layer.route) continue;

      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];

      for (const routePath of paths) {
        for (const method of Object.keys(layer.route.methods)) {
          // '/' on a prefix means the prefix itself: '/bookings', not '/bookings/'.
          const full = routePath === '/' ? prefix : `${prefix}${routePath}`;
          found.push({ method: method.toUpperCase(), path: full });
        }
      }
    }
  }

  return found;
}

export const routeKey = (method: string, path: string) => `${method.toUpperCase()} ${path}`;
