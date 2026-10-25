import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ApiError } from '../utils/ApiError';
import type { UserRole } from '../utils/roles';

/**
 * RBAC gate (spec §2). Always mounted after authGuard:
 *   router.post('/bookings', authGuard, roleGuard('customer'), controller.create)
 *
 * This enforces role membership only. Ownership checks ("is this MY booking?") stay in
 * the service layer, because they need the document.
 */
export function roleGuard(...allowedRoles: UserRole[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(ApiError.unauthorized('Authentication required'));
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      next(ApiError.forbidden(`Role '${req.user.role}' is not permitted to access this resource`));
      return;
    }

    next();
  };
}
