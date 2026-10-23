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

describe('ContactsService.removeContact', () => {
  function makeService(opts: {
    found: boolean;
    shareCount: number;
    paidCount: number;
  }) {
    const prismaMock = {
      contact: {
        findFirst: jest
          .fn()
          .mockResolvedValue(opts.found ? { id: 'c1' } : null),
        delete: jest.fn().mockResolvedValue({ id: 'c1' }),
      },
      expenseShare: {
        count: jest.fn().mockResolvedValue(opts.shareCount),
      },
      expense: {
        count: jest.fn().mockResolvedValue(opts.paidCount),
      },
    };
    const service = new ContactsService(prismaMock as never);
    return { service, prismaMock };
  }

  it('deletes an unused contact owned by the user', async () => {
    const { service, prismaMock } = makeService({
      found: true,
      shareCount: 0,
      paidCount: 0,
    });
    await service.removeContact('owner-1', 'c1');
    expect(prismaMock.contact.delete).toHaveBeenCalledWith({
      where: { id: 'c1' },
    });
  });

  it('throws 404 when the contact does not exist for this owner', async () => {
    const { service, prismaMock } = makeService({
      found: false,
      shareCount: 0,
      paidCount: 0,
    });
    await expect(service.removeContact('owner-1', 'nope')).rejects.toThrow(
      'Contact not found',
    );
    expect(prismaMock.contact.delete).not.toHaveBeenCalled();
  });

  it('refuses to delete a contact that holds shares', async () => {
    const { service, prismaMock } = makeService({
      found: true,
      shareCount: 2,
      paidCount: 0,
    });
    await expect(service.removeContact('owner-1', 'c1')).rejects.toThrow(
      'used in expenses',
    );
    expect(prismaMock.contact.delete).not.toHaveBeenCalled();
  });

  it('refuses to delete a contact that paid for an expense', async () => {
    const { service, prismaMock } = makeService({
      found: true,
      shareCount: 0,
      paidCount: 1,
    });
    await expect(service.removeContact('owner-1', 'c1')).rejects.toThrow(
      'used in expenses',
    );
    expect(prismaMock.contact.delete).not.toHaveBeenCalled();
  });
});
