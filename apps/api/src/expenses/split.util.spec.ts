import { equalSplit, isValidCustomSplit } from './split.util';

describe('equalSplit (Addendum v1.1 remainder rule)', () => {
  it('splits 100000 among 3 as 33334 / 33333 / 33333 — remainder goes to the FIRST participant', () => {
    expect(equalSplit(100000, 3)).toEqual([33334, 33333, 33333]);
  });

  it('splits evenly when there is no remainder', () => {
    expect(equalSplit(90000, 3)).toEqual([30000, 30000, 30000]);
  });

  it('distributes a multi-Toman remainder in list order', () => {
    expect(equalSplit(10, 4)).toEqual([3, 3, 2, 2]);
    expect(equalSplit(101, 4)).toEqual([26, 25, 25, 25]);
  });

  it('handles a single participant', () => {
    expect(equalSplit(50000, 1)).toEqual([50000]);
  });

  it('always sums back to the total', () => {
    for (const [total, parts] of [
      [1, 3],
      [7, 2],
      [999_999, 7],
      [123_456, 5],
    ] as const) {
      const shares = equalSplit(total, parts);
      expect(shares).toHaveLength(parts);
      expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it('rejects a non-positive participant count', () => {
    expect(() => equalSplit(1000, 0)).toThrow();
  });
});

describe('isValidCustomSplit', () => {
  it('accepts amounts that sum exactly to the total', () => {
    expect(isValidCustomSplit(100000, [60000, 40000])).toBe(true);
    expect(isValidCustomSplit(100000, [100000])).toBe(true);
    expect(isValidCustomSplit(100000, [70000, 30000, 0])).toBe(true);
  });

  it('rejects amounts that do not sum to the total', () => {
    expect(isValidCustomSplit(100000, [60000, 30000])).toBe(false);
    expect(isValidCustomSplit(100000, [60000, 40001])).toBe(false);
  });

  it('rejects negative or non-integer amounts and empty lists', () => {
    expect(isValidCustomSplit(100000, [120000, -20000])).toBe(false);
    expect(isValidCustomSplit(100000, [50000.5, 49999.5])).toBe(false);
    expect(isValidCustomSplit(100000, [])).toBe(false);
  });
});
