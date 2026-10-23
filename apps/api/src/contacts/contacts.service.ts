import {
  BadRequestException,
  ConflictException,
  Injectable,
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

    try {
      return await this.prisma.contact.create({
        data: { ownerId, name: dto.name.trim(), phone },
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

  async listContacts(ownerId: string) {
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
}
