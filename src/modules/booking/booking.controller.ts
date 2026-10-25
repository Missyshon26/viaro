import type { Request, Response } from 'express';
import * as bookingService from './booking.service';
import { body, params, query } from '../../utils/validate';
import type { PaginationQuery } from '../../utils/pagination';
import * as checkoutService from './booking.checkout';
import { isStripeEnabled } from '../../integrations/paymentGateway';
import { ApiError } from '../../utils/ApiError';
import type {
  CancelBookingQuery,
  CheckoutIntentInput,
  CompleteCheckoutInput,
  CreateBookingInput,
  FavoriteDriverInput,
  DocumentParam,
  IdParam,
  UpdateBookingInput,
} from './booking.validation';

export async function create(req: Request, res: Response): Promise<void> {
  // With card payments on, a booking only exists once it is paid for — through checkout.
  if (isStripeEnabled()) {
    throw new ApiError(402, 'Bookings are paid by card — use the checkout.', {
      code: 'PAYMENT_REQUIRED',
    });
  }
  const data = await bookingService.createBooking(req.user!.userId, body<CreateBookingInput>(req));
  res.status(201).json({ success: true, data });
}

/** Step 1 of card checkout: the price, and a PaymentIntent for Stripe.js to confirm. */
export async function checkoutIntent(req: Request, res: Response): Promise<void> {
  const data = await checkoutService.startCheckout(req.user!.userId, body<CheckoutIntentInput>(req).legs);
  res.status(201).json({ success: true, data });
}

/** Step 3: the card was charged — create the booking(s). Safe to call twice. */
export async function checkout(req: Request, res: Response): Promise<void> {
  const { bookings, error } = await checkoutService.completeCheckout(
    req.user!.userId,
    body<CompleteCheckoutInput>(req).paymentIntentId,
  );
  res.status(201).json({ success: true, data: { bookings, ...(error ? { error } : {}) } });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const data = await bookingService.getBookingForUser(params<IdParam>(req).id, req.user!);
  res.json({ success: true, data });
}

export async function update(req: Request, res: Response): Promise<void> {
  const data = await bookingService.updateBooking(
    params<IdParam>(req).id,
    req.user!.userId,
    body<UpdateBookingInput>(req),
  );
  res.json({ success: true, data });
}

export async function cancel(req: Request, res: Response): Promise<void> {
  const data = await bookingService.cancelBookingByCustomer(
    params<IdParam>(req).id,
    req.user!.userId,
    query<CancelBookingQuery>(req)?.reason,
  );
  res.json({ success: true, data });
}

export async function favoriteDriver(req: Request, res: Response): Promise<void> {
  const data = await bookingService.requestFavoriteDriver(
    params<IdParam>(req).id,
    req.user!.userId,
    body<FavoriteDriverInput>(req).driverId,
  );
  res.json({ success: true, data });
}

export async function myRides(req: Request, res: Response): Promise<void> {
  const data = await bookingService.listMyRides(req.user!.userId, query<PaginationQuery>(req));
  res.json({ success: true, data });
}

export async function receipt(req: Request, res: Response): Promise<void> {
  const data = await bookingService.getReceipt(params<IdParam>(req).id, req.user!.userId);
  res.json({ success: true, data });
}

/** GET /bookings/:id/documents/:kind — the invoice or receipt as a PDF download. */
export async function document(req: Request, res: Response): Promise<void> {
  const { id, kind } = params<DocumentParam>(req);
  const pdf = await bookingService.getDocument(id, kind, req.user!);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${pdf.filename}"`);
  res.setHeader('Content-Length', String(pdf.buffer.length));
  // Personal and per-booking: nothing between here and the customer should keep a copy.
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(pdf.buffer);
}
