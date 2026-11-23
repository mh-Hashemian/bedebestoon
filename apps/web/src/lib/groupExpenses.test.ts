import { describe, expect, it } from 'vitest';
import type { Expense } from '../api/types';
import { MockApiClient } from '../api/mockClient';
import {
  groupExpenses,
  groupMyNet,
  previewGroupPlan,
  groupPaidBy,
  groupPartyTotals,
  groupPlan,
  groupShareLabel,
  groupSharePerPerson,
  groupTotal,
} from './groupExpenses';

/**
 * A multi-payer group expense must read as ONE transaction: one card in
 * the dashboard, with the group total, who paid what, the per-person
 * share and my net — not two cards with the same title.
 *
 * The user's case: one person spent 50,000, the other 100,000.
 * Total 150,000, share 75,000 each. The 100,000-payer is owed 25,000,
 * the 50,000-payer owes 25,000 — one transfer of 25,000.
 */

const ME_ID = 'me-1';
const ALI_ID = 'user-ali';

function expense(over: Partial<Expense> & { payerName: string }): Expense {
  return {
    id: over.id ?? `exp-${Math.random()}`,
    title: over.title ?? 'تست چند پرداختی',
    totalAmount: over.totalAmount ?? 0,
    payerId: over.payerId ?? null,
    payerContactId: over.payerContactId ?? null,
    createdById: over.createdById ?? ME_ID,
    createdAt: over.createdAt ?? '2026-11-23T18:37:00.000Z',
    payer:
      over.payerId === ME_ID
        ? { id: ME_ID, firstName: 'محمد', lastName: null, username: null }
        : over.payerId
          ? { id: over.payerId, firstName: over.payerName, lastName: null, username: null }
          : null,
    payerContact:
      over.payerContactId !== undefined && over.payerContactId !== null
        ? { id: over.payerContactId, name: over.payerName, linkedUserId: null }
        : null,
    shares: over.shares ?? [],
  } as Expense;
}

/** Two-person group: me paid 50,000, علی (a user) paid 100,000. */
function twoPersonGroup(): Expense[] {
  const meShare = (amount: number, isPaid: boolean) => ({
    id: `s-me-${amount}-${isPaid}`,
    amount,
    isPaid,
    expenseId: '',
    userId: ME_ID,
    contactId: null,
    createdAt: '2026-11-23T18:37:00.000Z',
    user: { id: ME_ID, firstName: 'محمد', lastName: null, username: null },
    contact: null,
  });
  const aliShare = (amount: number, isPaid: boolean) => ({
    id: `s-ali-${amount}-${isPaid}`,
    amount,
    isPaid,
    expenseId: '',
    userId: ALI_ID,
    contactId: null,
    createdAt: '2026-11-23T18:37:00.000Z',
    user: { id: ALI_ID, firstName: 'علی', lastName: null, username: null },
    contact: null,
  });
  return [
    expense({
      id: 'e-me',
      totalAmount: 50000,
      payerId: ME_ID,
      payerName: 'محمد',
      shares: [meShare(25000, true), aliShare(25000, false)],
    }),
    expense({
      id: 'e-ali',
      totalAmount: 100000,
      payerId: ALI_ID,
      payerName: 'علی',
      shares: [meShare(50000, false), aliShare(50000, true)],
    }),
  ];
}

describe('groupExpenses', () => {
  it("groups the user's two-person case into one card with the right numbers", () => {
    const items = groupExpenses(twoPersonGroup());
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('group');
    const group = (items[0] as { expenses: Expense[] }).expenses;
    expect(groupTotal(group)).toBe(150000);
    expect(groupSharePerPerson(group, 'محمد')).toBe(75000);
    expect(groupShareLabel(group, 'محمد')).toBe(
      'سهم هر نفر: ۷۵٬۰۰۰ تومان',
    );
    // I paid 50,000 of a 75,000 share: I owe 25,000 net.
    expect(groupMyNet(group, ME_ID)).toBe(-25000);
    expect(groupPaidBy(group, 'محمد')).toEqual([
      { name: 'علی', amount: 100000 },
      { name: 'محمد', amount: 50000 },
    ]);
    expect(groupPartyTotals(group, 'محمد')).toEqual([
      { key: `user:${ALI_ID}`, name: 'علی', paid: 100000, share: 75000, balance: 25000 },
      { key: `user:${ME_ID}`, name: 'محمد', paid: 50000, share: 75000, balance: -25000 },
    ]);
    const plan = groupPlan(group, 'محمد');
    expect(plan.transfers).toEqual([
      { fromKey: `user:${ME_ID}`, toKey: `user:${ALI_ID}`, amount: 25000 },
    ]);
    expect(plan.totalAmount).toBe(25000);
  });

  it('leaves a lone expense alone', () => {
    const single = expense({
      id: 'e-single',
      title: 'ناهار',
      totalAmount: 300000,
      payerId: ME_ID,
      payerName: 'محمد',
      shares: [],
    });
    const items = groupExpenses([single, ...twoPersonGroup()]);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ kind: 'single', expense: single });
    expect(items[1].kind).toBe('group');
  });

  it('does not group two same-title expenses paid by the same person', () => {
    const first = expense({
      id: 'e-1',
      title: 'شام',
      totalAmount: 200000,
      payerId: ME_ID,
      payerName: 'محمد',
      createdAt: '2026-11-23T18:37:00.000Z',
      shares: [],
    });
    const second = expense({
      id: 'e-2',
      title: 'شام',
      totalAmount: 150000,
      payerId: ME_ID,
      payerName: 'محمد',
      createdAt: '2026-11-23T18:37:00.500Z',
      shares: [],
    });
    const items = groupExpenses([first, second]);
    expect(items).toHaveLength(2);
    expect(items.every((i) => i.kind === 'single')).toBe(true);
  });

  it('groups a real multi-payer creation from the mock client', async () => {
    const api = new MockApiClient();
    const me = await api.getMe();
    const contacts = await api.listContacts();
    const byName = (name: string) => {
      const c = contacts.find((x) => x.name === name);
      if (!c) throw new Error(`contact ${name} not found`);
      return c;
    };
    const ali = byName('علی رضایی');
    const sara = byName('سارا محمدی');
    const reza = byName('رضا کریمی');
    await api.createGroupExpense({
      title: 'سفر شمال',
      participants: [
        { userId: me.id },
        { contactId: ali.id },
        { contactId: sara.id },
        { contactId: reza.id },
      ],
      payers: [
        { userId: me.id, amount: 1000000 },
        { contactId: ali.id, amount: 2000000 },
        { contactId: sara.id, amount: 500000 },
      ],
    });
    const expenses = await api.listExpenses();
    const items = groupExpenses(expenses);
    // The three sub-expenses are one group; the two seeded demo expenses stay single.
    const groups = items.filter((i) => i.kind === 'group');
    expect(groups).toHaveLength(1);
    const group = (groups[0] as { expenses: Expense[] }).expenses;
    expect(group).toHaveLength(3);
    expect(groupTotal(group)).toBe(3500000);
    expect(groupSharePerPerson(group, me.firstName)).toBe(875000);
    expect(groupMyNet(group, me.id)).toBe(125000);
    expect(groupPlan(group, me.firstName).transfers).toHaveLength(3);
  });
});

