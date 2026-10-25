import { z } from 'zod';

export const idParamSchema = z.object({
  id: z.string().regex(/^[a-fA-F0-9]{24}$/, 'Invalid trip id'),
});

export type IdParam = z.infer<typeof idParamSchema>;

/**
 * Socket payload shape for 'message:new'. Validated in chat.socket.ts as well as here,
 * because a socket frame never passes through Express middleware.
 */
export const chatMessageSchema = z.object({
  message: z.string().trim().min(1, 'Message cannot be empty').max(2000),
});

export type ChatMessageInput = z.infer<typeof chatMessageSchema>;
