import { Router } from 'express';
import * as controller from './cancellation.controller';
import { cancelBodySchema, idParamSchema } from './cancellation.validation';
import { validate } from '../../utils/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { authGuard } from '../../middlewares/authGuard';
import { roleGuard } from '../../middlewares/roleGuard';

/**
 * Mounted at /trips, alongside trip.routes and chat.routes.
 *
 * Guards are attached PER ROUTE, never via router.use(): several routers share the
 * /trips prefix, and router-level middleware runs for every request that reaches the
 * router — including ones it has no route for. A router-level roleGuard('customer') here
 * would 403 an admin on their way to /trips/:id/chat/history.
 */
const router = Router();

const guards = [authGuard, roleGuard('customer'), validate({ params: idParamSchema, body: cancelBodySchema })];

router.post('/:id/cancel/point-to-point', guards, asyncHandler(controller.cancelPointToPoint));
router.post('/:id/cancel/airport', guards, asyncHandler(controller.cancelAirport));
router.post('/:id/cancel/hourly', guards, asyncHandler(controller.cancelHourly));

export default router;
