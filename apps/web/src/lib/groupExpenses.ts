import type { Expense } from '../api/types';
import { formatToman } from './format';
import {
  myNetForExpense,
  payerDisplayName,
  payerPartyKey,
  shareDisplayName,
  sharePartyKey,
} from './parties';
import { computeSettlePlan } from './settlePlan';

/**
 * One row in the dashboard transaction list: a lone expense, or the
 * sub-expenses of one multi-payer («چندپرداخت‌کننده») creation shown as
 * a single card. The sub-expenses are stored as separate expenses (one
 * per payer, the Tricount model), but the user thinks of them as one
 * group expense — two cards with the same title are confusing.
 */

export type TransactionItem =
  | { kind: 'single'; expense: Expense }
  | { kind: 'group'; expenses: Expense[] };

/** Sub-expenses of one creation land within the same moment (one DB transaction, so one createdAt; the mock sets them milliseconds apart). */
const GROUP_WINDOW_MS = 2000;

function participantKeySet(expense: Expense): string {
  return expense.shares
    .map((s) => sharePartyKey(s))
    .filter((k): k is string => !!k)
    .sort()
    .join('|');
}

function timeOf(expense: Expense): number {
  return new Date(expense.createdAt).getTime();
}

/**
 * Group the sub-expenses of one multi-payer creation into a single item.
 * They share the title, creator and creation moment, the same
 * participants, and each has a different payer. A lone expense never
 * groups; two unrelated expenses with the same title in the same moment
 * stay separate because they share a payer (and usually participants).
 */
export function groupExpenses(expenses: Expense[]): TransactionItem[] {
  const groups: { expenses: Expense[]; createdAtMs: number }[] = [];
  for (const expense of expenses) {
    const t = timeOf(expense);
    const pKey = payerPartyKey(expense);
    const pSet = participantKeySet(expense);
    const target = groups.find(
      (g) =>
        g.expenses[0].title === expense.title &&
        g.expenses[0].createdById === expense.createdById &&
        Math.abs(g.createdAtMs - t) <= GROUP_WINDOW_MS &&
        participantKeySet(g.expenses[0]) === pSet &&
        pKey !== null &&
        !g.expenses.some((e) => payerPartyKey(e) === pKey),
    );
    if (target) target.expenses.push(expense);
    else groups.push({ expenses: [expense], createdAtMs: t });
  }
  return groups.map((g) =>
    g.expenses.length >= 2
      ? { kind: 'group', expenses: g.expenses }
      : { kind: 'single', expense: g.expenses[0] },
  );
}

/** Sum of the sub-expense totals — the group's total amount. */
export function groupTotal(expenses: Expense[]): number {
  return expenses.reduce((sum, e) => sum + e.totalAmount, 0);
}

export interface GroupPartyTotal {
  key: string;
  name: string;
  paid: number;
  share: number;
  /** paid − share. Positive: this party is owed money. Negative: this party owes money. */
  balance: number;
}

/** Per-party totals for a group: what each person paid, their share, and their net. Highest net first. */
export function groupPartyTotals(
  expenses: Expense[],
  myName: string,
): GroupPartyTotal[] {
  const byKey = new Map<
    string,
    { name: string; paid: number; share: number }
  >();
  const ensure = (key: string, name: string) => {
    if (!byKey.has(key)) byKey.set(key, { name, paid: 0, share: 0 });
    return byKey.get(key)!;
  };
  for (const expense of expenses) {
    const pKey = payerPartyKey(expense);
    if (pKey) {
      ensure(pKey, payerDisplayName(expense, myName)).paid +=
        expense.totalAmount;
    }
    for (const share of expense.shares) {
      const dKey = sharePartyKey(share);
      if (!dKey) continue;
      ensure(dKey, shareDisplayName(share, myName)).share += share.amount;
    }
  }
  return [...byKey.entries()]
    .map(([key, row]) => ({ key, ...row, balance: row.paid - row.share }))
    .sort((a, b) => b.balance - a.balance);
}

/** My outstanding net for the whole group (sum of the sub-expense nets). */
export function groupMyNet(expenses: Expense[], myUserId: string): number {
  return expenses.reduce((sum, e) => sum + myNetForExpense(e, myUserId), 0);
}

/**
 * The per-person share of the group total, when every party's share is
 * equal (the normal case — each sub-expense splits equally). Null when
 * the shares differ (rounding remainders), so the caller can show an
 * approximate figure instead.
 */
export function groupSharePerPerson(
  expenses: Expense[],
  myName: string,
): number | null {
  const totals = groupPartyTotals(expenses, myName);
  if (totals.length === 0) return null;
  const first = totals[0].share;
  return totals.every((t) => t.share === first) ? first : null;
}

/** "سهم هر نفر: X" for a group card — the exact share, or an approximate one when remainders split unevenly. */
export function groupShareLabel(
  expenses: Expense[],
  myName: string,
): string {
  const exact = groupSharePerPerson(expenses, myName);
  if (exact !== null) return `سهم هر نفر: ${formatToman(exact)}`;
  const parties = groupPartyTotals(expenses, myName);
  if (parties.length === 0) return '';
  const avg = Math.round(groupTotal(expenses) / parties.length);
  return `سهم هر نفر: حدود ${formatToman(avg)}`;
}

/** "Name: amount" per payer, largest first, for the group card. */
export function groupPaidBy(
  expenses: Expense[],
  myName: string,
): { name: string; amount: number }[] {
  const rows = expenses.map((e) => ({
    name: payerDisplayName(e, myName),
    amount: e.totalAmount,
  }));
  rows.sort((a, b) => b.amount - a.amount);
  return rows;
}

/** Minimum-transaction settlement plan for the group, recomputed from the stored sub-expenses. */
export function groupPlan(expenses: Expense[], myName: string) {
  const parties = groupPartyTotals(expenses, myName).map((t) => ({
    key: t.key,
    balance: t.balance,
  }));
  const transfers = computeSettlePlan(parties);
  return {
    parties,
    transfers,
    totalAmount: transfers.reduce((sum, t) => sum + t.amount, 0),
  };
}
