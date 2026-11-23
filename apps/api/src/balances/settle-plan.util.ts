/**
 * «تسویه گروهی» — the minimum-transaction settlement plan for a group.
 *
 * Given each party's net balance across the group's open shares
 * (positive = is owed money, negative = owes money, all nets sum to zero),
 * this greedily matches the largest debtor with the largest creditor until
 * everyone is at zero. That is the standard Splitwise-style simplification:
 * it always finishes in at most (n - 1) transfers, and each transfer is as
 * large as possible, so no smaller plan exists with fewer transfers in the
 * greedy sense. The truly optimal (fewest-transfers) problem is NP-hard in
 * general; greedy is the accepted approach and is exact for the common
 * cases (including the 4-person trip example in the spec).
 *
 * Pure function: no database access, so it is unit-testable on its own.
 * The frontend (apps/web/src/lib/settlePlan.ts) carries a mirror copy for
 * the demo/mock client — keep the two in sync.
 */

export interface NetEntry {
  key: string;
  /** Positive: this party is owed money. Negative: this party owes money. */
  balance: number;
}

export interface PlanTransfer {
  /** Debtor. */
  fromKey: string;
  /** Creditor. */
  toKey: string;
  amount: number;
}

export function computeSettlePlan(parties: NetEntry[]): PlanTransfer[] {
  const creditors = parties
    .filter((p) => p.balance > 0)
    .map((p) => ({ ...p }))
    .sort((a, b) => b.balance - a.balance);
  const debtors = parties
    .filter((p) => p.balance < 0)
    .map((p) => ({ ...p }))
    .sort((a, b) => a.balance - b.balance); // most negative first

  const transfers: PlanTransfer[] = [];
  let i = 0;
  let j = 0;
  while (i < creditors.length && j < debtors.length) {
    const creditor = creditors[i];
    const debtor = debtors[j];
    const amount = Math.min(creditor.balance, -debtor.balance);
    transfers.push({ fromKey: debtor.key, toKey: creditor.key, amount });
    creditor.balance -= amount;
    debtor.balance += amount;
    if (creditor.balance === 0) i++;
    if (debtor.balance === 0) j++;
  }
  return transfers;
}
