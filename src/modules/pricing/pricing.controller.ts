import type { Request, Response } from 'express';
import * as pricingService from './pricing.service';
import { body, params, query } from '../../utils/validate';
import type {
  CreatePricingRuleInput,
  CreateSubscriptionInput,
  FareEstimateQuery,
  IdParam,
  UpdatePricingRuleInput,
} from './pricing.validation';

export async function createSubscription(req: Request, res: Response): Promise<void> {
  const data = await pricingService.createSubscription(
    req.user!.userId,
    body<CreateSubscriptionInput>(req),
  );
  res.status(201).json({ success: true, data });
}

/** The plans a customer may buy, with their server-side prices. */
export async function listSubscriptionPlans(_req: Request, res: Response): Promise<void> {
  res.json({ success: true, data: pricingService.listSubscriptionPlans() });
}

export async function getMySubscription(req: Request, res: Response): Promise<void> {
  const data = await pricingService.getMySubscription(req.user!.userId);
  res.json({ success: true, data });
}

export async function cancelSubscription(req: Request, res: Response): Promise<void> {
  const data = await pricingService.cancelSubscription(req.user!.userId);
  res.json({ success: true, data });
}

export async function fareEstimate(req: Request, res: Response): Promise<void> {
  const q = query<FareEstimateQuery>(req);
  const data = await pricingService.calculateFare({
    city: q.city,
    tripType: q.tripType,
    requestedAt: q.requestedAt,
    hours: q.hours,
    customerId: req.user!.userId,
    vehicleClass: q.vehicleClass,
    pickupAddress: q.pickup,
    dropAddress: q.drop,
    meetAndGreet: q.meetAndGreet,
  });
  res.json({ success: true, data });
}

export async function createPricingRule(req: Request, res: Response): Promise<void> {
  const data = await pricingService.createPricingRule(body<CreatePricingRuleInput>(req));
  res.status(201).json({ success: true, data });
}

export async function listPricingRules(_req: Request, res: Response): Promise<void> {
  const data = await pricingService.listPricingRules();
  res.json({ success: true, data });
}

export async function updatePricingRule(req: Request, res: Response): Promise<void> {
  const data = await pricingService.updatePricingRule(
    params<IdParam>(req).id,
    body<UpdatePricingRuleInput>(req),
  );
  res.json({ success: true, data });
}

export async function deletePricingRule(req: Request, res: Response): Promise<void> {
  await pricingService.deletePricingRule(params<IdParam>(req).id);
  res.json({ success: true, data: { deleted: true } });
}
