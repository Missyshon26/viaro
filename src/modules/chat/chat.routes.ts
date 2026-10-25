import { Router } from 'express';
import * as controller from './chat.controller';
import { chatMessageSchema, idParamSchema } from './chat.validation';
import { validate } from '../../utils/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { authGuard } from '../../middlewares/authGuard';
import { roleGuard } from '../../middlewares/roleGuard';

/**
 * Mounted at /trips, alongside trip.routes and cancellation.routes — guards stay on the
 * route, never on the router, so a request passing through to a sibling is not blocked.
 *
 * Companies are excluded here and again in chat.service.assertChatAccess (spec §2).
 */
const router = Router();

router.get(
  '/:id/chat/history',
  authGuard,
  roleGuard('customer', 'driver', 'admin'),
  validate({ params: idParamSchema }),
  asyncHandler(controller.history),
);

// Customer and the assigned chauffeur may post; admins are read-only (service-enforced).
router.post(
  '/:id/chat/messages',
  authGuard,
  roleGuard('customer', 'driver'),
  validate({ params: idParamSchema, body: chatMessageSchema }),
  asyncHandler(controller.send),
);

export default router;
