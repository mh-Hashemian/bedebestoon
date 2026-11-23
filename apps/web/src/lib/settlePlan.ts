/**
 * «تسویه گروهی» — the minimum-transaction settlement plan for a group.
 *
 * Mirror of the backend (apps/api/src/balances/settle-plan.util.ts); used
 * by the demo/mock client so ?mock=1 behaves like the real API. Keep the
 * two in sync. See the backend file for the full explanation.
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
