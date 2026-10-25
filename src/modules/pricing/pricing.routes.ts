import { Router } from 'express';
import * as controller from './pricing.controller';
import {
  createPricingRuleSchema,
  createSubscriptionSchema,
  fareEstimateQuerySchema,
  idParamSchema,
  updatePricingRuleSchema,
} from './pricing.validation';
import { validate } from '../../utils/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { authGuard, optionalAuth } from '../../middlewares/authGuard';
import { roleGuard } from '../../middlewares/roleGuard';
import { createRateLimiter } from '../../middlewares/rateLimiter';

/** Mounted at /subscriptions */
export const subscriptionRouter = Router();
subscriptionRouter.use(authGuard, roleGuard('customer'));
subscriptionRouter.post(
  '/',
  validate({ body: createSubscriptionSchema }),
  asyncHandler(controller.createSubscription),
);
// Prices now live server-side, so clients need a way to read the catalogue.
subscriptionRouter.get('/plans', asyncHandler(controller.listSubscriptionPlans));
subscriptionRouter.get('/me', asyncHandler(controller.getMySubscription));
subscriptionRouter.delete('/me', asyncHandler(controller.cancelSubscription));

/** Mounted at /pricing */
export const pricingRouter = Router();

/** Quotes are open to visitors with no account, so they are limited per address. */
const quoteRateLimiter = createRateLimiter({ windowMs: 60_000, max: 90, keyPrefix: 'fare-estimate', message: 'Too many quotes — please wait a moment.' });

/**
 * Open to everyone: the booking form quotes a journey before anyone has signed in. Only a
 * signed-in CUSTOMER is quoted their own discounts (welcome, loyalty, subscription); anyone
 * else gets the plain price, which is what they would be charged before any discount.
 */
pricingRouter.get(
  '/fare-estimate',
  optionalAuth,
  quoteRateLimiter,
  validate({ query: fareEstimateQuerySchema }),
  asyncHandler(controller.fareEstimate),
);

/** Mounted at /admin/pricing */
export const adminPricingRouter = Router();
adminPricingRouter.use(authGuard, roleGuard('admin'));
adminPricingRouter.post(
  '/city',
  validate({ body: createPricingRuleSchema }),
  asyncHandler(controller.createPricingRule),
);
adminPricingRouter.get('/city', asyncHandler(controller.listPricingRules));
adminPricingRouter.patch(
  '/city/:id',
  validate({ params: idParamSchema, body: updatePricingRuleSchema }),
  asyncHandler(controller.updatePricingRule),
);
adminPricingRouter.delete(
  '/city/:id',
  validate({ params: idParamSchema }),
  asyncHandler(controller.deletePricingRule),
);
