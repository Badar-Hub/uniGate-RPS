import { describe, expect, it } from 'vitest';
import type { BidDto, MoneyString, RateString } from '@unigate/types';
import {
  bidFormFromBid,
  buildBidBody,
  buildBidPatch,
  buildExtras,
  EMPTY_BID_FORM,
  money,
  newExtra,
  previewExtrasTotal,
  validateBidForm,
  type BidFormState,
} from './bid-body';

const m = (v: string) => v as MoneyString;
const rate = (v: string) => v as RateString;

const bid: BidDto = {
  id: 'b1',
  bidNumber: 'BID-1',
  tripRequestId: 'r1',
  requestNumber: 'REQ-1',
  ownerProfileId: 'o1',
  ownerName: 'Owner',
  ownerRatingAvg: '4.50',
  vehicle: { id: 'v1', plateNumberEn: '1234 ABC', description: 'Toyota Hiace 2022', categoryCode: 'VAN', passengerCapacity: 12, payloadCapacityKg: null, ratingAvg: '4.00' },
  driverProfileId: 'd1',
  driverName: 'Driver',
  baseAmount: m('1000.00'),
  extrasAmount: m('50.00'),
  extrasBreakdown: [{ labelEn: 'Tolls', labelAr: 'رسوم', amount: m('50.00') }],
  vatRate: rate('0.15'),
  vatAmount: m('157.50'),
  totalAmount: m('1207.50'),
  currency: 'SAR',
  estimatedArrivalAt: null,
  estimatedDurationMinutes: 120,
  validUntil: '2030-01-01T10:00:00.000Z',
  ownerNotes: 'note',
  status: 'SUBMITTED',
  version: 1,
  lastRevisedAt: null,
  rejectedReason: null,
  submittedAt: '2029-12-01T00:00:00.000Z',
  decidedAt: null,
  bookingId: null,
  effectiveCommission: null,
  createdAt: '2029-12-01T00:00:00.000Z',
  updatedAt: '2029-12-01T00:00:00.000Z',
};

describe('money', () => {
  it('normalises to two fraction digits without floating point', () => {
    expect(money('1250')).toBe('1250.00');
    expect(money('12.5')).toBe('12.50');
    expect(money(' 0.10 ')).toBe('0.10');
    expect(money('007')).toBe('7.00');
    expect(money('1,250')).toBeNull();
    expect(money('12.345')).toBeNull();
    expect(money('-5')).toBeNull();
    expect(money('')).toBeNull();
  });
});

describe('buildBidBody', () => {
  it('sends only the fields the owner filled, as the web bid form does', () => {
    const form: BidFormState = { ...EMPTY_BID_FORM, vehicleId: 'v1', baseAmount: '1250' };
    expect(buildBidBody('r1', form)).toEqual({ tripRequestId: 'r1', vehicleId: 'v1', baseAmount: '1250.00', extrasBreakdown: [] });
  });

  it('carries driver, extras, duration, validity and notes when set; never a total', () => {
    const form: BidFormState = {
      vehicleId: 'v1',
      driverProfileId: 'd1',
      baseAmount: '1000',
      extras: [
        { ...newExtra(), labelEn: 'Tolls', labelAr: '', amount: '50' },
        { ...newExtra(), labelEn: '', labelAr: '', amount: '' },
      ],
      estimatedDurationMinutes: '90',
      validUntil: new Date('2030-01-01T10:00:00.000Z'),
      notes: '  Includes waiting time ',
    };
    const body = buildBidBody('r1', form);
    expect(body).toEqual({
      tripRequestId: 'r1',
      vehicleId: 'v1',
      driverProfileId: 'd1',
      baseAmount: '1000.00',
      extrasBreakdown: [{ labelEn: 'Tolls', labelAr: 'Tolls', amount: '50.00' }],
      estimatedDurationMinutes: 90,
      validUntil: '2030-01-01T10:00:00.000Z',
      ownerNotes: 'Includes waiting time',
    });
    expect('totalAmount' in body).toBe(false);
  });
});

