import { Router } from 'express';
import * as controller from './users.controller';
import {
  objectIdParamSchema,
  signAgreementSchema,
  updateProfileSchema,
  uploadDocumentSchema,
} from './users.validation';
import { validate } from '../../utils/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { authGuard } from '../../middlewares/authGuard';
import { roleGuard } from '../../middlewares/roleGuard';

const router = Router();

router.use(authGuard);

router.get('/me', asyncHandler(controller.getMe));
router.patch('/me', validate({ body: updateProfileSchema }), asyncHandler(controller.updateMe));

// Screen 27 "Delete account" — soft delete, PII scrubbed, financial history retained.
router.delete('/me', asyncHandler(controller.deleteMe));

router.post(
  '/me/documents',
  roleGuard('driver'),
  validate({ body: uploadDocumentSchema }),
  asyncHandler(controller.uploadDocument),
);

// The rental agreement every passenger signs before booking.
router.get('/me/agreement', roleGuard('customer'), asyncHandler(controller.getMyAgreement));
router.put(
  '/me/agreement',
  roleGuard('customer'),
  validate({ body: signAgreementSchema }),
  asyncHandler(controller.signMyAgreement),
);

router.get('/me/favorites', roleGuard('customer'), asyncHandler(controller.listFavorites));
router.post(
  '/me/favorites/:driverId',
  roleGuard('customer'),
  validate({ params: objectIdParamSchema }),
  asyncHandler(controller.addFavorite),
);
router.delete(
  '/me/favorites/:driverId',
  roleGuard('customer'),
  validate({ params: objectIdParamSchema }),
  asyncHandler(controller.removeFavorite),
);

export default router;
