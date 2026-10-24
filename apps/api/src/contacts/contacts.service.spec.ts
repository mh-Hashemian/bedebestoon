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

describe('ContactsService.ensureReverseContacts', () => {
  type Owner = {
    id: string;
    firstName: string;
    lastName: string | null;
    username: string | null;
    phone: string | null;
  };
  function makeService(opts: {
    linkedToMe: { owner: Owner }[];
    mine: { name: string; linkedUserId: string | null }[];
  }) {
    const prismaMock = {
      contact: {
        findMany: jest.fn().mockImplementation(({ where }) => {
          if (where?.linkedUserId) {
            return Promise.resolve(opts.linkedToMe);
          }
          return Promise.resolve(opts.mine);
        }),
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'new', ...data, linkedUser: null }),
          ),
      },
    };
    const service = new ContactsService(prismaMock as never);
    return { service, prismaMock };
  }

  const owner: Owner = {
    id: 'owner-1',
    firstName: 'Mohammad',
    lastName: null,
    username: 'mohammad',
    phone: '+989111111111',
  };

  it('creates a reverse contact for a linked owner', async () => {
    const { service, prismaMock } = makeService({
      linkedToMe: [{ owner }],
      mine: [],
    });
    await service.ensureReverseContacts('joiner-1');
    expect(prismaMock.contact.create).toHaveBeenCalledWith({
      data: {
        ownerId: 'joiner-1',
        name: 'Mohammad',
        phone: '+989111111111',
        linkedUserId: 'owner-1',
      },
    });
  });

  it('skips owners that already have a reverse contact', async () => {
    const { service, prismaMock } = makeService({
      linkedToMe: [{ owner }],
      mine: [{ name: 'Mohammad', linkedUserId: 'owner-1' }],
    });
    await service.ensureReverseContacts('joiner-1');
    expect(prismaMock.contact.create).not.toHaveBeenCalled();
  });

  it('skips the joiner themselves', async () => {
    const { service, prismaMock } = makeService({
      linkedToMe: [{ owner: { ...owner, id: 'joiner-1' } }],
      mine: [],
    });
    await service.ensureReverseContacts('joiner-1');
    expect(prismaMock.contact.create).not.toHaveBeenCalled();
  });

  it('suffixes the name on collision instead of linking on name', async () => {
    const { service, prismaMock } = makeService({
      linkedToMe: [{ owner }],
      mine: [{ name: 'Mohammad', linkedUserId: 'someone-else' }],
    });
    await service.ensureReverseContacts('joiner-1');
    expect(prismaMock.contact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Mohammad (@mohammad)',
        linkedUserId: 'owner-1',
      }),
    });
  });

  it('does nothing when nobody linked to the user', async () => {
    const { service, prismaMock } = makeService({
      linkedToMe: [],
      mine: [],
    });
    await service.ensureReverseContacts('joiner-1');
    expect(prismaMock.contact.create).not.toHaveBeenCalled();
  });
});

describe('ContactsService.createContact phone linking', () => {
  function makeService(userByPhone: { id: string } | null) {
    const prismaMock = {
      user: {
        findUnique: jest.fn().mockResolvedValue(userByPhone),
      },
      contact: {
        create: jest
          .fn()
          .mockImplementation(({ data }) =>
            Promise.resolve({ id: 'c1', ...data, linkedUser: null }),
          ),
      },
    };
    const service = new ContactsService(prismaMock as never);
    return { service, prismaMock };
  }

  it('links immediately when the phone belongs to another user', async () => {
    const { service, prismaMock } = makeService({ id: 'user-2' });
    await service.createContact('owner-1', {
      name: 'Reza',
      phone: '09123456789',
    });
    expect(prismaMock.contact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ linkedUserId: 'user-2' }),
      include: expect.anything(),
    });
  });

  it('leaves the contact unlinked when the phone belongs to nobody', async () => {
    const { service, prismaMock } = makeService(null);
    await service.createContact('owner-1', {
      name: 'Reza',
      phone: '09123456789',
    });
    expect(prismaMock.contact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ linkedUserId: null }),
      include: expect.anything(),
    });
  });

  it('never links a contact to its own owner', async () => {
    const { service, prismaMock } = makeService({ id: 'owner-1' });
    await service.createContact('owner-1', {
      name: 'Me',
      phone: '09123456789',
    });
    expect(prismaMock.contact.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ linkedUserId: null }),
      include: expect.anything(),
    });
  });
});
