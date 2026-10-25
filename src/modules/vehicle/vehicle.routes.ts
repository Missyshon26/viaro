import { Router } from 'express';
import * as controller from './vehicle.controller';
import {
  createVehicleClassSchema,
  idParamSchema,
  imageParamSchema,
  imageTextSchema,
  listVehicleQuerySchema,
  updateImageSchema,
  updateVehicleClassSchema,
} from './vehicle.validation';
import { validate } from '../../utils/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { authGuard, optionalAuth } from '../../middlewares/authGuard';
import { roleGuard } from '../../middlewares/roleGuard';

/**
 * Mounted at /vehicle-classes — the catalogue the booking form renders.
 *
 * Open to everyone, because the booking form is shown before anyone has signed in. A visitor
 * with no account gets the catalogue and the rates a customer is charged (flat, hourly, stop fee)
 * but not the formula inputs (multipliers, minimum fare). Any signed-in role gets the full record:
 * the chauffeur portal and both consoles turn a stored `vehicleClass` key into a label and the
 * admin edits the rates.
 */
export const vehicleRouter = Router();

vehicleRouter.get(
  '/',
  optionalAuth,
  validate({ query: listVehicleQuerySchema }),
  asyncHandler(controller.list),
);

/** Mounted at /admin/vehicle-classes — managing the catalogue belongs to operations. */
export const adminVehicleRouter = Router();

adminVehicleRouter.use(authGuard, roleGuard('admin'));

adminVehicleRouter.post(
  '/',
  validate({ body: createVehicleClassSchema }),
  asyncHandler(controller.create),
);

adminVehicleRouter.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateVehicleClassSchema }),
  asyncHandler(controller.update),
);

adminVehicleRouter.delete(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(controller.remove),
);

/*
 * Photos. The upload is parsed BEFORE validation so its text fields (alt, caption) exist to be
 * validated; the file itself is checked by what it is, not what it is called.
 */
adminVehicleRouter.post(
  '/:id/images',
  controller.receiveImage,
  // Params are validated here, not before the upload: each validate() call replaces
  // req.validated wholesale, so one that ran earlier would be wiped by this one.
  validate({ params: idParamSchema, body: imageTextSchema }),
  asyncHandler(controller.addImage),
);

adminVehicleRouter.patch(
  '/:id/images/:key',
  validate({ params: imageParamSchema, body: updateImageSchema }),
  asyncHandler(controller.updateImage),
);

adminVehicleRouter.delete(
  '/:id/images/:key',
  validate({ params: imageParamSchema }),
  asyncHandler(controller.removeImage),
);
