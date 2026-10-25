import { Schema, model, Types, type HydratedDocument } from 'mongoose';

/**
 * Spec §6 lists ownerType as driver|customer. Company and platform are added here because
 * the revenue split (spec §8) has to credit a company wallet and a single platform/admin
 * wallet — without them there is nowhere for the 60/40 split to land.
 */
export const WALLET_OWNER_TYPES = ['customer', 'driver', 'company', 'platform'] as const;
export type WalletOwnerType = (typeof WALLET_OWNER_TYPES)[number];

export interface IWallet {
  /** null only for the singleton platform wallet, which belongs to no single user. */
  ownerId: Types.ObjectId | null;
  ownerType: WalletOwnerType;
  balance: number;
  createdAt: Date;
  updatedAt: Date;
}

export type WalletDocument = HydratedDocument<IWallet>;

const walletSchema = new Schema<IWallet>(
  {
    ownerId: { type: Schema.Types.ObjectId, default: null },
    ownerType: { type: String, enum: WALLET_OWNER_TYPES, required: true },
    balance: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

// One wallet per owner; the platform wallet (ownerId null) is unique by its type.
walletSchema.index({ ownerId: 1, ownerType: 1 }, { unique: true });

export const Wallet = model<IWallet>('Wallet', walletSchema);
