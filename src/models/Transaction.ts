import { Schema, model, Types, type HydratedDocument } from 'mongoose';

export const TRANSACTION_TYPES = ['credit', 'debit', 'refund', 'withdrawal'] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export interface ITransaction {
  walletId: Types.ObjectId;
  type: TransactionType;
  amount: number;
  /**
   * Spec §8 rule 3: fee is charged ONLY on withdrawal (10%). Refunds and ride credit
   * are always feeApplied = 0 — these are deliberately separate code paths in
   * wallet.service.ts / cancellation.service.ts.
   */
  feeApplied: number;
  meta: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export type TransactionDocument = HydratedDocument<ITransaction>;

const transactionSchema = new Schema<ITransaction>(
  {
    walletId: { type: Schema.Types.ObjectId, ref: 'Wallet', required: true, index: true },
    type: { type: String, enum: TRANSACTION_TYPES, required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    feeApplied: { type: Number, default: 0, min: 0 },
    meta: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

transactionSchema.index({ walletId: 1, createdAt: -1 });

/**
 * One charge per trip, enforced by the database.
 *
 * `collectTripPayment` checks for an existing `trip_payment` row before charging, but a
 * check followed by a write is not atomic: two parallel Collect requests both found
 * nothing and both billed the customer, leaving two ledger rows for one ride — and a
 * later refund sums those rows, so the customer would have been refunded twice the fare.
 * Only a unique index can actually make this impossible under concurrency.
 *
 * Partial, so it constrains nothing but trip payments — every other transaction kind may
 * legitimately repeat for the same trip (ride_credit, refunds, revenue splits).
 */
transactionSchema.index(
  { 'meta.tripId': 1 },
  {
    unique: true,
    partialFilterExpression: { 'meta.reason': 'trip_payment' },
    name: 'uniq_trip_payment_per_trip',
  },
);

/**
 * A settlement entry can be taken back once, and only once.
 *
 * Reversing a no-show writes one `settlement_reversal` row per original row, naming it in
 * `meta.reverses`. The unique index makes a repeated or racing reversal a no-op instead of
 * clawing the same money back twice.
 */
transactionSchema.index(
  { 'meta.reverses': 1 },
  {
    unique: true,
    partialFilterExpression: { 'meta.reason': 'settlement_reversal' },
    name: 'uniq_settlement_reversal',
  },
);

export const Transaction = model<ITransaction>('Transaction', transactionSchema);
