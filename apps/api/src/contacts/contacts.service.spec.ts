import { ContactsService } from './contacts.service';

/**
 * Recent-contacts ranking is tested against a mocked PrismaService —
 * no live database is required.
 */
describe('ContactsService.listRecentContacts', () => {
  function makeService(
    shareContactIds: (string | null)[],
    contacts: { id: string; name: string }[],
  ) {
    const prismaMock = {
      expenseShare: {
        findMany: jest.fn().mockResolvedValue(
          shareContactIds.map((contactId) => ({ contactId })),
        ),
      },
      contact: {
        findMany: jest.fn().mockResolvedValue(
          contacts.map((c) => ({ ...c, linkedUser: null })),
        ),
      },
    };
    const service = new ContactsService(prismaMock as never);
    return { service, prismaMock };
  }

  it('ranks contacts by share count, most-used first, with usageCount', async () => {
    const { service, prismaMock } = makeService(
      ['c2', 'c1', 'c2', 'c3', 'c2', 'c1'],
      [
        { id: 'c1', name: 'Ali' },
        { id: 'c2', name: 'Sara' },
        { id: 'c3', name: 'Reza' },
      ],
    );

    const result = await service.listRecentContacts('owner-1');

    expect(prismaMock.expenseShare.findMany).toHaveBeenCalledWith({
      where: { contactId: { not: null }, contact: { ownerId: 'owner-1' } },
      select: { contactId: true },
    });
    expect(result.map((c) => [c.id, c.usageCount])).toEqual([
      ['c2', 3],
      ['c1', 2],
      ['c3', 1],
    ]);
  });

  it('limits the result to 5 contacts by default', async () => {
    const ids = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'];
    const shares: string[] = [];
    // c1 gets 7 shares, c2 gets 6, ... c7 gets 1 — strict ranking.
    ids.forEach((id, i) => {
      for (let n = 0; n < ids.length - i; n++) shares.push(id);
    });
    const { service } = makeService(
      shares,
      ids.map((id) => ({ id, name: id })),
    );

    const result = await service.listRecentContacts('owner-1');

    expect(result).toHaveLength(5);
    expect(result.map((c) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
  });

  it('returns an empty list when the owner has no shares yet', async () => {
    const { service, prismaMock } = makeService([], []);

    const result = await service.listRecentContacts('owner-1');

    expect(result).toEqual([]);
    expect(prismaMock.contact.findMany).not.toHaveBeenCalled();
  });
});
