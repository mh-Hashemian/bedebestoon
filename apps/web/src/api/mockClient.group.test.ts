import { describe, expect, it } from 'vitest';
import { MockApiClient } from './mockClient';

/**
 * Multi-payer group expense («چندپرداخت‌کننده») in the demo/mock client:
 * the 4-person trip example — me paid 1,000,000, علی 2,000,000, سارا
 * 500,000, رضا nothing. Total 3,500,000, equal share 875,000 each.
 * Nets: me +125,000, علی +1,125,000, سارا −375,000, رضا −875,000.
 * Plan (3 transfers): رضا→علی 875,000؛ سارا→علی 250,000؛ سارا→من 125,000.
 */
describe('MockApiClient.createGroupExpense', () => {
  it('creates one expense per payer and returns the trip plan', async () => {
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

    const result = await api.createGroupExpense({
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

    expect(result.expenses).toHaveLength(3);
    expect(
      result.expenses.map((e) => e.totalAmount).sort((a, b) => a - b),
    ).toEqual([500000, 1000000, 2000000]);
    // علی is linked to a real user, so his party key is that user.
    expect(result.plan.transfers).toEqual([
      {
        fromKey: `contact:${reza.id}`,
        toKey: 'user:mock-user-ali',
        amount: 875000,
      },
      {
        fromKey: `contact:${sara.id}`,
        toKey: 'user:mock-user-ali',
        amount: 250000,
      },
      {
        fromKey: `contact:${sara.id}`,
        toKey: `user:${me.id}`,
        amount: 125000,
      },
    ]);
    expect(result.plan.totalAmount).toBe(1250000);
    expect(result.plan.parties).toEqual([
      { key: 'user:mock-user-ali', balance: 1125000 },
      { key: `user:${me.id}`, balance: 125000 },
      { key: `contact:${sara.id}`, balance: -375000 },
      { key: `contact:${reza.id}`, balance: -875000 },
    ]);

    // The sub-expenses are real expenses: they show up in the list and
    // move the balances. These are pairwise balances with me, and they
    // include the mock's two seeded demo expenses (lunch: علی and سارا
    // owe me 150,000 each; snap: I owe رضا 60,000). The trip moves them
    // by −250,000 / +125,000 / +250,000, to −100,000 / +275,000 /
    // +190,000 — summing (with the seeds) to my +125,000 trip net.
    const expenses = await api.listExpenses();
    expect(expenses.slice(0, 3).map((e) => e.title)).toEqual([
      'سفر شمال',
      'سفر شمال',
      'سفر شمال',
    ]);
    const balances = await api.getBalances();
    const byKey = new Map(balances.map((b) => [b.key, b.balance]));
    expect(byKey.get('user:mock-user-ali')).toBe(-100000);
    expect(byKey.get(`contact:${sara.id}`)).toBe(275000);
    expect(byKey.get(`contact:${reza.id}`)).toBe(190000);
  });

  it('throws when a payer is not one of the participants', async () => {
    const api = new MockApiClient();
    const me = await api.getMe();
    const contacts = await api.listContacts();
    const ali = contacts.find((c) => c.name === 'علی رضایی') as {
      id: string;
    };
    const sara = contacts.find((c) => c.name === 'سارا محمدی') as {
      id: string;
    };
    const reza = contacts.find((c) => c.name === 'رضا کریمی') as {
      id: string;
    };
    await expect(
      api.createGroupExpense({
        title: 'سفر شمال',
        participants: [{ userId: me.id }, { contactId: ali.id }],
        payers: [
          { userId: me.id, amount: 1000000 },
          { contactId: reza.id, amount: 500000 },
        ],
      }),
    ).rejects.toThrow('Each payer must be one of the participants');
    expect(sara).toBeDefined();
  });
});
