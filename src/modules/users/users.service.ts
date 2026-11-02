import { User } from '../../models/User';
import { Driver } from '../../models/Driver';
import { Booking } from '../../models/Booking';
import { Trip } from '../../models/Trip';
import { ApiError } from '../../utils/ApiError';
import { uploadToS3 } from '../../utils/s3';
import { AGREEMENT_VERSION } from '../../config/agreement';
import { sendContactNumberReset, sendDocumentDecision } from '../notifications/notification.emails';
import { now, toDate } from '../../config/timezone';
import { assertPngDataUrl } from '../../utils/signature';
import { joinName, splitName } from '../../utils/profile';
import type { SignAgreementInput, UpdateProfileInput, UploadDocumentInput } from './users.validation';

export async function getProfile(userId: string) {
  const user = await User.findById(userId).lean();
  if (!user) throw ApiError.notFound('User not found');

  // Drivers carry an extra profile document; return it alongside so clients make one call.
  if (user.role === 'driver') {
    const driver = await Driver.findOne({ userId }).lean();
    return { ...user, driver };
  }

  return user;
}

/**
 * Name and address, shared in spirit with the admin's client edit (admin.customers.ts).
 *
 * The full name stays the field everything else reads, so it is rebuilt whenever the
 * halves change. If a caller sends a full `name` alone (an older client), the halves are
 * derived from it, so the two never drift apart. First/last win when both are sent.
 */
export function applyNameAndAddress(
  user: {
    name: string;
    firstName?: string;
    lastName?: string;
    address?: unknown;
  },
  input: {
    name?: string;
    firstName?: string;
    lastName?: string;
    address?: { line1: string; line2?: string; city: string; state: string; postalCode: string } | null;
  },
): void {
  if (input.firstName !== undefined || input.lastName !== undefined) {
    const existing = splitName(user.name);
    const firstName = input.firstName ?? user.firstName ?? existing.firstName;
    const lastName = input.lastName ?? user.lastName ?? existing.lastName;
    const name = joinName(firstName, lastName);
    if (name.length < 2) throw ApiError.badRequest('Please enter your full name');
    user.firstName = firstName.trim();
    user.lastName = lastName.trim();
    user.name = name;
  } else if (input.name !== undefined) {
    const parts = splitName(input.name);
    user.name = input.name;
    user.firstName = parts.firstName;
    user.lastName = parts.lastName;
  }

  if (input.address === null) user.address = undefined;
  else if (input.address !== undefined) {
    const { line2, ...rest } = input.address;
    user.address = { ...rest, ...(line2 ? { line2 } : {}) };
  }
}

export async function updateProfile(userId: string, input: UpdateProfileInput) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('User not found');

  applyNameAndAddress(user, input);

  /*
   * Changing the number un-verifies it.
   *
   * `phoneVerified` was left true across a phone change, so a user could verify one
   * number they controlled and then swap in any other — carrying the verified badge onto
   * a number that had never received an OTP, and defeating the point of the check.
   */
  let phoneChanged = false;
  if (input.phone !== undefined && input.phone !== user.phone) {
    user.phone = input.phone;
    user.phoneVerified = false;
    phoneChanged = true;
  }

  await user.save();
  // A number changed on an account is worth an email to that account: if it was not them,
  // they find out. Customers only, and never allowed to slow or fail the save.
  if (phoneChanged && user.role === 'customer') void sendContactNumberReset(user, user.phone);

  if (input.vehicleClass !== undefined) {
    if (user.role !== 'driver') {
      throw ApiError.badRequest('vehicleClass can only be set on a driver profile');
    }
    await Driver.updateOne({ userId }, { $set: { vehicleClass: input.vehicleClass } });
  }

  return getProfile(userId);
}

export async function addDocument(userId: string, input: UploadDocumentInput) {
  const driver = await Driver.findOne({ userId });
  if (!driver) throw ApiError.notFound('Driver profile not found');

  const url = await uploadToS3(userId, input);
  driver.documents.push(url);
  await driver.save();

  /*
   * This legacy route records a file NAME only (utils/s3.ts stores nothing), so it no
   * longer lifts the pending-documents hold — it used to activate an account on the
   * first call, with no file behind it. The hold is released by POST
   * /drivers/me/documents once the full checklist is on file.
   */

  return { documents: driver.documents, uploaded: url };
}

/* ----------------------------- favourite drivers -------------------------- */

