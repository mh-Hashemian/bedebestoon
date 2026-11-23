import { BalancesService } from './balances.service';

/**
 * settleShare / unsettleShare involvement rules, tested against a mocked
 * PrismaService — no live database is required.
 */
describe('BalancesService settle/unsettle', () => {
  function makeService(share: Record<string, unknown> | null) {
    const prismaMock = {
      expenseShare: {
        findUnique: jest.fn().mockResolvedValue(share),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ ...(share ?? {}), ...data }),
        ),
      },
    };
    const service = new BalancesService(prismaMock as never);
    return { service, prismaMock };
  }

  function shareWith(overrides: Record<string, unknown> = {}) {
    return {
      id: 's1',
      isPaid: false,
      userId: 'debtor-1',
      contact: null,
      expense: {
        payerId: 'u1',
        createdById: 'u1',
        payerContact: null,
      },
      ...overrides,
    };
  }

  it('settle: the payer can settle an unpaid share', async () => {
    const { service, prismaMock } = makeService(shareWith());
    await service.settleShare('u1', 's1');
    expect(prismaMock.expenseShare.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { isPaid: true },
    });
  });

  it('settle: a stranger is forbidden', async () => {
    const { service, prismaMock } = makeService(shareWith());
    await expect(service.settleShare('stranger', 's1')).rejects.toThrow(
      'Only a participant or the payer',
    );
    expect(prismaMock.expenseShare.update).not.toHaveBeenCalled();
  });

  it('unsettle: an involved user can undo a settled share', async () => {
    const { service, prismaMock } = makeService(shareWith({ isPaid: true }));
    await service.unsettleShare('u1', 's1');
    expect(prismaMock.expenseShare.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { isPaid: false },
    });
  });

  it('unsettle: idempotent when the share is not settled', async () => {
    const { service, prismaMock } = makeService(shareWith({ isPaid: false }));
    await service.unsettleShare('u1', 's1');
    expect(prismaMock.expenseShare.update).not.toHaveBeenCalled();
  });

  it('unsettle: 404 for an unknown share', async () => {
    const { service } = makeService(null);
    await expect(service.unsettleShare('u1', 'nope')).rejects.toThrow(
      'Share not found',
    );
  });
});

/**
 * netWithCounterparty («کم و وجه»): the two directions cancel up to the
 * smaller total; a share straddling the boundary is split so the expense
 * total is preserved; the signed balance never changes.
 */
