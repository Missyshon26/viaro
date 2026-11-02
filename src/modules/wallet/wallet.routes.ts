import { Router } from 'express';
import * as controller from './wallet.controller';
import {
  collectPaymentSchema,
  legacyPayLinkSchema,
  methodIdParamSchema,
  savePaymentMethodSchema,
  releaseCreditSchema,
  useCreditSchema,
  walletQuerySchema,
  withdrawSchema,
} from './wallet.validation';
import { validate } from '../../utils/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { authGuard } from '../../middlewares/authGuard';
import { roleGuard } from '../../middlewares/roleGuard';
import { createRateLimiter } from '../../middlewares/rateLimiter';

/** Mounted at /wallet */
export const walletRouter = Router();
walletRouter.use(authGuard);

walletRouter.get(
  '/me',
  roleGuard('customer', 'driver'),
  validate({ query: walletQuerySchema }),
  asyncHandler(controller.getMyWallet),
);

// Withdrawal (10% fee) and use-credit (no fee) are separate routes onto separate service
// functions — spec §8 rule 3 requires they never share a code path.
walletRouter.post(
  '/withdraw',
  roleGuard('driver'),
  validate({ body: withdrawSchema }),
  asyncHandler(controller.withdraw),
);

walletRouter.post(
  '/use-credit',
  roleGuard('customer'),
  validate({ body: useCreditSchema }),
  asyncHandler(controller.useCredit),
);

/**
 * Undo for the route above. Open to the customer who applied the credit and to
 * operations, who field the call when a passenger cannot sort it out themselves;
 * ownership is enforced in the service, which is the layer that has the document.
 */
walletRouter.post(
  '/release-credit',
  roleGuard('customer', 'admin'),
  validate({ body: releaseCreditSchema }),
  asyncHandler(controller.releaseCredit),
);

/** Mounted at /payments */
export const paymentsRouter = Router();

// System endpoint, not customer-facing — locked to admin/company as a safe default.
paymentsRouter.post(
  '/collect',
  authGuard,
  roleGuard('admin', 'company'),
  validate({ body: collectPaymentSchema }),
  asyncHandler(controller.collect),
);

// Saved cards (customer screen 12). Tokens only — never raw card numbers.
paymentsRouter.get(
  '/methods',
  authGuard,
  roleGuard('customer'),
  asyncHandler(controller.listPaymentMethods),
);
paymentsRouter.post(
  '/methods',
  authGuard,
  roleGuard('customer'),
  validate({ body: savePaymentMethodSchema }),
  asyncHandler(controller.savePaymentMethod),
);
paymentsRouter.delete(
  '/methods/:id',
  authGuard,
  roleGuard('customer'),
  validate({ params: methodIdParamSchema }),
  asyncHandler(controller.deletePaymentMethod),
);

// Public, but signature-verified inside the controller.
paymentsRouter.post('/webhook', asyncHandler(controller.webhook));

// Old emailed pay links. Public: the link's secret, checked with Stripe, is the proof. Every call
// asks Stripe a question, so a caller is held to a modest number per minute.
const legacyLinkLimiter = createRateLimiter({ windowMs: 60_000, max: 20, keyPrefix: 'ratelimit:legacy-pay-link' });
paymentsRouter.post(
  '/legacy-link/lookup',
  legacyLinkLimiter,
  validate({ body: legacyPayLinkSchema }),
  asyncHandler(controller.lookupLegacyPayLink),
);
paymentsRouter.post(
  '/legacy-link/start',
  legacyLinkLimiter,
  validate({ body: legacyPayLinkSchema }),
  asyncHandler(controller.startLegacyPayLink),
);
