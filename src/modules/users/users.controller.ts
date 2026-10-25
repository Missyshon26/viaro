import type { Request, Response } from 'express';
import * as usersService from './users.service';
import { deleteOwnAccount } from '../auth/auth.account.service';
import { body, params } from '../../utils/validate';
import type {
  ObjectIdParam,
  SignAgreementInput,
  UpdateProfileInput,
  UploadDocumentInput,
} from './users.validation';

export async function getMe(req: Request, res: Response): Promise<void> {
  const data = await usersService.getProfile(req.user!.userId);
  res.json({ success: true, data });
}

export async function updateMe(req: Request, res: Response): Promise<void> {
  const data = await usersService.updateProfile(req.user!.userId, body<UpdateProfileInput>(req));
  res.json({ success: true, data });
}

export async function deleteMe(req: Request, res: Response): Promise<void> {
  const data = await deleteOwnAccount(req.user!.userId);
  res.json({ success: true, data });
}

export async function uploadDocument(req: Request, res: Response): Promise<void> {
  const data = await usersService.addDocument(req.user!.userId, body<UploadDocumentInput>(req));
  res.status(201).json({ success: true, data });
}

export async function addFavorite(req: Request, res: Response): Promise<void> {
  const data = await usersService.addFavorite(req.user!.userId, params<ObjectIdParam>(req).driverId);
  res.status(201).json({ success: true, data });
}

export async function listFavorites(req: Request, res: Response): Promise<void> {
  const data = await usersService.listFavorites(req.user!.userId);
  res.json({ success: true, data });
}

export async function removeFavorite(req: Request, res: Response): Promise<void> {
  const data = await usersService.removeFavorite(req.user!.userId, params<ObjectIdParam>(req).driverId);
  res.json({ success: true, data });
}

export async function getMyAgreement(req: Request, res: Response): Promise<void> {
  // The passenger's own signature comes back so the account page can show it.
  const data = await usersService.getAgreementStatus(req.user!.userId, { withSignature: true });
  res.json({ success: true, data });
}

export async function signMyAgreement(req: Request, res: Response): Promise<void> {
  const data = await usersService.signAgreement(req.user!.userId, body<SignAgreementInput>(req));
  res.json({ success: true, data });
}
