import express, { Router } from 'express';
import * as controller from './driver.controller';
import {
  applySchema,
  documentIdParamSchema,
  documentProfileSchema,
  setStatusSchema,
  uploadDocumentQuerySchema,
} from './driver.validation';
import { ALLOWED_MIME, MAX_FILE_BYTES } from './driver.documents';
import { validate } from '../../utils/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { authGuard } from '../../middlewares/authGuard';
import { roleGuard } from '../../middlewares/roleGuard';

/**
 * Mounted at /drivers — the driver's own account.
 * Company/admin management of OTHER drivers lives under /admin/drivers.
 */
const router = Router();

router.get('/me', authGuard, roleGuard('driver'), asyncHandler(controller.me));

router.patch(
  '/me/status',
  authGuard,
  roleGuard('driver'),
  validate({ body: setStatusSchema }),
  asyncHandler(controller.setStatus),
);

router.post(
  '/apply',
  authGuard,
  roleGuard('driver'),
  validate({ body: applySchema }),
  asyncHandler(controller.apply),
);

/* ------------------------------- documents -------------------------------- */

router.get('/me/documents', authGuard, roleGuard('driver'), asyncHandler(controller.myDocuments));

router.patch(
  '/me/documents/profile',
  authGuard,
  roleGuard('driver'),
  validate({ body: documentProfileSchema }),
  asyncHandler(controller.setDocumentProfile),
);

/*
 * The body is the file itself (Content-Type = its MIME type). The global JSON parser
 * ignores these types, so this route gets its own raw parser with a 10 MB ceiling.
 * ⚠ nginx in front of the API must allow it too: `client_max_body_size 12m;`.
 */
router.post(
  '/me/documents',
  authGuard,
  roleGuard('driver'),
  express.raw({ type: [...ALLOWED_MIME], limit: MAX_FILE_BYTES }),
  validate({ query: uploadDocumentQuerySchema }),
  asyncHandler(controller.uploadDocument),
);

router.delete(
  '/me/documents/:documentId',
  authGuard,
  roleGuard('driver'),
  validate({ params: documentIdParamSchema }),
  asyncHandler(controller.removeDocument),
);

/** The file itself — the chauffeur, the admin, or the company that rosters them. */
router.get(
  '/documents/:documentId/file',
  authGuard,
  roleGuard('driver', 'admin', 'company'),
  validate({ params: documentIdParamSchema }),
  asyncHandler(controller.documentFile),
);

export default router;
