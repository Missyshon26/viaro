import type { Request, Response } from 'express';
import * as walletService from './wallet.service';
import { body, params, query } from '../../utils/validate';
import type { PaginationQuery } from '../../utils/pagination';
import type { MethodIdParam, SavePaymentMethodInput } from './wallet.validation';
import { verifyWebhookSignature } from '../../integrations/paymentGateway';
import { ApiError } from '../../utils/ApiError';
import { handleStripeEvent } from '../payments/stripeEvents';
import type {
  CollectPaymentInput,
  ReleaseCreditInput,
  UseCreditInput,
  WithdrawInput,
} from './wallet.validation';

export async function getMyWallet(req: Request, res: Response): Promise<void> {
  const data = await walletService.getWalletForUser(req.user!.userId, query<PaginationQuery>(req));
  res.json({ success: true, data });
}

export async function withdraw(req: Request, res: Response): Promise<void> {
  const input = body<WithdrawInput>(req);
  const data = await walletService.withdraw(req.user!.userId, input.amount, input.destination);
  res.json({ success: true, data });
}

export async function useCredit(req: Request, res: Response): Promise<void> {
  const input = body<UseCreditInput>(req);
  const data = await walletService.useCredit(req.user!.userId, input.tripId, input.amount);
  res.json({ success: true, data });
}

export async function releaseCredit(req: Request, res: Response): Promise<void> {
  const input = body<ReleaseCreditInput>(req);
  const data = await walletService.releaseCredit(
    req.user!.userId,
    req.user!.role,
    input.tripId,
    input.amount,
  );
  res.json({ success: true, data });
}

export async function collect(req: Request, res: Response): Promise<void> {
  // The caller is passed so a company can only charge for its own roster's trips.
  const data = await walletService.collectPayment(body<CollectPaymentInput>(req).tripId, req.user!);
  res.json({ success: true, data });
}

export async function savePaymentMethod(req: Request, res: Response): Promise<void> {
  const data = await walletService.savePaymentMethod(
    req.user!.userId,
    body<SavePaymentMethodInput>(req),
  );
  res.status(201).json({ success: true, data });
}

export async function listPaymentMethods(req: Request, res: Response): Promise<void> {
  const data = await walletService.listPaymentMethods(req.user!.userId);
  res.json({ success: true, data });
}

export async function deletePaymentMethod(req: Request, res: Response): Promise<void> {
  const data = await walletService.deletePaymentMethod(
    req.user!.userId,
    params<MethodIdParam>(req).id,
  );
  res.json({ success: true, data });
}

/**
 * Public webhook receiver. The signature check is a PLACEHOLDER implementation but is
 * genuinely enforced — an unsigned or mis-signed request is rejected with 401.
 */
export async function webhook(req: Request, res: Response): Promise<void> {
  const signature = req.header('stripe-signature') ?? req.header('x-webhook-signature');
  // The exact received bytes, captured in app.ts — never a re-serialised req.body.
  const rawBody = req.rawBody ?? '';

  if (!verifyWebhookSignature(rawBody, signature)) {
    throw ApiError.unauthorized('Invalid webhook signature');
  }

  const event = (req.body ?? {}) as { type?: string; data?: { object?: Record<string, unknown> } };
  await walletService.handleGatewayEvent(event);
  await handleStripeEvent(event);

  // Gateways retry anything that is not a fast 2xx, so acknowledge immediately.
  res.json({ success: true, received: true, type: event.type ?? null });
}
