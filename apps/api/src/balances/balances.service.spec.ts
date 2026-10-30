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
