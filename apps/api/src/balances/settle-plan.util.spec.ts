import { computeSettlePlan } from './settle-plan.util';

/**
 * «تسویه گروهی» — greedy minimum-transaction plan.
 *
 * The example is Mohammad's own: 4 people on a trip, one paid 1,000,000,
 * one 2,000,000, one 500,000, one nothing. Total 3,500,000, fair share
 * 875,000 each, so the nets are +125,000 / +1,125,000 / -375,000 / -875,000
 * and the plan must be exactly 3 transfers.
 */
describe('computeSettlePlan', () => {
  it('the 4-person trip example: 3 transfers settle everyone', () => {
    const transfers = computeSettlePlan([
      { key: 'A', balance: 125000 }, // paid 1,000,000
      { key: 'B', balance: 1125000 }, // paid 2,000,000
      { key: 'C', balance: -375000 }, // paid 500,000
      { key: 'D', balance: -875000 }, // paid nothing
    ]);
    expect(transfers).toEqual([
      { fromKey: 'D', toKey: 'B', amount: 875000 },
      { fromKey: 'C', toKey: 'B', amount: 250000 },
      { fromKey: 'C', toKey: 'A', amount: 125000 },
    ]);
  });

  it('already settled: no transfers', () => {
    expect(
      computeSettlePlan([
        { key: 'A', balance: 0 },
        { key: 'B', balance: 0 },
      ]),
    ).toEqual([]);
    expect(computeSettlePlan([])).toEqual([]);
  });

  it('two people: a single transfer', () => {
    expect(
      computeSettlePlan([
        { key: 'A', balance: 50000 },
        { key: 'B', balance: -50000 },
      ]),
    ).toEqual([{ fromKey: 'B', toKey: 'A', amount: 50000 }]);
  });

  it('one creditor, many debtors: one transfer per debtor', () => {
    expect(
      computeSettlePlan([
        { key: 'A', balance: 300000 },
        { key: 'B', balance: -100000 },
        { key: 'C', balance: -200000 },
      ]),
    ).toEqual([
      { fromKey: 'C', toKey: 'A', amount: 200000 },
      { fromKey: 'B', toKey: 'A', amount: 100000 },
    ]);
  });

  it('one debtor, many creditors: one transfer per creditor', () => {
    expect(
      computeSettlePlan([
        { key: 'A', balance: 100000 },
        { key: 'B', balance: 200000 },
        { key: 'C', balance: -300000 },
      ]),
    ).toEqual([
      { fromKey: 'C', toKey: 'B', amount: 200000 },
      { fromKey: 'C', toKey: 'A', amount: 100000 },
    ]);
  });

  it('never exceeds n-1 transfers and zeroes every balance', () => {
    const parties = [
      { key: 'A', balance: 400000 },
      { key: 'B', balance: 250000 },
      { key: 'C', balance: -150000 },
      { key: 'D', balance: -200000 },
      { key: 'E', balance: -300000 },
    ];
    const transfers = computeSettlePlan(parties);
    expect(transfers.length).toBeLessThanOrEqual(parties.length - 1);
    // Apply the transfers: every net must end at zero.
    const remaining = new Map(parties.map((p) => [p.key, p.balance]));
    for (const t of transfers) {
      remaining.set(t.fromKey, (remaining.get(t.fromKey) ?? 0) + t.amount);
      remaining.set(t.toKey, (remaining.get(t.toKey) ?? 0) - t.amount);
    }
    for (const v of remaining.values()) expect(v).toBe(0);
  });

  it('does not mutate its input', () => {
    const parties = [
      { key: 'A', balance: 100000 },
      { key: 'B', balance: -100000 },
    ];
    computeSettlePlan(parties);
    expect(parties).toEqual([
      { key: 'A', balance: 100000 },
      { key: 'B', balance: -100000 },
    ]);
  });
});
