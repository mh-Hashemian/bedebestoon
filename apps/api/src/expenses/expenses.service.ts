import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Contact, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateExpenseDto, ParticipantDto } from './dto/create-expense.dto';
import { equalSplit, isValidCustomSplit } from './split.util';

/** Fields of a user that are safe to expose in API responses (no BigInt). */
export const USER_PUBLIC_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  username: true,
} as const;

/** Contact fields safe to expose (phone stays private — matching key only). */
export const CONTACT_PUBLIC_SELECT = {
  id: true,
  name: true,
  linkedUserId: true,
} as const;

type ContactLite = Pick<Contact, 'id' | 'linkedUserId'>;

/**
 * Identity key of a "party" in an expense. A contact that has been linked
 * to a real user resolves to that user; an unlinked contact is its own party.
 */
function partyKeyOfUser(userId: string): string {
  return `user:${userId}`;
}
function partyKeyOfContact(contact: ContactLite): string {
  return contact.linkedUserId
    ? `user:${contact.linkedUserId}`
    : `contact:${contact.id}`;
}

@Injectable()
export class ExpensesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a group expense and its shares atomically (HANDOVER §4.3).
   *
   * Rules implemented here:
   *  - exactly one payer kind: the current user, OR payerContactId
   *    (Addendum v1.1) — a contact owned by the creator;
   *  - each participant references exactly one of userId / contactId;
   *    a userId participant may only be the creator themself in Phase 1,
   *    contact participants must be the creator's own contacts;
   *  - split: equal (v1.1 remainder rule) or custom (amounts must sum to
   *    totalAmount);
   *  - the payer's own share is created already settled (isPaid = true):
   *    you cannot owe yourself.
   */
  async createExpense(creator: User, dto: CreateExpenseDto) {
    const participants = dto.participants;

    for (const p of participants) {
      const kinds = [p.userId, p.contactId].filter(Boolean).length;
      if (kinds !== 1) {
        throw new BadRequestException(
          'Each participant must reference exactly one of userId or contactId',
        );
      }
      if (p.userId && p.userId !== creator.id) {
        throw new BadRequestException(
          'In this phase a userId participant can only be yourself; add other people as contacts',
        );
      }
    }

    // Resolve every referenced contact and make sure the creator owns them.
    const referencedIds = new Set<string>();
    for (const p of participants) if (p.contactId) referencedIds.add(p.contactId);
    if (dto.payerContactId) referencedIds.add(dto.payerContactId);

    const contacts = await this.prisma.contact.findMany({
      where: { id: { in: [...referencedIds] }, ownerId: creator.id },
    });
    if (contacts.length !== referencedIds.size) {
      throw new BadRequestException(
        'One or more referenced contacts do not exist in your contact list',
      );
    }
    const contactById = new Map<string, Contact>(
      contacts.map((c) => [c.id, c]),
    );

    // Split amounts.
    const withAmounts = participants.filter((p) => p.amount !== undefined);
    let amounts: number[];
    if (withAmounts.length === 0) {
      amounts = equalSplit(dto.totalAmount, participants.length);
    } else {
      if (withAmounts.length !== participants.length) {
        throw new BadRequestException(
          'Provide an amount for every participant, or for none (equal split)',
        );
      }
      amounts = participants.map((p) => p.amount as number);
      if (!isValidCustomSplit(dto.totalAmount, amounts)) {
        throw new BadRequestException(
          'Custom split amounts must sum up to totalAmount',
        );
      }
    }

    const payerKey = dto.payerContactId
      ? partyKeyOfContact(contactById.get(dto.payerContactId) as Contact)
      : partyKeyOfUser(creator.id);

    const holderKey = (p: ParticipantDto): string =>
      p.userId
        ? partyKeyOfUser(p.userId)
        : partyKeyOfContact(contactById.get(p.contactId as string) as Contact);

    return this.prisma.$transaction(async (tx) => {
      return tx.expense.create({
        data: {
          title: dto.title,
          totalAmount: dto.totalAmount,
          payerId: dto.payerContactId ? null : creator.id,
          payerContactId: dto.payerContactId ?? null,
          createdById: creator.id,
          shares: {
            create: participants.map((p, i) => ({
              amount: amounts[i],
              userId: p.userId ?? null,
              contactId: p.contactId ?? null,
              isPaid: holderKey(p) === payerKey,
            })),
          },
        },
        include: {
          payer: { select: USER_PUBLIC_SELECT },
          payerContact: { select: CONTACT_PUBLIC_SELECT },
          shares: {
            include: {
              user: { select: USER_PUBLIC_SELECT },
              contact: { select: CONTACT_PUBLIC_SELECT },
            },
          },
        },
      });
    });
  }

  /**
   * Delete an expense the user created (e.g. added by mistake). Shares are
   * removed by the schema's onDelete: Cascade, and balances are computed
   * from shares, so they correct themselves.
   */
  async removeExpense(userId: string, expenseId: string) {
    const expense = await this.prisma.expense.findUnique({
      where: { id: expenseId },
      select: { id: true, createdById: true },
    });
    if (!expense) throw new NotFoundException('Expense not found');
    if (expense.createdById !== userId) {
      throw new ForbiddenException(
        'Only the creator can delete this expense',
      );
    }
    await this.prisma.expense.delete({ where: { id: expenseId } });
  }

  /** Newest-first list of expenses the user is involved in, with shares. */
  async listExpenses(userId: string) {
    return this.prisma.expense.findMany({
      where: {
        OR: [
          { createdById: userId },
          { payerId: userId },
          { payerContact: { linkedUserId: userId } },
          { shares: { some: { userId } } },
          { shares: { some: { contact: { linkedUserId: userId } } } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: {
        payer: { select: USER_PUBLIC_SELECT },
        payerContact: { select: CONTACT_PUBLIC_SELECT },
        shares: {
          orderBy: { createdAt: 'asc' },
          include: {
            user: { select: USER_PUBLIC_SELECT },
            contact: { select: CONTACT_PUBLIC_SELECT },
          },
        },
      },
    });
  }
}
