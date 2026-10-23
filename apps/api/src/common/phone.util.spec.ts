import { normalizeIranianPhone } from './phone.util';

describe('normalizeIranianPhone', () => {
  const expected = '+989123456789';

  it.each([
    ['09123456789', 'trunk 0 format'],
    ['9123456789', 'bare national format'],
    ['+989123456789', 'E.164 format'],
    ['989123456789', 'country code without plus'],
    ['00989123456789', 'international 00 format'],
    ['+98 912 345 6789', 'spaces are ignored'],
    ['0912-345-67-89', 'dashes are ignored'],
  ])('normalizes %s (%s)', (input) => {
    expect(normalizeIranianPhone(input)).toBe(expected);
  });

  it.each([
    ['02123456789', 'Tehran landline is not a mobile'],
    ['12345', 'too short'],
    ['0912345678', '9 digits after trunk — too short'],
    ['091234567890', 'too long'],
    ['+14155552671', 'non-Iranian number'],
    ['not-a-number', 'garbage'],
    ['', 'empty string'],
  ])('returns null for %s (%s)', (input) => {
    expect(normalizeIranianPhone(input)).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(normalizeIranianPhone(null)).toBeNull();
    expect(normalizeIranianPhone(undefined)).toBeNull();
  });
});
