import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeIranianPhone } from '../common/phone.util';
import { CreateContactDto } from './dto/create-contact.dto';

const LINKED_USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  username: true,
} as const;

@Injectable()
export class ContactsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a contact for the owner. This single endpoint also powers the
   * "inline contact creation" shortcut in the Select Participants screen.
   */
  async createContact(ownerId: string, dto: CreateContactDto) {
    let phone: string | null = null;
    if (dto.phone) {
      phone = normalizeIranianPhone(dto.phone);
      if (!phone) {
        throw new BadRequestException(
          'phone is not a valid Iranian mobile number',
        );
      }
    }

    // Phone matching works both ways: if this number already belongs to a
    // registered user, the contact is linked immediately instead of waiting
    // for that user to share their number again (linking only ever happens
    // on the phone number, never on the name).
    let linkedUserId: string | null = null;
    if (phone) {
      const existingUser = await this.prisma.user.findUnique({
        where: { phone },
        select: { id: true },
      });
      if (existingUser && existingUser.id !== ownerId) {
        linkedUserId = existingUser.id;
      }
    }

    try {
      return await this.prisma.contact.create({
        data: { ownerId, name: dto.name.trim(), phone, linkedUserId },
        include: { linkedUser: { select: LINKED_USER_SELECT } },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'You already have a contact with this name',
        );
      }
      throw err;
    }
  }

  /**
   * Symmetry repair for phone linking. Linking is one-directional: when U
   * shares their number, every contact pointing at U gets linked — but U's
   * own contact list gains nobody. So a user who was added by someone else
   * could see that person's debts yet never record one back, because the
   * person picker only offers their own contacts. This creates the missing
   * reverse contact (owner -> U becomes U -> owner) for every linked
   * owner, unless one already exists. It runs inside listContacts, so it
   * self-heals on the next app open — including for users who linked
   * before this fix shipped. The owner's name is used (it is already
   * visible to U in the shared expenses); the phone is stored only as a
   * matching key and is never displayed.
   */
  async ensureReverseContacts(userId: string) {
    const linkedToMe = await this.prisma.contact.findMany({
      where: { linkedUserId: userId },
      include: {
        owner: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            username: true,
            phone: true,
          },
        },
      },
    });
    if (linkedToMe.length === 0) return;

    const mine = await this.prisma.contact.findMany({
      where: { ownerId: userId },
      select: { name: true, linkedUserId: true },
    });
    const takenNames = new Set(mine.map((c) => c.name));

    const owners = new Map<string, (typeof linkedToMe)[number]['owner']>();
    for (const c of linkedToMe) {
      if (c.owner.id !== userId && !owners.has(c.owner.id)) {
        owners.set(c.owner.id, c.owner);
      }
    }

    for (const owner of owners.values()) {
      if (mine.some((c) => c.linkedUserId === owner.id)) continue;
      const base = owner.lastName
        ? `${owner.firstName} ${owner.lastName}`
        : owner.firstName;
      let name = base;
      if (takenNames.has(name) && owner.username) {
        name = `${base} (@${owner.username})`;
      }
      let n = 2;
      while (takenNames.has(name)) {
        name = `${base} (${n})`;
        n += 1;
      }
      takenNames.add(name);
      await this.prisma.contact.create({
        data: {
          ownerId: userId,
          name,
          phone: owner.phone ?? null,
          linkedUserId: owner.id,
        },
      });
    }
  }

  async listContacts(ownerId: string) {
    await this.ensureReverseContacts(ownerId);
    return this.prisma.contact.findMany({
      where: { ownerId },
      orderBy: { name: 'asc' },
      include: { linkedUser: { select: LINKED_USER_SELECT } },
    });
  }

  /**
   * "Recent contacts" for the Select Participants screen (HANDOVER §2
   * shortcut): the owner's contacts ranked by how many expense shares they
   * hold — i.e. how often they actually split costs with the owner —
   * most-used first, at most `limit` (default 5).
   */
  async listRecentContacts(ownerId: string, limit = 5) {
    const shares = await this.prisma.expenseShare.findMany({
      where: { contactId: { not: null }, contact: { ownerId } },
      select: { contactId: true },
    });

    const counts = new Map<string, number>();
    for (const share of shares) {
      const id = share.contactId as string;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    if (counts.size === 0) return [];

    // Most shares first; contact id as a stable tie-breaker.
    const topIds = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .map(([id]) => id);

    const contacts = await this.prisma.contact.findMany({
      where: { id: { in: topIds }, ownerId },
      include: { linkedUser: { select: LINKED_USER_SELECT } },
    });
    const byId = new Map(contacts.map((c) => [c.id, c]));

    const recent: ((typeof contacts)[number] & { usageCount: number })[] = [];
    for (const id of topIds) {
      const contact = byId.get(id);
      if (contact) recent.push({ ...contact, usageCount: counts.get(id) ?? 0 });
    }
    return recent;
  }

  /**
   * Delete one of the owner's contacts (e.g. added by mistake). A contact
   * that already takes part in expenses — as a share holder or as the
   * payer — cannot be removed: deleting it would rewrite balances.
   */
  async removeContact(ownerId: string, contactId: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id: contactId, ownerId },
      select: { id: true },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    const [shareCount, paidCount] = await Promise.all([
      this.prisma.expenseShare.count({ where: { contactId } }),
      this.prisma.expense.count({ where: { payerContactId: contactId } }),
    ]);
    if (shareCount > 0 || paidCount > 0) {
      throw new BadRequestException(
        'This contact is used in expenses and cannot be deleted',
      );
    }
    await this.prisma.contact.delete({ where: { id: contactId } });
  }
}
