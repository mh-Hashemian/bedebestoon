import { describe, expect, it } from 'vitest';
import { computeSettlePlan } from './settlePlan';

describe('computeSettlePlan (mirrors the backend)', () => {
  it('the 4-person trip example: 3 transfers settle everyone', () => {
    // One paid 1,000,000, one 2,000,000, one 500,000, one nothing.
    // Fair share 875,000 each: nets +125,000 / +1,125,000 / -375,000 / -875,000.
    expect(
      computeSettlePlan([
        { key: 'A', balance: 125000 },
        { key: 'B', balance: 1125000 },
        { key: 'C', balance: -375000 },
        { key: 'D', balance: -875000 },
      ]),
    ).toEqual([
      { fromKey: 'D', toKey: 'B', amount: 875000 },
      { fromKey: 'C', toKey: 'B', amount: 250000 },
      { fromKey: 'C', toKey: 'A', amount: 125000 },
    ]);
  });

  it('already settled: no transfers', () => {
    expect(computeSettlePlan([])).toEqual([]);
    expect(
      computeSettlePlan([
        { key: 'A', balance: 0 },
        { key: 'B', balance: 0 },
      ]),
    ).toEqual([]);
  });

  it('two people: a single transfer', () => {
    expect(
      computeSettlePlan([
        { key: 'A', balance: 50000 },
        { key: 'B', balance: -50000 },
      ]),
    ).toEqual([{ fromKey: 'B', toKey: 'A', amount: 50000 }]);
  });

  it('zeroes every balance', () => {
    const parties = [
      { key: 'A', balance: 400000 },
      { key: 'B', balance: 250000 },
      { key: 'C', balance: -150000 },
      { key: 'D', balance: -200000 },
      { key: 'E', balance: -300000 },
    ];
    const transfers = computeSettlePlan(parties);
    expect(transfers.length).toBeLessThanOrEqual(parties.length - 1);
    const remaining = new Map(parties.map((p) => [p.key, p.balance]));
    for (const t of transfers) {
      remaining.set(t.fromKey, (remaining.get(t.fromKey) ?? 0) + t.amount);
      remaining.set(t.toKey, (remaining.get(t.toKey) ?? 0) - t.amount);
    }
    for (const v of remaining.values()) expect(v).toBe(0);
  });
});
