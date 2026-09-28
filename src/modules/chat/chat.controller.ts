import type { Request, Response } from 'express';
import * as chatService from './chat.service';
import { params } from '../../utils/validate';
import { body } from '../../utils/validate';
import type { ChatMessageInput, IdParam } from './chat.validation';

export async function history(req: Request, res: Response): Promise<void> {
  const data = await chatService.getHistory(params<IdParam>(req).id, req.user!);
  res.json({ success: true, data });
}

export async function send(req: Request, res: Response): Promise<void> {
  const data = await chatService.postMessage(
    params<IdParam>(req).id,
    req.user!,
    body<ChatMessageInput>(req).message,
  );
  res.status(201).json({ success: true, data });
}
