import { Router } from 'express';
import * as controller from './support.controller';
import {
  createTicketSchema,
  idParamSchema,
  listQuerySchema,
  replySchema,
  updateTicketSchema,
} from './support.validation';
import { validate } from '../../utils/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { authGuard } from '../../middlewares/authGuard';
import { roleGuard } from '../../middlewares/roleGuard';

/**
 * Mounted at /support — customer screen 26 "Help and disputes" and driver screen 27
 * "Help and appeals". Companies are excluded (see support.service).
 */
const router = Router();
router.use(authGuard);

router.post(
  '/tickets',
  roleGuard('customer', 'driver', 'admin'),
  validate({ body: createTicketSchema }),
  asyncHandler(controller.create),
);

router.get(
  '/tickets',
  roleGuard('customer', 'driver', 'admin'),
  validate({ query: listQuerySchema }),
  asyncHandler(controller.list),
);

router.get(
  '/tickets/:id',
  roleGuard('customer', 'driver', 'admin'),
  validate({ params: idParamSchema }),
  asyncHandler(controller.getById),
);

router.post(
  '/tickets/:id/messages',
  roleGuard('customer', 'driver', 'admin'),
  validate({ params: idParamSchema, body: replySchema }),
  asyncHandler(controller.reply),
);

// Only support staff move a ticket's state.
router.patch(
  '/tickets/:id',
  roleGuard('admin'),
  validate({ params: idParamSchema, body: updateTicketSchema }),
  asyncHandler(controller.updateStatus),
);

export default router;
