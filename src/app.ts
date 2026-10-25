import path from 'node:path';
import express, { type Application, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { corsOptions, env, isProduction, isTest, uploadDir } from './config/env';
import { APP_TIMEZONE, format, now } from './config/timezone';
import { apiRateLimiter } from './middlewares/rateLimiter';
import { errorHandler, notFoundHandler } from './middlewares/errorHandler';

import authRoutes from './modules/auth/auth.routes';
import usersRoutes from './modules/users/users.routes';
import { adminVehicleRouter, vehicleRouter } from './modules/vehicle/vehicle.routes';
import { adminPricingRouter, pricingRouter, subscriptionRouter } from './modules/pricing/pricing.routes';
import { bookingRouter, customerRidesRouter } from './modules/booking/booking.routes';
import { adminDispatchRouter, dispatchRouter } from './modules/dispatch/dispatch.routes';
import driverRoutes from './modules/driver/driver.routes';
import supportRoutes from './modules/support/support.routes';
import tripRoutes from './modules/trip/trip.routes';
import cancellationRoutes from './modules/cancellation/cancellation.routes';
import chatRoutes from './modules/chat/chat.routes';
import { paymentsRouter, walletRouter } from './modules/wallet/wallet.routes';
import notificationRoutes from './modules/notifications/notifications.routes';
import eventRoutes from './modules/events/events.routes';
import flightRoutes from './modules/flight/flight.routes';
import reportRoutes from './modules/reports/reports.routes';
import adminRoutes, { publicSettingsRouter } from './modules/admin/admin.routes';

const app: Application = express();

app.set('trust proxy', 1); // behind nginx on the aaPanel VPS — needed for correct req.ip

app.use(helmet());
app.use(cors(corsOptions()));

/*
 * Uploaded images (vehicle photos), served straight from disk.
 *
 * Mounted BEFORE the rate limiter: one booking page loads a photo per vehicle, and counting
 * those against the same per-IP allowance as API calls would lock a visitor out of the
 * site. Everything here was written by us under a random name, so the options are about
 * safety, not routing:
 *   - nosniff + a deny-everything CSP, so a file can only ever be treated as the image it is;
 *   - Cross-Origin-Resource-Policy: cross-origin, because helmet's default of same-origin
 *     would stop the passenger site and the admin (other origins) from showing them;
 *   - no directory listing, no dotfiles, and a long cache — the name changes if the file does.
 */
app.use(
  '/uploads',
  express.static(uploadDir, {
    index: false,
    dotfiles: 'ignore',
    redirect: false,
    maxAge: '30d',
    immutable: true,
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'");
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  }),
);

/**
 * The social icons in the email footer. Mail clients fetch them from here, so they must be
 * reachable without a login and from any origin; they never change, hence the long cache.
 */
app.use(
  '/email_icons',
  express.static(path.resolve(process.cwd(), 'public', 'email_icons'), {
    index: false,
    dotfiles: 'ignore',
    redirect: false,
    maxAge: '30d',
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  }),
);

/**
 * The raw request bytes are stashed before parsing because payment webhook signatures are
 * computed over the exact payload — re-serialising `req.body` changes whitespace and key
 * order, and the signature would never match.
 */
app.use(
  express.json({
    limit: '1mb',
    verify: (req, _res, buf) => {
      (req as Request).rawBody = buf.toString('utf8');
    },
  }),
);
app.use(express.urlencoded({ extended: true }));
// Skipped under test: the authorization suite makes ~380 requests and the access log
// buries the actual result.
app.use(morgan(isProduction ? 'combined' : 'dev', { skip: () => isTest }));
app.use(apiRateLimiter);

app.get('/health', (_req: Request, res: Response) => {
  res.json({
    success: true,
    service: 'abl-backend',
    env: env.NODE_ENV,
    timezone: APP_TIMEZONE,
    time: format(now()),
  });
});

/* ------------------------------- feature routers -------------------------- */

app.use('/auth', authRoutes);
app.use('/users', usersRoutes);
app.use('/users/me/rides', customerRidesRouter);

app.use('/subscriptions', subscriptionRouter);
app.use('/pricing', pricingRouter);

app.use('/bookings', bookingRouter);

// A driver's own account and the open-request pool they claim from.
app.use('/drivers', driverRoutes);
app.use('/dispatch', dispatchRouter);
app.use('/support', supportRoutes);

// Three routers share the /trips prefix: lifecycle, customer cancellation variants, and
// chat history. Express falls through to the next router when a path does not match.
app.use('/trips', tripRoutes);
app.use('/trips', cancellationRoutes);
app.use('/trips', chatRoutes);

// Change announcements for open screens. Held-open connections, so it is mounted
// after the ordinary routers and carries no rate limiter of its own.
app.use('/events', eventRoutes);

app.use('/wallet', walletRouter);
app.use('/payments', paymentsRouter);

app.use('/notifications', notificationRoutes);
app.use('/flight', flightRoutes);
app.use('/reports', reportRoutes);

app.use('/vehicle-classes', vehicleRouter);
app.use('/admin/vehicle-classes', adminVehicleRouter);
app.use('/admin/pricing', adminPricingRouter);
app.use('/admin/dispatch', adminDispatchRouter);
app.use('/admin', adminRoutes);
app.use('/settings', publicSettingsRouter);

app.use(notFoundHandler);
app.use(errorHandler); // must stay last

export default app;
