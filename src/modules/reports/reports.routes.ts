import { Router } from 'express';
import * as controller from './reports.controller';
import {
  exportQuerySchema,
  jobParamSchema,
  monthlyQuerySchema,
  reportRangeSchema,
} from './reports.validation';
import { validate } from '../../utils/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { authGuard } from '../../middlewares/authGuard';
import { roleGuard } from '../../middlewares/roleGuard';

/** Mounted at /reports */
const router = Router();

// Spec §8 rule 7: customers have no report access at all; scoping within the remaining
// three roles is enforced in reports.service.buildScope().
router.use(authGuard, roleGuard('driver', 'admin', 'company'));

const withRange = validate({ query: reportRangeSchema });

router.get('/trips-completed', withRange, asyncHandler(controller.tripsCompleted));
router.get('/earnings-payout', withRange, asyncHandler(controller.earningsPayout));
router.get('/cancellations-penalties', withRange, asyncHandler(controller.cancellationsPenalties));
// A chauffeur's own rides and pay by calendar month. Drivers only (checked in the service).
router.get(
  '/monthly',
  roleGuard('driver'),
  validate({ query: monthlyQuerySchema }),
  asyncHandler(controller.monthly),
);

router.get(
  '/exports/:jobId/download',
  validate({ params: jobParamSchema }),
  asyncHandler(controller.downloadExport),
);
router.get(
  '/exports/:jobId',
  validate({ params: jobParamSchema }),
  asyncHandler(controller.exportStatus),
);

router.get('/', validate({ query: exportQuerySchema }), asyncHandler(controller.exportReport));

export default router;
