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
