import { describe, expect, it } from 'vitest';
import { ksaVatNumber, moneyString, nationalAddress, rateString } from './primitives.js';

describe('money & rate primitives', () => {
  it('accepts fixed-2dp strings and rejects numbers', () => {
    expect(moneyString.safeParse('1437.50').success).toBe(true);
    expect(moneyString.safeParse('-12.00').success).toBe(true);
    expect(moneyString.safeParse('1437.5').success).toBe(false);
    expect(moneyString.safeParse('1,437.50').success).toBe(false);
    expect(moneyString.safeParse(1437.5).success).toBe(false);
  });
  it('rates are 4dp fractions', () => {
    expect(rateString.safeParse('0.1500').success).toBe(true);
    expect(rateString.safeParse('15').success).toBe(false);
    expect(rateString.safeParse('0.15').success).toBe(false);
  });
});

describe('KSA identifiers', () => {
  it('VAT number is 15 digits starting and ending with 3', () => {
    expect(ksaVatNumber.safeParse('300000000000003').success).toBe(true);
    expect(ksaVatNumber.safeParse('310000000000001').success).toBe(false);
    expect(ksaVatNumber.safeParse('30000000000003').success).toBe(false);
  });
  it('national address enforces field shapes', () => {
    const ok = nationalAddress.safeParse({
      buildingNumber: '3141', streetEn: 'Anas Bin Malik', streetAr: 'أنس بن مالك',
      districtEn: 'Al Malqa', districtAr: 'الملقا', cityId: '0192f3c1-7a4e-7b2d-9f10-5c3ab9e42d77',
      postalCode: '13521', additionalNumber: '1234', shortCode: 'RHAA1234',
    });
    expect(ok.success).toBe(true);
    expect(nationalAddress.safeParse({ ...ok.data, postalCode: '1352' }).success).toBe(false);
  });
});
