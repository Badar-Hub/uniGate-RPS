import type { BidDto } from '@unigate/types';

/**
 * Builds the `POST /bids` body (api.md §8.13, `createBidBody` in @unigate/validation) and the
 * `PATCH /bids/{id}` revision body from the form state, the way the web portal's `bid-form.tsx`
 * does: amounts become 2dp decimal strings, extras carry both labels (the same text for both
 * when the owner typed only one), empty optionals are omitted (the schemas are `.strict()`),
 * and totals are never sent — the API computes extras, VAT and the total. Pure, unit-tested.
 */

export interface BidExtraForm {
  /** Local key for the row. */
  key: string;
  labelEn: string;
  labelAr: string;
  amount: string;
}

export interface BidFormState {
  vehicleId: string;
  driverProfileId: string;
  baseAmount: string;
  extras: BidExtraForm[];
  estimatedDurationMinutes: string;
  validUntil: Date | null;
  notes: string;
}

export const MAX_EXTRAS = 20;

export const KNOWN_BID_FIELDS = [
  'tripRequestId',
  'vehicleId',
  'driverProfileId',
  'baseAmount',
  'extrasBreakdown',
  'estimatedArrivalAt',
  'estimatedDurationMinutes',
  'validUntil',
  'ownerNotes',
];

export const EMPTY_BID_FORM: BidFormState = {
  vehicleId: '',
  driverProfileId: '',
  baseAmount: '',
  extras: [],
  estimatedDurationMinutes: '',
  validUntil: null,
  notes: '',
};

let extraSeq = 0;
export function newExtra(): BidExtraForm {
  extraSeq += 1;
  return { key: `x${extraSeq}`, labelEn: '', labelAr: '', amount: '' };
}

/** `"1250"` → `"1250.00"`, `"12.5"` → `"12.50"`; anything else → null. Never `parseFloat` on the way out. */
export function money(value: string): string | null {
  const v = value.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const [int = '0', frac = ''] = v.split('.');
  return `${int.replace(/^0+(?=\d)/, '')}.${frac.padEnd(2, '0')}`;
}

export interface BidExtraBody {
  labelEn: string;
  labelAr: string;
  amount: string;
}

export interface CreateBidBody {
  tripRequestId: string;
  vehicleId: string;
  driverProfileId?: string;
  baseAmount: string;
  extrasBreakdown: BidExtraBody[];
  estimatedDurationMinutes?: number;
  validUntil?: string;
  ownerNotes?: string;
}

/** Form → client-side field errors (catalogue keys), mirroring the web's disabled-button conditions. */
export function validateBidForm(form: BidFormState, options: { deadline?: string | null } = {}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.vehicleId) errors['vehicleId'] = 'bidForm.errors.vehicleRequired';
  const base = money(form.baseAmount);
  if (base === null || Number(base) <= 0) errors['baseAmount'] = 'bidForm.errors.baseInvalid';
  form.extras.forEach((x, i) => {
    const hasAny = x.labelEn.trim() || x.labelAr.trim() || x.amount.trim();
    if (!hasAny) return;
    if (!x.labelEn.trim() && !x.labelAr.trim()) errors[`extrasBreakdown.${i}.labelEn`] = 'bidForm.errors.extraLabelRequired';
    if (money(x.amount) === null) errors[`extrasBreakdown.${i}.amount`] = 'bidForm.errors.extraAmountInvalid';
  });
  if (form.extras.length > MAX_EXTRAS) errors['extrasBreakdown'] = 'bidForm.errors.tooManyExtras';
  if (form.estimatedDurationMinutes.trim()) {
    const n = Number(form.estimatedDurationMinutes);
    if (!Number.isInteger(n) || n < 1 || n > 10_080) errors['estimatedDurationMinutes'] = 'bidForm.errors.durationInvalid';
  }
  if (form.validUntil) {
    if (form.validUntil.getTime() <= Date.now()) errors['validUntil'] = 'bidForm.errors.validUntilPast';
    else if (options.deadline && form.validUntil.getTime() > new Date(options.deadline).getTime())
      errors['validUntil'] = 'bidForm.errors.validUntilAfterDeadline';
  }
  return errors;
}

