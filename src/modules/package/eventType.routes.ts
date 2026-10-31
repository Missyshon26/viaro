import { Router } from 'express';
import { validate } from '../../utils/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { authGuard } from '../../middlewares/authGuard';
import { roleGuard } from '../../middlewares/roleGuard';
import { body, params } from '../../utils/validate';
import * as service from './eventType.service';

/** Mounted at /admin/event-types — the list of event kinds packages choose from. */
export const adminEventTypeRouter = Router();
adminEventTypeRouter.use(authGuard, roleGuard('admin'));

adminEventTypeRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ success: true, data: await service.list() });
  }),
);

adminEventTypeRouter.post(
  '/',
  validate({ body: service.eventTypeBodySchema }),
  asyncHandler(async (req, res) => {
    res.status(201).json({ success: true, data: await service.create(body<{ name: string }>(req).name) });
  }),
);

adminEventTypeRouter.patch(
  '/:id',
  validate({ params: service.eventTypeIdSchema, body: service.eventTypeBodySchema }),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await service.rename(params<{ id: string }>(req).id, body<{ name: string }>(req).name) });
  }),
);

adminEventTypeRouter.delete(
  '/:id',
  validate({ params: service.eventTypeIdSchema }),
  asyncHandler(async (req, res) => {
    res.json({ success: true, data: await service.remove(params<{ id: string }>(req).id) });
  }),
);