describe('validateBidForm', () => {
  it('requires a vehicle and a positive base amount', () => {
    expect(validateBidForm(EMPTY_BID_FORM)).toEqual({ vehicleId: 'bidForm.errors.vehicleRequired', baseAmount: 'bidForm.errors.baseInvalid' });
    expect(validateBidForm({ ...EMPTY_BID_FORM, vehicleId: 'v1', baseAmount: '0' })).toEqual({ baseAmount: 'bidForm.errors.baseInvalid' });
    expect(validateBidForm({ ...EMPTY_BID_FORM, vehicleId: 'v1', baseAmount: '10' })).toEqual({});
  });

  it('flags extras without a label or with a bad amount, and too many extras', () => {
    const ok: BidFormState = { ...EMPTY_BID_FORM, vehicleId: 'v1', baseAmount: '10' };
    expect(validateBidForm({ ...ok, extras: [{ ...newExtra(), labelEn: '', labelAr: '', amount: '5' }] })).toEqual({ 'extrasBreakdown.0.labelEn': 'bidForm.errors.extraLabelRequired' });
    expect(validateBidForm({ ...ok, extras: [{ ...newExtra(), labelEn: 'X', labelAr: '', amount: 'abc' }] })).toEqual({ 'extrasBreakdown.0.amount': 'bidForm.errors.extraAmountInvalid' });
    expect(validateBidForm({ ...ok, extras: Array.from({ length: 21 }, () => ({ ...newExtra(), labelEn: 'X', labelAr: '', amount: '1' })) })).toEqual({ extrasBreakdown: 'bidForm.errors.tooManyExtras' });
  });

  it('checks the duration range and the validity window against the request deadline', () => {
    const ok: BidFormState = { ...EMPTY_BID_FORM, vehicleId: 'v1', baseAmount: '10' };
    expect(validateBidForm({ ...ok, estimatedDurationMinutes: '0' })).toEqual({ estimatedDurationMinutes: 'bidForm.errors.durationInvalid' });
    expect(validateBidForm({ ...ok, estimatedDurationMinutes: '1.5' })).toEqual({ estimatedDurationMinutes: 'bidForm.errors.durationInvalid' });
    expect(validateBidForm({ ...ok, validUntil: new Date(Date.now() - 1000) })).toEqual({ validUntil: 'bidForm.errors.validUntilPast' });
    const future = new Date(Date.now() + 48 * 3600 * 1000);
    expect(validateBidForm({ ...ok, validUntil: future }, { deadline: new Date(Date.now() + 3600 * 1000).toISOString() })).toEqual({ validUntil: 'bidForm.errors.validUntilAfterDeadline' });
    expect(validateBidForm({ ...ok, validUntil: future }, { deadline: new Date(Date.now() + 72 * 3600 * 1000).toISOString() })).toEqual({});
  });
});

describe('buildExtras / previewExtrasTotal', () => {
  it('drops blank rows, copies a missing label and sums in cents', () => {
    const extras = [
      { ...newExtra(), labelEn: 'A', labelAr: '', amount: '10.5' },
      { ...newExtra(), labelEn: '', labelAr: 'ب', amount: '0.25' },
      { ...newExtra(), labelEn: '', labelAr: '', amount: '' },
    ];
    expect(buildExtras(extras)).toEqual([
      { labelEn: 'A', labelAr: 'A', amount: '10.50' },
      { labelEn: 'ب', labelAr: 'ب', amount: '0.25' },
    ]);
    expect(previewExtrasTotal(extras)).toBe('10.75');
    expect(previewExtrasTotal([])).toBe('0.00');
  });
});

describe('bidFormFromBid / buildBidPatch', () => {
  it('round-trips a bid into a form with no changes → empty patch', () => {
    const form = bidFormFromBid(bid);
    expect(form.baseAmount).toBe('1000.00');
    expect(form.extras).toHaveLength(1);
    expect(buildBidPatch(form, bid)).toEqual({});
  });

  it('sends only the changed fields; clears go as null; the vehicle never changes', () => {
    const form = bidFormFromBid(bid);
    const patch = buildBidPatch(
      { ...form, baseAmount: '1100', driverProfileId: '', estimatedDurationMinutes: '', notes: '', extras: [], validUntil: new Date('2030-01-02T10:00:00.000Z') },
      bid,
    );
    expect(patch).toEqual({
      driverProfileId: null,
      baseAmount: '1100.00',
      extrasBreakdown: [],
      estimatedDurationMinutes: null,
      validUntil: '2030-01-02T10:00:00.000Z',
      ownerNotes: null,
    });
    expect('vehicleId' in patch).toBe(false);
  });
});
