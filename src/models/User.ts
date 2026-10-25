import { Schema, model, Types, type HydratedDocument } from 'mongoose';
import { ROLES, type UserRole } from '../utils/roles';
import type { Address as IAddress } from '../utils/profile';

export const USER_STATUSES = ['active', 'pending_documents', 'suspended'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export interface IUser {
  role: UserRole;
  name: string;
  /**
   * The two halves of `name`, kept so the profile can edit them separately. `name` stays
   * the one required field every screen and email reads; it is always rebuilt from these
   * when either changes. Absent on accounts made before they existed (see splitName).
   */
  firstName?: string;
  lastName?: string;
  /** Where the customer lives or is billed; optional, and all-or-nothing when given. */
  address?: IAddress;
  email: string;
  phone: string;
  passwordHash: string;
  /** Google's stable id for the account, set when the customer signs in with Google. */
  googleId?: string;
  /** Optional sign-in name, lowercase, unique. Carried over from the old admin console, which signed in by username. */
  username?: string;
  /** Present only on accounts carried over from the old system. */
  legacy?: { id: Types.ObjectId; stripeId?: string; documentStatus?: string; mergedIds?: Types.ObjectId[]; mergedUids?: string[]; importedAt: Date };
  /** The account's id in the old Firebase project (history import); links old records. */
  firebaseUid?: string;
  /**
   * 'firebase' while the password still only exists in the old Firebase project. The first
   * successful login checks it there, stores it as a normal hash here and clears this.
   */
  legacyAuth?: 'firebase';
  /** Customer's favourite drivers (spec §4.1). */
  favorites: Types.ObjectId[];
  walletId?: Types.ObjectId;
  /** Stripe customer id, created at the first card payment. */
  stripeCustomerId?: string;
  status: UserStatus;
  /** Set by the phone-verification flow (customer screen 03). */
  phoneVerified: boolean;
  /** Created through "Continue as guest" at checkout rather than the sign-up form. */
  isGuest: boolean;
  /** Which rental agreement the passenger signed, and when. See config/agreement.ts. */
  agreement?: { version: string; signedAt: Date; review?: { status: 'approved' | 'rejected'; at: Date; byName?: string } };
  /**
   * The drawn signature, as a PNG data URL. Held apart from `agreement` and excluded from
   * ordinary reads: it is tens of kilobytes that nearly every user payload would
   * otherwise carry for nothing.
   */
  signature?: string;
  /**
   * Soft delete. The row is kept because wallets, trips and transactions reference it
   * and financial history must stay intact; PII is scrubbed instead.
   */
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type UserDocument = HydratedDocument<IUser>;

const userSchema = new Schema<IUser>(
  {
    role: { type: String, enum: ROLES, required: true, index: true },
    name: { type: String, required: true, trim: true },
    firstName: { type: String, trim: true, maxlength: 60 },
    lastName: { type: String, trim: true, maxlength: 60 },
    address: {
      type: new Schema(
        {
          line1: { type: String, required: true, trim: true, maxlength: 120 },
          line2: { type: String, trim: true, maxlength: 120 },
          city: { type: String, required: true, trim: true, maxlength: 80 },
          state: { type: String, required: true, trim: true, maxlength: 40 },
          postalCode: { type: String, required: true, trim: true, maxlength: 12 },
        },
        { _id: false },
      ),
      default: undefined,
    },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    googleId: { type: String, index: { unique: true, sparse: true } },
    username: { type: String, lowercase: true, trim: true, index: { unique: true, sparse: true } },
    firebaseUid: { type: String, index: { unique: true, sparse: true } },
    legacy: {
      type: new Schema(
        {
          id: { type: Schema.Types.ObjectId, required: true },
          stripeId: { type: String },
          documentStatus: { type: String },
          mergedIds: { type: [Schema.Types.ObjectId], default: undefined },
          mergedUids: { type: [String], default: undefined },
          importedAt: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: undefined,
    },
    legacyAuth: { type: String, enum: ['firebase'] },
    favorites: [{ type: Schema.Types.ObjectId, ref: 'Driver' }],
    walletId: { type: Schema.Types.ObjectId, ref: 'Wallet' },
    stripeCustomerId: { type: String, index: true, sparse: true },
    status: { type: String, enum: USER_STATUSES, default: 'active', index: true },
    phoneVerified: { type: Boolean, default: false },
    isGuest: { type: Boolean, default: false },
    agreement: {
      type: new Schema(
        {
          version: { type: String, required: true },
          signedAt: { type: Date, required: true },
          // Operations' verdict on the signed agreement. Signing again replaces the whole
          // block, so a new signature always starts unreviewed.
          review: {
            type: new Schema(
              {
                status: { type: String, enum: ['approved', 'rejected'], required: true },
                at: { type: Date, required: true },
                byName: { type: String },
              },
              { _id: false },
            ),
            default: undefined,
          },
        },
        { _id: false },
      ),
      default: undefined,
    },
    signature: { type: String, select: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// passwordHash is select:false, so it never leaks through a plain find().
// Auth explicitly re-selects it when verifying a login.
userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    const plain = ret as unknown as Record<string, unknown>;
    delete plain.passwordHash;
    delete plain.signature;
    delete plain.__v;
    return plain;
  },
});

export const User = model<IUser>('User', userSchema);
