import type { Request, Response } from 'express';
import * as authService from './auth.service';
import * as accountService from './auth.account.service';
import * as guestService from './auth.guest.service';
import * as googleService from './auth.google.service';
import { body } from '../../utils/validate';
import type {
  ForgotPasswordInput,
  GoogleInput,
  GuestInput,
  LoginInput,
  LogoutInput,
  RefreshInput,
  RegisterInput,
  ResetPasswordInput,
  VerifyPhoneInput,
} from './auth.validation';

export async function register(req: Request, res: Response): Promise<void> {
  const result = await authService.register(body<RegisterInput>(req));
  res.status(201).json({ success: true, data: result });
}

export async function login(req: Request, res: Response): Promise<void> {
  const result = await authService.login(body<LoginInput>(req));
  res.json({ success: true, data: result });
}

export async function guest(req: Request, res: Response): Promise<void> {
  const result = await guestService.guestCheckout(body<GuestInput>(req));
  res.status(201).json({ success: true, data: result });
}

export async function google(req: Request, res: Response): Promise<void> {
  const result = await googleService.googleSignIn(body<GoogleInput>(req));
  res.json({ success: true, data: result });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const result = await authService.refresh(body<RefreshInput>(req).refreshToken);
  res.json({ success: true, data: result });
}

export async function logout(req: Request, res: Response): Promise<void> {
  await authService.logout(body<LogoutInput>(req).refreshToken);
  res.json({ success: true, message: 'Logged out' });
}

/* --------------------- phone verification / password reset ---------------- */

export async function sendPhoneCode(req: Request, res: Response): Promise<void> {
  const data = await accountService.sendPhoneCode(req.user!.userId);
  res.json({ success: true, data });
}

export async function verifyPhone(req: Request, res: Response): Promise<void> {
  const data = await accountService.verifyPhoneCode(
    req.user!.userId,
    body<VerifyPhoneInput>(req).code,
  );
  res.json({ success: true, data });
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const data = await accountService.requestPasswordReset(body<ForgotPasswordInput>(req).email);
  res.json({ success: true, data });
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const input = body<ResetPasswordInput>(req);
  const data = await accountService.resetPassword(input.token, input.password);
  res.json({ success: true, data });
}