export async function addFavorite(userId: string, driverId: string) {
  const driver = await Driver.findById(driverId).lean();
  if (!driver) throw ApiError.notFound('Driver not found');

  /*
   * Only a chauffeur who has actually completed a ride for this passenger. A favourite is
   * a preference built from experience — and without this check any driver id, guessed or
   * copied, could be pinned to a customer's account and preferred by dispatch.
   */
  const ownBookings = await Booking.find({ customerId: userId }).select('_id').lean();
  const rodeWith = await Trip.exists({
    driverId: driver._id,
    status: 'completed',
    bookingId: { $in: ownBookings.map((b) => b._id) },
  });
  if (!rodeWith) {
    throw ApiError.forbidden('You can only favourite a chauffeur who has completed a trip with you');
  }

  // $addToSet keeps the operation idempotent — favouriting twice is not an error.
  await User.updateOne({ _id: userId }, { $addToSet: { favorites: driver._id } });
  return listFavorites(userId);
}

export async function listFavorites(userId: string) {
  const user = await User.findById(userId)
    .populate({
      path: 'favorites',
      // Driver documents and penalty counts are internal — customers see the ride-relevant bits.
      select: 'vehicleClass status rating userId',
      populate: { path: 'userId', select: 'name' },
    })
    .lean();

  if (!user) throw ApiError.notFound('User not found');
  return user.favorites ?? [];
}

export async function removeFavorite(userId: string, driverId: string) {
  await User.updateOne({ _id: userId }, { $pull: { favorites: driverId } });
  return listFavorites(userId);
}

/* -------------------------- rental agreement ------------------------------ */

/**
 * Where a passenger stands on the agreement. `signed` is true only for the CURRENT
 * revision: someone who signed an older wording is asked again.
 */
export async function getAgreementStatus(userId: string, opts: { withSignature?: boolean } = {}) {
  const query = User.findById(userId).select('role agreement isGuest');
  const user = await (opts.withSignature ? query.select('+signature') : query).lean();
  if (!user) throw ApiError.notFound('User not found');

  const signed = user.agreement?.version === AGREEMENT_VERSION;
  return {
    currentVersion: AGREEMENT_VERSION,
    /** A guest accepts with the ticked box alone; everyone else also draws a signature. */
    guest: Boolean(user.isGuest),
    signed,
    version: user.agreement?.version ?? null,
    signedAt: user.agreement?.signedAt ?? null,
    review: user.agreement?.review ?? null,
    ...(opts.withSignature && user.signature ? { signature: user.signature } : {}),
  };
}

export async function signAgreement(userId: string, input: SignAgreementInput) {
  if (input.version !== AGREEMENT_VERSION) {
    throw ApiError.conflict('The agreement has been updated. Please reload and read the new version.');
  }

  const existing = await User.findById(userId).select('isGuest').lean();
  if (!existing) throw ApiError.notFound('User not found');

  // A guest accepts by ticking the box; a registered customer must also have drawn a signature.
  if (input.signature) {
    try {
      assertPngDataUrl(input.signature);
    } catch (err) {
      throw ApiError.badRequest((err as Error).message);
    }
  } else if (!existing.isGuest) {
    throw ApiError.badRequest('Please sign the agreement');
  }

  const signedAt = toDate(now());
  const user = await User.findByIdAndUpdate(
    userId,
    {
      $set: {
        ...(input.signature ? { signature: input.signature } : {}),
        agreement: { version: AGREEMENT_VERSION, signedAt },
      },
    },
    { new: true },
  ).select('agreement');
  if (!user) throw ApiError.notFound('User not found');

  return getAgreementStatus(userId);
}

/**
 * Operations' verdict on a customer's signed agreement. The customer is emailed it.
 * Signing again replaces the agreement, and so clears the verdict: a new signature is
 * reviewed afresh.
 */
export async function reviewAgreement(userId: string, decision: 'approve' | 'reject', adminId: string) {
  const user = await User.findOne({ _id: userId, role: 'customer', deletedAt: null }).select('name email agreement');
  if (!user) throw ApiError.notFound('Client not found');
  if (!user.agreement) throw ApiError.conflict('This client has not signed the agreement yet');

  const admin = await User.findById(adminId).select('name').lean();
  user.agreement.review = {
    status: decision === 'approve' ? 'approved' : 'rejected',
    at: toDate(now()),
    byName: admin?.name,
  };
  user.markModified('agreement');
  await user.save();

  void sendDocumentDecision(user, decision === 'approve');
  return getAgreementStatus(userId);
}
