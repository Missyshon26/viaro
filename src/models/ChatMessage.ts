import { Schema, model, Types, type HydratedDocument } from 'mongoose';
import { ROLES, type UserRole } from '../utils/roles';

export interface IChatMessage {
  tripId: Types.ObjectId;
  senderId: Types.ObjectId;
  senderRole: UserRole;
  message: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ChatMessageDocument = HydratedDocument<IChatMessage>;

const chatMessageSchema = new Schema<IChatMessage>(
  {
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', required: true, index: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    senderRole: { type: String, enum: ROLES, required: true },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
  },
  { timestamps: true },
);

// History is always read oldest-first for a single trip.
chatMessageSchema.index({ tripId: 1, createdAt: 1 });

export const ChatMessage = model<IChatMessage>('ChatMessage', chatMessageSchema);
