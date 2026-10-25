import { Router } from 'express';
import * as controller from './events.controller';
import { authGuard } from '../../middlewares/authGuard';

/**
 * Mounted at /events.
 *
 * Every signed-in role may open a stream — what they actually receive is filtered per
 * event by `isAddressedTo`, not by a role guard here, because a passenger and an
 * operator both legitimately subscribe, they just hear about different things.
 *
 * No asyncHandler: the handler is synchronous and, by design, never resolves — it holds
 * the response open until the client disconnects.
 */
const router = Router();

router.get('/stream', authGuard, controller.stream);

export default router;
