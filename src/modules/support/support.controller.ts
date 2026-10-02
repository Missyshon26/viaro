import type { Request, Response } from 'express';
import * as supportService from './support.service';
import { body, params, query } from '../../utils/validate';
import type {
  CreateTicketInput,
  IdParam,
  ListTicketsQuery,
  ReplyInput,
  UpdateTicketInput,
} from './support.validation';

export async function create(req: Request, res: Response): Promise<void> {
  const data = await supportService.createTicket(req.user!, body<CreateTicketInput>(req));
  res.status(201).json({ success: true, data });
}

export async function list(req: Request, res: Response): Promise<void> {
  const data = await supportService.listTickets(req.user!, query<ListTicketsQuery>(req));
  res.json({ success: true, data });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const data = await supportService.getTicket(params<IdParam>(req).id, req.user!);
  res.json({ success: true, data });
}

export async function reply(req: Request, res: Response): Promise<void> {
  const data = await supportService.reply(params<IdParam>(req).id, req.user!, body<ReplyInput>(req));
  res.status(201).json({ success: true, data });
}

export async function updateStatus(req: Request, res: Response): Promise<void> {
  const data = await supportService.updateStatus(
    params<IdParam>(req).id,
    body<UpdateTicketInput>(req),
  );
  res.json({ success: true, data });
}
