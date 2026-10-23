import { describe, expect, it } from 'vitest';
import { equalSplit, isValidCustomSplit, sumAmounts } from './split';
import { parseAmountInput as parseFromFormat } from './format';

describe('equalSplit (mirrors the backend remainder rule)', () => {
  it('gives the +1 Toman remainder to the FIRST participants', () => {
    // The canonical case from Addendum v1.1.
    expect(equalSplit(100000, 3)).toEqual([33334, 33333, 33333]);
  });

  it('splits evenly when divisible', () => {
    expect(equalSplit(600000, 5)).toEqual([
      120000, 120000, 120000, 120000, 120000,
    ]);
  });

  it('handles multiple remainder Tomans in order', () => {
    expect(equalSplit(10, 4)).toEqual([3, 3, 2, 2]);
  });

  it('always sums back to the total', () => {
    for (const [total, n] of [
      [1, 3],
      [99991, 7],
      [123456, 11],
    ] as const) {
      expect(equalSplit(total, n).reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it('throws for zero participants (the UI guards this case)', () => {
    expect(() => equalSplit(1000, 0)).toThrow('parts must be a positive integer');
  });
});

describe('custom split validation', () => {
  it('accepts amounts that sum exactly to the total (zero = unpaid guest)', () => {
    expect(isValidCustomSplit(600000, [200000, 250000, 150000])).toBe(true);
    expect(isValidCustomSplit(100, [100, 0])).toBe(true);
  });

  it('rejects under- and over-sums', () => {
    expect(isValidCustomSplit(100, [40, 40])).toBe(false);
    expect(isValidCustomSplit(100, [60, 60])).toBe(false);
  });

  it('sumAmounts adds integer amounts', () => {
    expect(sumAmounts([1, 2, 3])).toBe(6);
    expect(sumAmounts([])).toBe(0);
  });
});

describe('parseAmountInput', () => {
  it('accepts Persian digits and thousand separators', () => {
    expect(parseFromFormat('۱۲۳٬۴۵۶')).toBe(123456);
    expect(parseFromFormat('600,000')).toBe(600000);
  });

  it('returns 0 for empty or invalid input', () => {
    expect(parseFromFormat('')).toBe(0);
    expect(parseFromFormat('abc')).toBe(0);
    expect(parseFromFormat('۵۰')).toBe(50);
  });
});