describe('BalancesService netWithCounterparty', () => {
  const T = (day: number) => new Date(2026, 0, day);

  function share(
    id: string,
    amount: number,
    opts: { userId?: string; contact?: Record<string, unknown> | null; at?: Date } = {},
  ) {
    return {
      id,
      amount,
      isPaid: false,
      userId: opts.userId ?? null,
      contactId: opts.contact ? (opts.contact.id as string) : null,
      createdAt: opts.at ?? T(1),
      user: opts.userId ? { id: opts.userId, firstName: 'U' } : null,
      contact: opts.contact ?? null,
    };
  }

  function expense(
    id: string,
    opts: {
      payerId?: string;
      payerContact?: Record<string, unknown> | null;
      shares: ReturnType<typeof share>[];
    },
  ) {
    return {
      id,
      payerId: opts.payerId ?? null,
      payer: opts.payerId ? { id: opts.payerId, firstName: 'P' } : null,
      payerContactId: opts.payerContact
        ? (opts.payerContact.id as string)
        : null,
      payerContact: opts.payerContact ?? null,
      shares: opts.shares,
    };
  }

  function makeNetService(expenses: unknown[]) {
    const txMock = {
      expenseShare: {
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prismaMock = {
      expense: { findMany: jest.fn().mockResolvedValue(expenses) },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
        fn(txMock),
      ),
    };
    const service = new BalancesService(prismaMock as never);
    return { service, prismaMock, txMock };
  }

  it('crosses out the smaller side and splits the straddling share', async () => {
    const { service, txMock } = makeNetService([
      expense('e1', {
        payerId: 'u1',
        shares: [share('s1', 100, { userId: 'u2', at: T(1) })],
      }),
      expense('e2', {
        payerId: 'u2',
        shares: [share('s2', 60, { userId: 'u1', at: T(2) })],
      }),
    ]);
    const res = await service.netWithCounterparty('u1', 'user:u2');
    expect(res).toEqual({ offsetAmount: 60, balance: 40, settledShares: 2 });
    // credit side: s1 (100) straddles 60 -> remainder 40 stays open, 60 settles
    expect(txMock.expenseShare.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { amount: 40 },
    });
    expect(txMock.expenseShare.create).toHaveBeenCalledWith({
      data: {
        amount: 60,
        isPaid: true,
        expenseId: 'e1',
        userId: 'u2',
        contactId: null,
      },
    });
    // debit side: s2 (60) settles whole
    expect(txMock.expenseShare.update).toHaveBeenCalledWith({
      where: { id: 's2' },
      data: { isPaid: true },
    });
  });

  it('settles everything when both sides match exactly', async () => {
    const { service, txMock } = makeNetService([
      expense('e1', {
        payerId: 'u1',
        shares: [share('s1', 50, { userId: 'u2' })],
      }),
      expense('e2', {
        payerId: 'u2',
        shares: [share('s2', 50, { userId: 'u1' })],
      }),
    ]);
    const res = await service.netWithCounterparty('u1', 'user:u2');
    expect(res).toEqual({ offsetAmount: 50, balance: 0, settledShares: 2 });
    expect(txMock.expenseShare.create).not.toHaveBeenCalled();
    expect(txMock.expenseShare.update).toHaveBeenCalledTimes(2);
  });

  it('does nothing when the debt runs one way only', async () => {
    const { service, prismaMock } = makeNetService([
      expense('e1', {
        payerId: 'u1',
        shares: [share('s1', 70, { userId: 'u2' })],
      }),
    ]);
    const res = await service.netWithCounterparty('u1', 'user:u2');
    expect(res).toEqual({ offsetAmount: 0, balance: 70, settledShares: 0 });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('ignores shares owed to a third-party payer', async () => {
    const { service, prismaMock } = makeNetService([
      expense('e1', {
        payerId: 'u3',
        shares: [
          share('s1', 30, { userId: 'u1' }),
          share('s2', 30, { userId: 'u2', at: T(2) }),
        ],
      }),
    ]);
    const res = await service.netWithCounterparty('u1', 'user:u2');
    expect(res.offsetAmount).toBe(0);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('nets against a counterparty reached through a linked contact', async () => {
    const yazdani = { id: 'c1', name: 'یزدانی', linkedUserId: 'u2' };
    const { service, txMock } = makeNetService([
      // Yazdani paid (via my contact record for him); I owe 80.
      expense('e1', {
        payerContact: yazdani,
        shares: [share('s1', 80, { userId: 'u1', at: T(1) })],
      }),
      // I paid; Yazdani (same contact) owes 30.
      expense('e2', {
        payerId: 'u1',
        shares: [share('s2', 30, { contact: yazdani, at: T(2) })],
      }),
    ]);
    const res = await service.netWithCounterparty('u1', 'user:u2');
    expect(res).toEqual({ offsetAmount: 30, balance: -50, settledShares: 2 });
    expect(txMock.expenseShare.update).toHaveBeenCalledWith({
      where: { id: 's2' },
      data: { isPaid: true },
    });
    expect(txMock.expenseShare.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { amount: 50 },
    });
    expect(txMock.expenseShare.create).toHaveBeenCalledWith({
      data: {
        amount: 30,
        isPaid: true,
        expenseId: 'e1',
        userId: 'u1',
        contactId: null,
      },
    });
  });

  it('consumes the oldest shares first', async () => {
    const { service, txMock } = makeNetService([
      expense('e1', {
        payerId: 'u1',
        shares: [
          share('s-new', 50, { userId: 'u2', at: T(5) }),
          share('s-old', 50, { userId: 'u2', at: T(1) }),
        ],
      }),
      expense('e2', {
        payerId: 'u2',
        shares: [share('s3', 60, { userId: 'u1', at: T(3) })],
      }),
    ]);
    const res = await service.netWithCounterparty('u1', 'user:u2');
    expect(res.offsetAmount).toBe(60);
    // oldest credit share settles whole, the newer one is split
    expect(txMock.expenseShare.update).toHaveBeenCalledWith({
      where: { id: 's-old' },
      data: { isPaid: true },
    });
    expect(txMock.expenseShare.update).toHaveBeenCalledWith({
      where: { id: 's-new' },
      data: { amount: 40 },
    });
  });

  it('rejects a malformed party key', async () => {
    const { service } = makeNetService([]);
    await expect(
      service.netWithCounterparty('u1', 'yazdani'),
    ).rejects.toThrow('partyKey');
  });
});

/**
 * Notification hooks: settle and netting DM the other side via the
 * (optional) TelegramNotifyService. Fire-and-forget — flush microtasks
 * before asserting.
 */
describe('BalancesService notifications', () => {
  const flush = async () => {
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  };

  function fakeNotify() {
    return {
      notifyUser: jest.fn().mockResolvedValue(undefined),
      nameOf: jest.fn().mockResolvedValue('یزدانی'),
    };
  }

  it('settle: the payer is notified when the debtor settles', async () => {
    const notify = fakeNotify();
    const share = {
      id: 's1',
      amount: 50000,
      isPaid: false,
      userId: 'u1',
      contact: null,
      expense: {
        title: 'ناهار',
        payerId: 'u2',
        createdById: 'u2',
        payerContact: null,
      },
    };
    const prismaMock = {
      expenseShare: {
        findUnique: jest.fn().mockResolvedValue(share),
        update: jest
          .fn()
          .mockResolvedValue({ ...share, isPaid: true }),
      },
    };
    const service = new BalancesService(
      prismaMock as never,
      notify as never,
    );
    await service.settleShare('u1', 's1');
    await flush();
    expect(notify.notifyUser).toHaveBeenCalledTimes(1);
    expect(notify.notifyUser).toHaveBeenCalledWith(
      'u2',
      expect.stringContaining('ناهار'),
    );
  });

  it('settle: nobody is notified for an idempotent no-op', async () => {
    const notify = fakeNotify();
    const share = {
      id: 's1',
      amount: 50000,
      isPaid: true,
      userId: 'u1',
      contact: null,
      expense: {
        title: 'ناهار',
        payerId: 'u2',
        createdById: 'u2',
        payerContact: null,
      },
    };
    const prismaMock = {
      expenseShare: {
        findUnique: jest.fn().mockResolvedValue(share),
        update: jest.fn(),
      },
    };
    const service = new BalancesService(
      prismaMock as never,
      notify as never,
    );
    await service.settleShare('u1', 's1');
    await flush();
    expect(notify.notifyUser).not.toHaveBeenCalled();
  });

  it('netting: the counterparty is notified with the crossed-out amount', async () => {
    const notify = fakeNotify();
    const T = (day: number) => new Date(2026, 0, day);
    const expenses = [
      {
        id: 'e1',
        payerId: 'u1',
        payer: { id: 'u1', firstName: 'P' },
        payerContactId: null,
        payerContact: null,
        shares: [
          {
            id: 's1',
            amount: 100,
            isPaid: false,
            userId: 'u2',
            contactId: null,
            createdAt: T(1),
            user: { id: 'u2', firstName: 'U' },
            contact: null,
          },
        ],
      },
      {
        id: 'e2',
        payerId: 'u2',
        payer: { id: 'u2', firstName: 'P' },
        payerContactId: null,
        payerContact: null,
        shares: [
          {
            id: 's2',
            amount: 60,
            isPaid: false,
            userId: 'u1',
            contactId: null,
            createdAt: T(2),
            user: { id: 'u1', firstName: 'U' },
            contact: null,
          },
        ],
      },
    ];
    const txMock = {
      expenseShare: {
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prismaMock = {
      expense: { findMany: jest.fn().mockResolvedValue(expenses) },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
        fn(txMock),
      ),
    };
    const service = new BalancesService(
      prismaMock as never,
      notify as never,
    );
    await service.netWithCounterparty('u1', 'user:u2');
    await flush();
    expect(notify.notifyUser).toHaveBeenCalledTimes(1);
    expect(notify.notifyUser).toHaveBeenCalledWith(
      'u2',
      expect.stringContaining('کم و وجه'),
    );
  });
});

/**
 * getSettlePlan («تسویه گروهی»): nets across the selected group's open
 * shares, then the greedy minimum-transaction plan. Read-only.
 */
describe('BalancesService getSettlePlan', () => {
  const T = (day: number) => new Date(2026, 0, day);

  function share(
    id: string,
    amount: number,
    opts: { userId?: string; contact?: Record<string, unknown> | null; at?: Date } = {},
  ) {
    return {
      id,
      amount,
      isPaid: false,
      userId: opts.userId ?? null,
      contactId: opts.contact ? (opts.contact.id as string) : null,
      createdAt: opts.at ?? T(1),
      user: opts.userId ? { id: opts.userId, firstName: 'U' } : null,
      contact: opts.contact ?? null,
    };
  }

  function expense(
    id: string,
    opts: {
      payerId?: string;
      payerContact?: Record<string, unknown> | null;
      shares: ReturnType<typeof share>[];
    },
  ) {
    return {
      id,
      payerId: opts.payerId ?? null,
      payer: opts.payerId ? { id: opts.payerId, firstName: 'P' } : null,
      payerContactId: opts.payerContact
        ? (opts.payerContact.id as string)
        : null,
      payerContact: opts.payerContact ?? null,
      shares: opts.shares,
    };
  }

  function makePlanService(expenses: unknown[]) {
    const prismaMock = {
      contact: { findMany: jest.fn().mockResolvedValue([]) },
      expense: { findMany: jest.fn().mockResolvedValue(expenses) },
    };
    const service = new BalancesService(prismaMock as never);
    return { service, prismaMock };
  }

  it('the 4-person trip: 3 transfers settle everyone', async () => {
    const { service } = makePlanService([
      // u1 paid 1,000,000 for dinner, split 250,000 each.
      expense('dinner', {
        payerId: 'u1',
        shares: [
          share('s1', 250000, { userId: 'u2' }),
          share('s2', 250000, { userId: 'u3' }),
          share('s3', 250000, { userId: 'u4' }),
        ],
      }),
      // u2 paid 2,000,000 for the hotel, split 500,000 each.
      expense('hotel', {
        payerId: 'u2',
        shares: [
          share('s4', 500000, { userId: 'u1' }),
          share('s5', 500000, { userId: 'u3' }),
          share('s6', 500000, { userId: 'u4' }),
        ],
      }),
      // u3 paid 500,000 for the taxi, split 125,000 each.
      expense('taxi', {
        payerId: 'u3',
        shares: [
          share('s7', 125000, { userId: 'u1' }),
          share('s8', 125000, { userId: 'u2' }),
          share('s9', 125000, { userId: 'u4' }),
        ],
      }),
    ]);
    const plan = await service.getSettlePlan('u1', [
      'user:u2',
      'user:u3',
      'user:u4',
    ]);
    expect(plan.parties).toEqual([
      { key: 'user:u2', balance: 1125000 },
      { key: 'user:u1', balance: 125000 },
      { key: 'user:u3', balance: -375000 },
      { key: 'user:u4', balance: -875000 },
    ]);
    expect(plan.transfers).toEqual([
      { fromKey: 'user:u4', toKey: 'user:u2', amount: 875000 },
      { fromKey: 'user:u3', toKey: 'user:u2', amount: 250000 },
      { fromKey: 'user:u3', toKey: 'user:u1', amount: 125000 },
    ]);
    expect(plan.totalAmount).toBe(1250000);
  });

  it('excludes shares with anyone outside the selected set', async () => {
    const { service } = makePlanService([
      expense('e1', {
        payerId: 'u1',
        shares: [
          share('s1', 100000, { userId: 'u2' }),
          // u5 is not selected: this 100,000 must not move any net.
          share('s2', 100000, { userId: 'u5' }),
        ],
      }),
    ]);
    const plan = await service.getSettlePlan('u1', ['user:u2']);
    expect(plan.parties).toEqual([
      { key: 'user:u1', balance: 100000 },
      { key: 'user:u2', balance: -100000 },
    ]);
    expect(plan.transfers).toEqual([
      { fromKey: 'user:u2', toKey: 'user:u1', amount: 100000 },
    ]);
  });

  it('already settled: empty plan', async () => {
    const { service } = makePlanService([]);
    const plan = await service.getSettlePlan('u1', ['user:u2']);
    expect(plan.transfers).toEqual([]);
    expect(plan.totalAmount).toBe(0);
  });

  it('rejects an empty selection', async () => {
    const { service } = makePlanService([]);
    await expect(service.getSettlePlan('u1', [])).rejects.toThrow(
      'at least one other person',
    );
  });

  it('rejects a malformed party key', async () => {
    const { service } = makePlanService([]);
    await expect(
      service.getSettlePlan('u1', ['yazdani']),
    ).rejects.toThrow('partyKey');
  });
});

/**
 * settleTransfer: one transfer of a settlement plan (debtor pays creditor),
 * scoped to a group expense's sub-expenses. The debtor's open shares to the
 * creditor are settled, oldest first, splitting a share that straddles the
 * amount — the same split «کم و وجه» uses. A payment only reduces what the
 * debtor owes the creditor; it never creates a reverse debt.
 */
describe('BalancesService settleTransfer', () => {
  const T = (day: number) => new Date(2026, 0, day);

  function share(
    id: string,
    amount: number,
    opts: { userId?: string; at?: Date } = {},
  ) {
    return {
      id,
      amount,
      isPaid: false,
      userId: opts.userId ?? null,
      contactId: null,
      createdAt: opts.at ?? T(1),
      user: opts.userId ? { id: opts.userId, firstName: 'U' } : null,
      contact: null,
    };
  }

  function expense(
    id: string,
    opts: { payerId: string; createdById?: string; shares: ReturnType<typeof share>[] },
  ) {
    return {
      id,
      createdById: opts.createdById ?? 'u1',
      payerId: opts.payerId,
      payer: { id: opts.payerId, firstName: 'P' },
      payerContactId: null,
      payerContact: null,
      shares: opts.shares,
    };
  }

  function makeTransferService(expenses: unknown[]) {
    const txMock = {
      expenseShare: {
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockImplementation((args: { data: unknown }) =>
          Promise.resolve({ id: 'piece-new', ...(args.data as object) }),
        ),
      },
    };
    const prismaMock = {
      contact: { findUnique: jest.fn().mockResolvedValue(null) },
      expense: { findMany: jest.fn().mockResolvedValue(expenses) },
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
        fn(txMock),
      ),
    };
    const service = new BalancesService(prismaMock as never);
    return { service, prismaMock, txMock };
  }

  it('the 2-person case: splits the straddling share, net becomes zero', async () => {
    // u1 paid 100,000, u2 paid 50,000; share 75,000 each; u2 owes u1 25,000.
    const { service, txMock } = makeTransferService([
      expense('e1', {
        payerId: 'u1',
        shares: [share('s1', 50000, { userId: 'u2', at: T(1) })],
      }),
      expense('e2', {
        payerId: 'u2',
        shares: [share('s2', 25000, { userId: 'u1', at: T(2) })],
      }),
    ]);
    const res = await service.settleTransfer('u1', {
      fromKey: 'user:u2',
      toKey: 'user:u1',
      amount: 25000,
      expenseIds: ['e1', 'e2'],
    });
    expect(res).toEqual({
      settledAmount: 25000,
      remainingAmount: 0,
      settledShares: 1,
      settledShareIds: ['piece-new'],
    });
    // s1 (50,000) straddles 25,000 -> remainder 25,000 stays open, 25,000 settles
    expect(txMock.expenseShare.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { amount: 25000 },
    });
    expect(txMock.expenseShare.create).toHaveBeenCalledWith({
      data: {
        amount: 25000,
        isPaid: true,
        expenseId: 'e1',
        userId: 'u2',
        contactId: null,
      },
    });
    // s2 (u1 owes u2) is untouched: a payment never settles the reverse side
    expect(txMock.expenseShare.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's2' } }),
    );
  });

  it('settles a whole share when the amount covers it', async () => {
    const { service, txMock } = makeTransferService([
      expense('e1', {
        payerId: 'u1',
        shares: [share('s1', 40000, { userId: 'u2' })],
      }),
    ]);
    const res = await service.settleTransfer('u2', {
      fromKey: 'user:u2',
      toKey: 'user:u1',
      amount: 40000,
      expenseIds: ['e1'],
    });
    expect(res).toEqual({
      settledAmount: 40000,
      remainingAmount: 0,
      settledShares: 1,
      settledShareIds: ['s1'],
    });
    expect(txMock.expenseShare.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { isPaid: true },
    });
    expect(txMock.expenseShare.create).not.toHaveBeenCalled();
  });

  it('3 people: routes the transfer through an intermediate, settles fully', async () => {
    // u1 paid 100,000, u2 paid 50,000, u3 paid nothing; share 50,000 each.
    // The plan says u3 → u1 49,999, but u3 only owes u1 33,333 directly —
    // the rest is u3's share of u2's expense. The flow routes it
    // u3→u2→u1, so the transfer settles in full instead of leaving 16,666.
    const { service, txMock } = makeTransferService([
      expense('e1', {
        payerId: 'u1',
        shares: [
          share('s1', 33333, { userId: 'u2', at: T(1) }),
          share('s2', 33333, { userId: 'u3', at: T(1) }),
        ],
      }),
      expense('e2', {
        payerId: 'u2',
        shares: [
          share('s3', 16667, { userId: 'u1', at: T(2) }),
          share('s4', 16666, { userId: 'u3', at: T(2) }),
        ],
      }),
    ]);
    const res = await service.settleTransfer('u1', {
      fromKey: 'user:u3',
      toKey: 'user:u1',
      amount: 49999,
      expenseIds: ['e1', 'e2'],
    });
    expect(res).toEqual({
      settledAmount: 49999,
      remainingAmount: 0,
      settledShares: 3,
      settledShareIds: expect.arrayContaining(['s2', 's4', 'piece-new']),
    });
    // s2 (u3→u1, 33,333) settles whole; s4 (u3→u2, 16,666) settles whole;
    // s1 (u2→u1, 33,333) splits: 16,666 settles, 16,667 stays open.
    expect(txMock.expenseShare.update).toHaveBeenCalledWith({
      where: { id: 's2' },
      data: { isPaid: true },
    });
    expect(txMock.expenseShare.update).toHaveBeenCalledWith({
      where: { id: 's4' },
      data: { isPaid: true },
    });
    expect(txMock.expenseShare.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { amount: 16667 },
    });
    // s3 (u1 owes u2) is untouched.
    expect(txMock.expenseShare.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's3' } }),
    );
  });

  it('settles only what is owed when the amount exceeds the debt', async () => {
    const { service } = makeTransferService([
      expense('e1', {
        payerId: 'u1',
        shares: [share('s1', 10000, { userId: 'u2' })],
      }),
    ]);
    const res = await service.settleTransfer('u1', {
      fromKey: 'user:u2',
      toKey: 'user:u1',
      amount: 25000,
      expenseIds: ['e1'],
    });
    expect(res).toEqual({
      settledAmount: 10000,
      remainingAmount: 15000,
      settledShares: 1,
      settledShareIds: ['s1'],
    });
  });

  it('a stranger is forbidden', async () => {
    const { service, prismaMock } = makeTransferService([
      expense('e1', {
        payerId: 'u1',
        shares: [share('s1', 10000, { userId: 'u2' })],
      }),
    ]);
    await expect(
      service.settleTransfer('stranger', {
        fromKey: 'user:u2',
        toKey: 'user:u1',
        amount: 10000,
        expenseIds: ['e1'],
      }),
    ).rejects.toThrow('Only a participant of this group expense');
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('any participant may settle a transfer between two others', async () => {
    // u3 is in the group (has a share in e1) but is neither the debtor
    // (u2) nor the creditor (u1) of this transfer — and not the creator.
    // A group is a shared space: they can still mark it settled.
    const { service } = makeTransferService([
      expense('e1', {
        payerId: 'u1',
        createdById: 'u1',
        shares: [
          share('s1', 10000, { userId: 'u2' }),
          share('s2', 5000, { userId: 'u3' }),
        ],
      }),
    ]);
    const res = await service.settleTransfer('u3', {
      fromKey: 'user:u2',
      toKey: 'user:u1',
      amount: 10000,
      expenseIds: ['e1'],
    });
    expect(res.settledAmount).toBe(10000);
    expect(res.remainingAmount).toBe(0);
  });

  it('rejects fromKey === toKey', async () => {
    const { service } = makeTransferService([]);
    await expect(
      service.settleTransfer('u1', {
        fromKey: 'user:u1',
        toKey: 'user:u1',
        amount: 1000,
        expenseIds: ['e1'],
      }),
    ).rejects.toThrow('fromKey and toKey must differ');
  });
});
