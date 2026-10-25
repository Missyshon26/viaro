import crypto from 'node:crypto';
import bcrypt from 'bcrypt';
import { User } from '../../models/User';
import { ApiError } from '../../utils/ApiError';
import { splitName } from '../../utils/profile';
import { getOrCreateWallet } from '../wallet/wallet.service';
import { issueTokens, sanitise } from './auth.service';
import { alertNewCustomer } from '../notifications/notification.emails';
import { sendGuestWelcome } from './auth.account.service';
import type { GuestInput } from './auth.validation';

const BCRYPT_ROUNDS = 12;

/**
 * "Continue as guest" at checkout.
 *
 * A NEW email gets a real customer account (random password nobody knows, tagged
 * `isGuest`) so the booking belongs to a user like any other, plus a link to choose a
 * password. An email that already has an account is refused with 409 ACCOUNT_EXISTS —
 * they must sign in, otherwise anyone could book into someone else's account history.
 */
export async function guestCheckout(input: GuestInput) {
  const existing = await User.findOne({ email: input.email }).lean();
  if (existing) {
    throw new ApiError(409, 'Your account is already registered. Please sign in.', {
      code: 'ACCOUNT_EXISTS',
    });
  }

  const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString('base64url'), BCRYPT_ROUNDS);

  const user = await User.create({
    role: 'customer',
    name: input.name,
    ...splitName(input.name),
    email: input.email,
    phone: input.phone,
    passwordHash,
    status: 'active',
    isGuest: true,
  });

  try {
    const wallet = await getOrCreateWallet(user._id, 'customer');
    user.walletId = wallet._id;
    await user.save();
  } catch (err) {
    // An account with no wallet is half made and cannot book; a retry would also be refused
    // as "already registered". Remove it so the guest can simply try again.
    await User.deleteOne({ _id: user._id }).catch(() => undefined);
    throw err;
  }

  // Not awaited: a slow mail server must not hold up the booking.
  void sendGuestWelcome(user);
  void alertNewCustomer({ name: user.name, email: user.email, phone: user.phone }, true);

  const tokens = issueTokens(String(user._id), user.role);
  return { user: sanitise(user), role: user.role, ...tokens };
}
