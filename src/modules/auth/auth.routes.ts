import { Router } from 'express';
import * as controller from './auth.controller';
import {
  forgotPasswordSchema,
  googleSchema,
  guestSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
  verifyPhoneSchema,
} from './auth.validation';
import { validate } from '../../utils/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { authGuard } from '../../middlewares/authGuard';
import { authRateLimiter } from '../../middlewares/rateLimiter';

const router = Router();

// Credential endpoints get the tighter limiter — 20 attempts per 15 minutes.
router.post('/register', authRateLimiter, validate({ body: registerSchema }), asyncHandler(controller.register));
router.post('/guest', authRateLimiter, validate({ body: guestSchema }), asyncHandler(controller.guest));
router.post('/google', authRateLimiter, validate({ body: googleSchema }), asyncHandler(controller.google));
router.post('/login', authRateLimiter, validate({ body: loginSchema }), asyncHandler(controller.login));
router.post('/refresh', authRateLimiter, validate({ body: refreshSchema }), asyncHandler(controller.refresh));
router.post('/logout', authGuard, validate({ body: logoutSchema }), asyncHandler(controller.logout));

// Phone verification (customer screen 03) — signed-in user verifying their own number.
router.post('/phone/send-code', authGuard, authRateLimiter, asyncHandler(controller.sendPhoneCode));
router.post(
  '/phone/verify',
  authGuard,
  validate({ body: verifyPhoneSchema }),
  asyncHandler(controller.verifyPhone),
);

// Password reset (screen 05). Public by necessity, so both sit behind the auth limiter.
router.post(
  '/password/forgot',
  authRateLimiter,
  validate({ body: forgotPasswordSchema }),
  asyncHandler(controller.forgotPassword),
);
router.post(
  '/password/reset',
  authRateLimiter,
  validate({ body: resetPasswordSchema }),
  asyncHandler(controller.resetPassword),
);

export default router;
