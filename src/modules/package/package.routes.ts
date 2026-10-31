import { Router } from 'express';
import * as controller from './package.controller';
import {
  createPackageSchema,
  idParamSchema,
  listPackagesQuerySchema,
  updatePackageSchema,
} from './package.validation';
import { validate } from '../../utils/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { authGuard } from '../../middlewares/authGuard';
import { roleGuard } from '../../middlewares/roleGuard';

/** Mounted at /packages — the visible packages, open to everyone like the vehicle catalogue. */
export const packageRouter = Router();
packageRouter.get('/', asyncHandler(controller.listPublic));
packageRouter.get('/:id', validate({ params: idParamSchema }), asyncHandler(controller.getPublic));

/** Mounted at /admin/packages — managing them belongs to operations. */
export const adminPackageRouter = Router();
adminPackageRouter.use(authGuard, roleGuard('admin'));

adminPackageRouter.get('/', validate({ query: listPackagesQuerySchema }), asyncHandler(controller.listAdmin));
adminPackageRouter.post('/', validate({ body: createPackageSchema }), asyncHandler(controller.create));
adminPackageRouter.get('/:id', validate({ params: idParamSchema }), asyncHandler(controller.getAdmin));
adminPackageRouter.patch(
  '/:id',
  validate({ params: idParamSchema, body: updatePackageSchema }),
  asyncHandler(controller.update),
);
adminPackageRouter.delete('/:id', validate({ params: idParamSchema }), asyncHandler(controller.remove));

// The upload is parsed first, then the id checked (each validate() replaces req.validated).
adminPackageRouter.post(
  '/:id/image',
  controller.receiveImage,
  validate({ params: idParamSchema }),
  asyncHandler(controller.setImage),
);
adminPackageRouter.delete('/:id/image', validate({ params: idParamSchema }), asyncHandler(controller.removeImage));
