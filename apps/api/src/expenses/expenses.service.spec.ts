import { ExpensesService } from './expenses.service';

/**
 * removeExpense authorization rules, tested against a mocked
 * PrismaService — no live database is required.
 */
describe('ExpensesService.removeExpense', () => {
  function makeService(found: { id: string; createdById: string } | null) {
    const prismaMock = {
      expense: {
        findUnique: jest.fn().mockResolvedValue(found),
        delete: jest.fn().mockResolvedValue(found),
      },
    };
    const service = new ExpensesService(prismaMock as never);
    return { service, prismaMock };
  }

  it('deletes an expense created by the caller (shares cascade)', async () => {
    const { service, prismaMock } = makeService({
      id: 'e1',
      createdById: 'u1',
    });
    await service.removeExpense('u1', 'e1');
    expect(prismaMock.expense.delete).toHaveBeenCalledWith({
      where: { id: 'e1' },
    });
  });

  it('throws 404 for an unknown expense', async () => {
    const { service, prismaMock } = makeService(null);
    await expect(service.removeExpense('u1', 'nope')).rejects.toThrow(
      'Expense not found',
    );
    expect(prismaMock.expense.delete).not.toHaveBeenCalled();
  });

  it("throws 403 for someone else's expense", async () => {
    const { service, prismaMock } = makeService({
      id: 'e1',
      createdById: 'someone-else',
    });
    await expect(service.removeExpense('u1', 'e1')).rejects.toThrow(
      'Only the creator',
    );
    expect(prismaMock.expense.delete).not.toHaveBeenCalled();
  });

  it('notifies the other involved users after a delete', async () => {
    const found = {
      id: 'e1',
      createdById: 'u1',
      title: 'ناهار',
      totalAmount: 90000,
      payerId: 'u1',
      payerContact: null,
      shares: [
        { userId: 'u2', contact: null },
        { userId: null, contact: { linkedUserId: 'u3' } },
        { userId: 'u1', contact: null },
      ],
    };
    const prismaMock = {
      expense: {
        findUnique: jest.fn().mockResolvedValue(found),
        delete: jest.fn().mockResolvedValue(found),
      },
    };
    const notify = {
      notifyUser: jest.fn().mockResolvedValue(undefined),
      nameOf: jest.fn().mockResolvedValue('محمد'),
    };
    const service = new ExpensesService(
      prismaMock as never,
      notify as never,
    );
    await service.removeExpense('u1', 'e1');
    // the payer-shareholder u2 and the linked contact's user u3; not u1
    expect(notify.notifyUser).toHaveBeenCalledTimes(2);
    expect(notify.notifyUser).toHaveBeenCalledWith(
      'u2',
      expect.stringContaining('حذف کرد'),
    );
    expect(notify.notifyUser).toHaveBeenCalledWith(
      'u3',
      expect.stringContaining('ناهار'),
    );
  });
});

/**
 * Multi-payer group expense («چندپرداخت‌کننده»), tested against a mocked
 * PrismaService — no live database is required.
 *
 * The trip example: 4 people, A (the creator, u1) paid 1,000,000, B (c1,
 * linked to u2) paid 2,000,000, C (c2) paid 500,000, D (c3) paid nothing.
 * Total 3,500,000, equal share 875,000 each. Nets: u1 +125,000, u2
 * +1,125,000, c2 −375,000, c3 −875,000. Plan (3 transfers): c3→u2
 * 875,000; c2→u2 250,000; c2→u1 125,000.
 */
