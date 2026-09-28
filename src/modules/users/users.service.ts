import { User } from '../../models/User';
import { Driver } from '../../models/Driver';
import { Booking } from '../../models/Booking';
import { Trip } from '../../models/Trip';
import { ApiError } from '../../utils/ApiError';
import { uploadToS3 } from '../../utils/s3';
import type { UpdateProfileInput, UploadDocumentInput } from './users.validation';

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

export async function updateProfile(userId: string, input: UpdateProfileInput) {
  const user = await User.findById(userId);
  if (!user) throw ApiError.notFound('User not found');

  if (input.name !== undefined) user.name = input.name;

  /*
   * Changing the number un-verifies it.
   *
   * `phoneVerified` was left true across a phone change, so a user could verify one
   * number they controlled and then swap in any other — carrying the verified badge onto
   * a number that had never received an OTP, and defeating the point of the check.
   */
  if (input.phone !== undefined && input.phone !== user.phone) {
    user.phone = input.phone;
    user.phoneVerified = false;
  }

  await user.save();

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
