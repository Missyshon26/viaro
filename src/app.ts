import express, { type Application, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { corsOptions, env, isProduction, isTest } from './config/env';
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
    service: 'viaro-backend',
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
