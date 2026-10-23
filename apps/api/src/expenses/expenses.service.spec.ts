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
});