describe('previewGroupPlan', () => {
  it("Mohammad's 2-person case: 50,000 + 100,000 -> one 25,000 transfer", () => {
    const plan = previewGroupPlan(['user:u1', 'user:u2'], [
      { key: 'user:u1', amount: 100000 },
      { key: 'user:u2', amount: 50000 },
    ]);
    expect(plan.totalAmount).toBe(25000);
    expect(plan.parties).toEqual([
      { key: 'user:u1', balance: 25000 },
      { key: 'user:u2', balance: -25000 },
    ]);
    expect(plan.transfers).toEqual([
      { fromKey: 'user:u2', toKey: 'user:u1', amount: 25000 },
    ]);
  });

  it('the 4-person case: 1M + 2M + 500K -> 3 transfers, share 875,000', () => {
    const plan = previewGroupPlan(
      ['user:me', 'contact:ali', 'contact:sara', 'contact:reza'],
      [
        { key: 'user:me', amount: 1000000 },
        { key: 'contact:ali', amount: 2000000 },
        { key: 'contact:sara', amount: 500000 },
      ],
    );
    expect(plan.totalAmount).toBe(1250000);
    expect(plan.parties).toEqual([
      { key: 'contact:ali', balance: 1125000 },
      { key: 'user:me', balance: 125000 },
      { key: 'contact:sara', balance: -375000 },
      { key: 'contact:reza', balance: -875000 },
    ]);
    expect(plan.transfers).toHaveLength(3);
  });

  it('all equal: no transfers', () => {
    const plan = previewGroupPlan(['user:u1', 'user:u2'], [
      { key: 'user:u1', amount: 50000 },
      { key: 'user:u2', amount: 50000 },
    ]);
    expect(plan.transfers).toEqual([]);
    expect(plan.totalAmount).toBe(0);
  });
});

describe('settleTransfer (mock)', () => {
  it("Mohammad's 2-person case: settle the 25,000 transfer, plan empties", async () => {
    const api = new MockApiClient();
    const me = await api.getMe();
    const contacts = await api.listContacts();
    const ali = contacts.find((c) => c.name.includes('علی')) ?? contacts[0];
    const created = await api.createGroupExpense({
      title: 'تست چند پرداختی',
      participants: [{ userId: me.id }, { contactId: ali.id }],
      payers: [
        { userId: me.id, amount: 100000 },
        { contactId: ali.id, amount: 50000 },
      ],
    });
    expect(created.plan.transfers).toEqual([
      // The mock's ali contact is linked to a user, so the plan resolves
      // him to his user key (same as the real server).
      {
        fromKey: 'user:' + (ali.linkedUserId ?? ali.id),
        toKey: 'user:' + me.id,
        amount: 25000,
      },
    ]);
    const res = await api.settleTransfer({
      fromKey: 'user:' + (ali.linkedUserId ?? ali.id),
      toKey: 'user:' + me.id,
      amount: 25000,
      expenseIds: created.expenses.map((e) => e.id),
    });
    expect(res.settledAmount).toBe(25000);
    expect(res.remainingAmount).toBe(0);
    // The plan recomputed from the stored shares is now empty.
    const expenses = await api.listExpenses();
    const group = groupExpenses(expenses).find((i) => i.kind === 'group');
    expect(group).toBeDefined();
    const plan = groupPlan(
      (group as { expenses: Expense[] }).expenses,
      me.firstName,
    );
    expect(plan.transfers).toEqual([]);
  });
});
