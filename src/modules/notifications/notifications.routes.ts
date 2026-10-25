import { Router } from 'express';
import * as controller from './notifications.controller';
import { idParamSchema, listQuerySchema } from './notifications.validation';
import { validate } from '../../utils/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { authGuard } from '../../middlewares/authGuard';

/** Mounted at /notifications — any authenticated role, own records only. */
const router = Router();
router.use(authGuard);

router.get('/', validate({ query: listQuerySchema }), asyncHandler(controller.list));
router.patch('/:id/read', validate({ params: idParamSchema }), asyncHandler(controller.markRead));

export default router;
