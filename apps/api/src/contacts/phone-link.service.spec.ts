import { BadRequestException } from '@nestjs/common';
import { PhoneLinkService } from './phone-link.service';

/**
 * The merge decision logic is tested against a mocked PrismaService —
 * no live database is required.
 */
describe('PhoneLinkService.linkContactsByPhone', () => {
  function makeService(candidates: { id: string }[]) {
    const prismaMock = {
      user: { update: jest.fn().mockResolvedValue({}) },
      contact: {
        findMany: jest.fn().mockResolvedValue(candidates),
        updateMany: jest.fn().mockResolvedValue({ count: candidates.length }),
      },
    };
    const service = new PhoneLinkService(prismaMock as never);
    return { service, prismaMock };
  }

  it('stores the normalized phone on the user and links every matching unlinked contact', async () => {
    const { service, prismaMock } = makeService([{ id: 'c1' }, { id: 'c2' }]);

    const result = await service.linkContactsByPhone('user-1', '09123456789');

    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { phone: '+989123456789' },
    });
    // Only contacts whose phone matches AND that are not yet linked:
    expect(prismaMock.contact.findMany).toHaveBeenCalledWith({
      where: { phone: '+989123456789', linkedUserId: null },
      select: { id: true },
    });
    // The merge: point those contacts at the real user. Their shares are
    // intentionally left attached to the contacts (no share rewrite calls).
    expect(prismaMock.contact.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['c1', 'c2'] } },
      data: { linkedUserId: 'user-1' },
    });
    expect(result).toEqual({
      phone: '+989123456789',
      linkedContactIds: ['c1', 'c2'],
      linkedCount: 2,
    });
  });

  it('links nothing (and skips updateMany) when no contact has that phone', async () => {
    const { service, prismaMock } = makeService([]);

    const result = await service.linkContactsByPhone(
      'user-9',
      '+98 935 555 1234',
    );

    expect(result.linkedCount).toBe(0);
    expect(result.linkedContactIds).toEqual([]);
    expect(prismaMock.contact.updateMany).not.toHaveBeenCalled();
    // ...but the user's own phone is still recorded for future matches.
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-9' },
      data: { phone: '+989355551234' },
    });
  });

  it('rejects an invalid number without touching the database', async () => {
    const { service, prismaMock } = makeService([{ id: 'c1' }]);

    await expect(
      service.linkContactsByPhone('user-1', '12345'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    expect(prismaMock.contact.findMany).not.toHaveBeenCalled();
  });
});