describe('ExpensesService.createGroupExpense', () => {
  const creator = { id: 'u1', firstName: 'محمد', lastName: null };
  const contacts = [
    { id: 'c1', linkedUserId: 'u2' },
    { id: 'c2', linkedUserId: null },
    { id: 'c3', linkedUserId: null },
  ];
  const participants = [
    { userId: 'u1' },
    { contactId: 'c1' },
    { contactId: 'c2' },
    { contactId: 'c3' },
  ];
  const payers = [
    { userId: 'u1', amount: 1000000 },
    { contactId: 'c1', amount: 2000000 },
    { contactId: 'c2', amount: 500000 },
  ];

  function makeService(notify?: { notifyUser: jest.Mock; nameOf: jest.Mock }) {
    const txCreate = jest
      .fn()
      .mockImplementation(async (args: { data: Record<string, unknown> }) => ({
        id: `exp-${txCreate.mock.calls.length + 1}`,
        ...args.data,
      }));
    const prismaMock = {
      contact: {
        findMany: jest.fn().mockResolvedValue(contacts),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ expense: { create: txCreate } }),
      ),
    };
    const service = new ExpensesService(
      prismaMock as never,
      (notify as never) ?? undefined,
    );
    return { service, prismaMock, txCreate };
  }

  it('creates one expense per payer and returns the trip plan', async () => {
    const { service, txCreate } = makeService();
    const result = await service.createGroupExpense(creator as never, {
      title: 'سفر شمال',
      participants,
      payers,
    });

    // Three sub-expenses, one per payer, in a single transaction.
    expect(txCreate).toHaveBeenCalledTimes(3);
    const totals = txCreate.mock.calls.map(
      (c) => (c[0].data as { totalAmount: number }).totalAmount,
    );
    expect(totals).toEqual([1000000, 2000000, 500000]);
    // Each sub-expense is split equally among all four participants.
    for (const call of txCreate.mock.calls) {
      const data = call[0].data as {
        shares: { create: { amount: number }[] };
      };
      const amounts = data.shares.create.map((s) => s.amount);
      const total = (call[0].data as { totalAmount: number }).totalAmount;
      expect(amounts.reduce((a, b) => a + b, 0)).toBe(total);
      expect(amounts.length).toBe(4);
    }
    expect(result.expenses).toHaveLength(3);

    // The trip plan: the exact 3 transfers of the example.
    expect(result.plan.transfers).toEqual([
      { fromKey: 'contact:c3', toKey: 'user:u2', amount: 875000 },
      { fromKey: 'contact:c2', toKey: 'user:u2', amount: 250000 },
      { fromKey: 'contact:c2', toKey: 'user:u1', amount: 125000 },
    ]);
    expect(result.plan.totalAmount).toBe(1250000);
    expect(result.plan.parties).toEqual([
      { key: 'user:u2', balance: 1125000 },
      { key: 'user:u1', balance: 125000 },
      { key: 'contact:c2', balance: -375000 },
      { key: 'contact:c3', balance: -875000 },
    ]);
  });

  it('throws when a payer is not one of the participants', async () => {
    const { service } = makeService();
    // c3 is a known contact (so contact resolution passes) but is NOT in
    // this trip's participant list — so they cannot be a payer here.
    await expect(
      service.createGroupExpense(creator as never, {
        title: 'سفر شمال',
        participants: [
          { userId: 'u1' },
          { contactId: 'c1' },
          { contactId: 'c2' },
        ],
        payers: [
          { userId: 'u1', amount: 1000000 },
          { contactId: 'c3', amount: 500000 },
        ],
      }),
    ).rejects.toThrow('Each payer must be one of the participants');
  });

  it('notifies each registered participant once (not per sub-expense)', async () => {
    const notify = {
      notifyUser: jest.fn().mockResolvedValue(undefined),
      nameOf: jest.fn().mockResolvedValue('محمد'),
    };
    const { service } = makeService(notify);
    await service.createGroupExpense(creator as never, {
      title: 'سفر شمال',
      participants,
      payers,
    });
    // Only u2 is a registered non-creator participant (c1 is linked to u2);
    // c2 and c3 are unlinked contacts with no Telegram user.
    expect(notify.notifyUser).toHaveBeenCalledTimes(1);
    expect(notify.notifyUser).toHaveBeenCalledWith(
      'u2',
      expect.stringContaining('سفر شمال'),
    );
    expect(notify.notifyUser).toHaveBeenCalledWith(
      'u2',
      expect.stringContaining('سهم تو'),
    );
  });
});
