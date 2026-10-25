import mongoose from 'mongoose';
import { MEET_AND_GREET_FEE } from '../../config/services';
import { PricingRule } from '../../models/PricingRule';
import { VehicleClass } from '../../models/VehicleClass';
import { PRIMETIME } from '../pricing/pricing.service';
import * as vehicleService from '../vehicle/vehicle.service';

/**
 * Brings the old booking site's vehicle lineup and prices into service.
 *
 * `legacy.import` carries the old vehicles over switched OFF, because the history needs them
 * to name the car on every old booking. This switches the live ones ON with their old prices:
 *
 *   base price (covers the first 18 miles)  ->  the class's flat transfer rate
 *   hourly price                            ->  the class's hourly rate
 *   stop price                              ->  the class's stop fee
 *   the vehicle's photo                     ->  copied into this app's own storage
 *
 * The old per-mile rate for distance beyond the base is NOT carried: this calculator has no
 * per-mile price, so a longer trip costs the flat rate, not more. The default classes this
 * app created for itself are switched off, and a Seattle base-fare rule is added if there is
 * none (the calculator will not price anything without one; every old class has a flat or
 * hourly rate, so the figure itself is not what these prices come from).
 *
 * Reads `legacy_vehicles` and `legacy_taxes` from this database. Safe to run twice.
 */
export interface CatalogueReport {
  apply: boolean;
  switchedOn: { label: string; flatRate: number; hourlyRate: number | null; stopFee: number | null; photos: number }[];
  switchedOff: string[];
  pricingRule: 'created' | 'already there';
  notes: string[];
  problems: string[];
}

type Raw = Record<string, unknown>;
const price = (v: unknown): number | null => {
  const n = parseFloat(String(v ?? ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

export type ImageFetcher = (file: string) => Promise<Buffer | null>;

export async function activateLegacyCatalogue(options: {
  apply: boolean;
  fetchImage?: ImageFetcher;
  city?: string;
}): Promise<CatalogueReport> {
  const { apply, fetchImage, city = 'seattle' } = options;
  const report: CatalogueReport = { apply, switchedOn: [], switchedOff: [], pricingRule: 'already there', notes: [], problems: [] };

  const legacy = (await mongoose.connection.collection('legacy_vehicles').find({}).toArray()) as unknown as Raw[];
  const live = legacy
    .filter((v) => String(v.status ?? '').toLowerCase() === 'live')
    // slNo 0 is "no position" in the old data: those go last.
    .sort((a, b) => ((Number(a.slNo) || 99) - (Number(b.slNo) || 99)));

  for (const [position, v] of live.entries()) {
    const label = String(v.vehicleName ?? '').trim();
    const flatRate = price(v.basePrice);
    if (!flatRate) {
      report.problems.push(`${label}: no base price in the old data, left as it was`);
      continue;
    }
    const cls = await VehicleClass.findOne({ label, value: /^legacy-/ });
    if (!cls) {
      report.problems.push(`${label}: not found among the imported vehicles (run the history import first)`);
      continue;
    }
    const hourlyRate = price(v.pricePerUnitHour);
    const stopFee = price(v.stopPrice);
    const files = Array.isArray(v.images) ? (v.images as string[]) : [];
    let photos = cls.images?.length ?? 0;

    if (apply) {
      cls.active = true;
      cls.flatRate = flatRate;
      cls.hourlyRate = hourlyRate;
      cls.stopFee = stopFee;
      cls.sortOrder = position + 1;
      const feature = String(v.feature ?? '').trim();
      if (feature) cls.detail = feature;
      // The card label the old site put on a class ("Most Popular").
      const banner = String(v.banner ?? '').trim();
      if (banner) cls.badge = banner;
      await cls.save();

      if (photos === 0 && fetchImage) {
        for (const file of files) {
          const bytes = await fetchImage(file);
          if (!bytes) {
            report.problems.push(`${label}: could not fetch the photo ${file}`);
            continue;
          }
          try {
            await vehicleService.addImage(String(cls._id), bytes, {});
            photos++;
          } catch (err) {
            report.problems.push(`${label}: photo ${file} was refused (${err instanceof Error ? err.message : 'unknown'})`);
          }
        }
      }
    }
    report.switchedOn.push({ label, flatRate, hourlyRate, stopFee, photos });
  }

  if (report.switchedOn.length > 0) {
    const others = await VehicleClass.find({ value: { $not: /^legacy-/ }, active: true }).select('label').lean();
    report.switchedOff = others.map((c) => c.label);
    if (apply && others.length) await VehicleClass.updateMany({ value: { $not: /^legacy-/ }, active: true }, { $set: { active: false } });
  }

  const rule = await PricingRule.findOne({ city }).lean();
  if (!rule) {
    report.pricingRule = 'created';
    const baseFare = Math.min(...report.switchedOn.map((v) => v.flatRate), 129);
    if (apply) await PricingRule.create({ city, baseFare, peakMultiplier: 1 });
    report.notes.push(`Seattle base fare set to $${baseFare} with no peak multiplier (the old site had none); every switched-on class has its own flat and hourly rate, so quotes come from those.`);
  }

  const taxes = (await mongoose.connection.collection('legacy_taxes').findOne({})) as Raw | null;
  if (taxes) {
    const compare = (what: string, old: unknown, now: number) => {
      const n = price(old);
      if (n !== null && n !== now) report.notes.push(`${what}: the old site charged $${n}, this app charges $${now}. Change it in the code if the old amount should stand.`);
    };
    compare('Meet and Greet', taxes.meetGreetCost, MEET_AND_GREET_FEE);
    compare('Primetime surcharge', taxes.primeTimeCost, PRIMETIME.surcharge);
  }
  return report;
}