/** Extras with any content become body rows; blank rows are dropped; a missing label copies the other language. */
export function buildExtras(extras: BidExtraForm[]): BidExtraBody[] {
  return extras
    .filter((x) => x.labelEn.trim() || x.labelAr.trim() || x.amount.trim())
    .map((x) => {
      const en = x.labelEn.trim() || x.labelAr.trim();
      const ar = x.labelAr.trim() || x.labelEn.trim();
      return { labelEn: en, labelAr: ar, amount: money(x.amount) ?? '0.00' };
    });
}

export function buildBidBody(tripRequestId: string, form: BidFormState): CreateBidBody {
  const duration = form.estimatedDurationMinutes.trim();
  return {
    tripRequestId,
    vehicleId: form.vehicleId,
    ...(form.driverProfileId ? { driverProfileId: form.driverProfileId } : {}),
    baseAmount: money(form.baseAmount) ?? '0.00',
    extrasBreakdown: buildExtras(form.extras),
    ...(duration ? { estimatedDurationMinutes: Number(duration) } : {}),
    ...(form.validUntil ? { validUntil: form.validUntil.toISOString() } : {}),
    ...(form.notes.trim() ? { ownerNotes: form.notes.trim() } : {}),
  };
}

export interface PatchBidBody {
  driverProfileId?: string | null;
  baseAmount?: string;
  extrasBreakdown?: BidExtraBody[];
  estimatedDurationMinutes?: number | null;
  validUntil?: string;
  ownerNotes?: string | null;
}

/** The form state a revision starts from — the bid's current values. */
export function bidFormFromBid(bid: BidDto): BidFormState {
  return {
    vehicleId: bid.vehicle.id,
    driverProfileId: bid.driverProfileId ?? '',
    baseAmount: bid.baseAmount,
    extras: bid.extrasBreakdown.map((x) => ({ ...newExtra(), labelEn: x.labelEn, labelAr: x.labelAr, amount: x.amount })),
    estimatedDurationMinutes: bid.estimatedDurationMinutes === null ? '' : String(bid.estimatedDurationMinutes),
    validUntil: new Date(bid.validUntil),
    notes: bid.ownerNotes ?? '',
  };
}

/**
 * Only what changed goes on the wire (the schema refuses an empty patch): a cleared driver /
 * duration / notes is sent as `null`, the vehicle cannot change on a revision, and the same
 * `validUntil` is not resent.
 */
export function buildBidPatch(form: BidFormState, original: BidDto): PatchBidBody {
  const patch: PatchBidBody = {};
  const driver = form.driverProfileId || null;
  if (driver !== original.driverProfileId) patch.driverProfileId = driver;
  const base = money(form.baseAmount);
  if (base !== null && base !== original.baseAmount) patch.baseAmount = base;
  const extras = buildExtras(form.extras);
  const sameExtras =
    extras.length === original.extrasBreakdown.length &&
    extras.every((x, i) => {
      const o = original.extrasBreakdown[i];
      return o?.labelEn === x.labelEn && o.labelAr === x.labelAr && o.amount === x.amount;
    });
  if (!sameExtras) patch.extrasBreakdown = extras;
  const duration = form.estimatedDurationMinutes.trim() ? Number(form.estimatedDurationMinutes) : null;
  if (duration !== original.estimatedDurationMinutes) patch.estimatedDurationMinutes = duration;
  if (form.validUntil && form.validUntil.toISOString() !== new Date(original.validUntil).toISOString())
    patch.validUntil = form.validUntil.toISOString();
  const notes = form.notes.trim() || null;
  if (notes !== (original.ownerNotes ?? null)) patch.ownerNotes = notes;
  return patch;
}

/** Sum of the extras as typed, for the live preview only — the API's figure is the one shown after submit. */
export function previewExtrasTotal(extras: BidExtraForm[]): string {
  let cents = 0;
  for (const x of buildExtras(extras)) {
    const [int = '0', frac = '00'] = x.amount.split('.');
    cents += Number(int) * 100 + Number(frac);
  }
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
