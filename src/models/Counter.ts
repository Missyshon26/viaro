import { Schema, model } from 'mongoose';

/**
 * A named running number. One document per sequence (today only 'tripNo', the number printed
 * on invoices and receipts); `seq` is the last number handed out.
 */
export interface ICounter {
  _id: string;
  seq: number;
}

const counterSchema = new Schema<ICounter>({
  _id: { type: String, required: true },
  seq: { type: Number, required: true, default: 0 },
});

export const Counter = model<ICounter>('Counter', counterSchema);
