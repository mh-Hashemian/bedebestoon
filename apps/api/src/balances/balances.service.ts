import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CONTACT_PUBLIC_SELECT,
  USER_PUBLIC_SELECT,
} from '../expenses/expenses.service';
import { PrismaService } from '../prisma/prisma.service';

export interface CounterpartyBalance {
  /** "user:<id>" or "contact:<id>" — a linked contact resolves to its user. */
  key: string;
  userId?: string;
  contactId?: string;
  name: string;
  /** Positive: they owe the current user. Negative: the current user owes them. */
  balance: number;
}

interface Party {
  key: string;
  userId?: string;
  contactId?: string;
  name: string;
}

function partyFromUser(u: {
  id: string;
  firstName: string;
}): Party {
  return { key: `user:${u.id}`, userId: u.id, name: u.firstName };
}

function partyFromContact(c: {
  id: string;
  name: string;
  linkedUserId: string | null;
}): Party {
  return c.linkedUserId
    ? {
        key: `user:${c.linkedUserId}`,
        userId: c.linkedUserId,
        contactId: c.id,
        name: c.name,
      }
    : { key: `contact:${c.id}`, contactId: c.id, name: c.name };
}

@Injectable()
export class BalancesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Addendum v1.1 — per-counterparty net balance for the current user,
   * computed from UNPAID shares only:
   *   user is the payer  -> each debtor's balance grows (+, they owe user)
   *   user is a debtor   -> payer's balance shrinks (-, user owes them)
   * A share's counterparty is its user, or its contact resolved through
   * contact.linkedUser (falling back to the contact itself while unlinked).
   */
  async getBalances(userId: string): Promise<CounterpartyBalance[]> {
    const expenses = await this.prisma.expense.findMany({
      where: {
        OR: [
          { payerId: userId },
          { payerContact: { linkedUserId: userId } },
          { shares: { some: { userId } } },
          { shares: { some: { contact: { linkedUserId: userId } } } },
        ],
      },
      include: {
        payer: { select: USER_PUBLIC_SELECT },
        payerContact: { select: CONTACT_PUBLIC_SELECT },
        shares: {
          where: { isPaid: false },
          include: {
            user: { select: USER_PUBLIC_SELECT },
            contact: { select: CONTACT_PUBLIC_SELECT },
          },
        },
      },
    });

    const me: Party = { key: `user:${userId}`, userId, name: 'me' };
    const totals = new Map<string, CounterpartyBalance>();

    const add = (party: Party, delta: number) => {
      const existing = totals.get(party.key);
      if (existing) {
        existing.balance += delta;
      } else {
        totals.set(party.key, {
          key: party.key,
          userId: party.userId,
          contactId: party.contactId,
          name: party.name,
          balance: delta,
        });
      }
    };

    for (const expense of expenses) {
      const payer: Party | null = expense.payer
        ? partyFromUser(expense.payer)
        : expense.payerContact
          ? partyFromContact(expense.payerContact)
          : null;
      if (!payer) continue;

      for (const share of expense.shares) {
        const debtor: Party | null = share.user
          ? partyFromUser(share.user)
          : share.contact
            ? partyFromContact(share.contact)
            : null;
        if (!debtor) continue;
        if (debtor.key === payer.key) continue; // payer's own share

        if (payer.key === me.key) {
          add(debtor, share.amount); // they owe me
        } else if (debtor.key === me.key) {
          add(payer, -share.amount); // I owe them
        }
        // Shares between two other parties don't move my balance.
      }
    }

    return [...totals.values()]
      .filter((b) => b.balance !== 0)
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  }

  /**
   * Mark one share as settled. Only someone involved in that expense may do
   * it: the payer, the expense creator, or the share's holder (each resolved
   * through linked contacts as well).
   */
  async settleShare(userId: string, shareId: string) {
    const share = await this.prisma.expenseShare.findUnique({
      where: { id: shareId },
      include: {
        expense: {
          include: {
            payerContact: { select: { id: true, linkedUserId: true } },
          },
        },
        contact: { select: { id: true, linkedUserId: true } },
      },
    });
    if (!share) throw new NotFoundException('Share not found');

    const e = share.expense;
    const involved =
      e.payerId === userId ||
      e.createdById === userId ||
      e.payerContact?.linkedUserId === userId ||
      share.userId === userId ||
      share.contact?.linkedUserId === userId;
    if (!involved) {
      throw new ForbiddenException(
        'Only a participant or the payer of this expense can settle a share',
      );
    }

    if (share.isPaid) return share; // idempotent
    return this.prisma.expenseShare.update({
      where: { id: shareId },
      data: { isPaid: true },
    });
  }
}
