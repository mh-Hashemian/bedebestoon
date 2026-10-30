import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { formatTomanFa } from '../common/fa-format';
import {
  CONTACT_PUBLIC_SELECT,
  USER_PUBLIC_SELECT,
} from '../expenses/expenses.service';
import { TelegramNotifyService } from '../notifications/telegram-notify.service';
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

export interface NetResult {
  /** Amount crossed out on EACH side (both sides lose exactly this much). */
  offsetAmount: number;
  /**
   * Net balance with the counterparty after netting, signed like
   * CounterpartyBalance.balance. Netting never changes it: it only closes
   * the shares that cancel each other out.
   */
  balance: number;
  /** Shares marked settled, including pieces created by splitting. */
  settledShares: number;
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
  constructor(
    private readonly prisma: PrismaService,
    // Optional so unit specs can construct the service with Prisma alone;
    // Nest injects it in the app. Notifications are fire-and-forget.
    @Optional() private readonly notify?: TelegramNotifyService,
  ) {}

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
    const updated = await this.prisma.expenseShare.update({
      where: { id: shareId },
      data: { isPaid: true },
    });
    void this.notifyShareParties(userId, share, share.expense, 'settle');
    return updated;
  }

  /**
   * Undo a settlement (e.g. the settle button was tapped by mistake).
   * Same involvement rule as settleShare.
   */
  async unsettleShare(userId: string, shareId: string) {
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
        'Only a participant or the payer of this expense can unsettle a share',
      );
    }

    if (!share.isPaid) return share; // idempotent
    const updated = await this.prisma.expenseShare.update({
      where: { id: shareId },
      data: { isPaid: false },
    });
    void this.notifyShareParties(userId, share, share.expense, 'unsettle');
    return updated;
  }

  /**
   * DM the parties of a share (payer and debtor, except the actor) that
   * it was settled or re-opened. Fire-and-forget; never throws.
   */
  private async notifyShareParties(
    actorId: string,
    share: {
      amount: number;
      userId: string | null;
      contact?: { linkedUserId: string | null } | null;
    },
    expense: {
      title: string;
      payerId: string | null;
      payerContact?: { linkedUserId: string | null } | null;
    },
    kind: 'settle' | 'unsettle',
  ) {
    if (!this.notify) return;
    const notify = this.notify;
    try {
      const payerUserId =
        expense.payerId ?? expense.payerContact?.linkedUserId ?? null;
      const debtorUserId =
        share.userId ?? share.contact?.linkedUserId ?? null;
      const recipients = [payerUserId, debtorUserId].filter(
        (x): x is string => !!x && x !== actorId,
      );
      if (recipients.length === 0) return;
      const actor = await notify.nameOf(actorId);
      const amount = formatTomanFa(share.amount);
      for (const uid of recipients) {
        const text =
          kind === 'settle'
            ? uid === debtorUserId
              ? `✅ ${actor} سهم تو از «${expense.title}» رو تسویه‌شده زد (${amount} تومان).`
              : `✅ ${actor} سهم «${expense.title}» (${amount} تومان) رو تسویه کرد.`
            : `↩️ ${actor} تسویه‌ی سهم «${expense.title}» (${amount} تومان) رو برگردوند؛ این سهم دوباره بازه.`;
        void notify.notifyUser(uid, text);
      }
    } catch {
      // notifications are best-effort only
    }
  }

  /** DM the counterparty that netting crossed out part of the account. */
  private async notifyNetResult(
    actorId: string,
    partyKey: string,
    offset: number,
    balance: number,
  ) {
    if (!this.notify) return;
    const notify = this.notify;
    try {
      let recipientId: string | null = null;
      if (partyKey.startsWith('user:')) {
        recipientId = partyKey.slice('user:'.length);
      } else {
        const contact = await this.prisma.contact.findUnique({
          where: { id: partyKey.slice('contact:'.length) },
          select: { linkedUserId: true },
        });
        recipientId = contact?.linkedUserId ?? null;
      }
      if (!recipientId || recipientId === actorId) return;
      const actor = await notify.nameOf(actorId);
      const balanceLine =
        balance === 0
          ? 'حسابتون کاملاً صاف شد. ✅'
          : balance > 0
            ? `خالص حسابتون: ${formatTomanFa(balance)} تومان به ${actor} بدهکاری.`
            : `خالص حسابتون: ${actor} ${formatTomanFa(-balance)} تومان بهت بدهکاره.`;
      void notify.notifyUser(
        recipientId,
        `⚖️ ${actor} با «کم و وجه» ${formatTomanFa(offset)} تومان از بدهی‌های دوطرفه‌تون رو خط زد.\n${balanceLine}`,
      );
    } catch {
      // notifications are best-effort only
    }
  }

  /**
   * «کم و وجه» — netting between the current user and one counterparty:
   * the open shares in the two directions cancel each other out up to the
   * smaller side's total. That amount is marked settled on BOTH sides
   * (oldest shares first), so afterwards only the net remainder stays open
   * and the signed balance is unchanged.
   *
   * A share that straddles the offset boundary is split in two: the offset
   * part becomes a new settled share on the same expense and the original
   * keeps the remainder, so the expense's shares still sum to its total.
   * Only shares whose creditor is one of the two parties and whose debtor
   * is the other are touched — shares owed to a third-party payer in a
   * group expense never offset each other.
   */
  async netWithCounterparty(
    userId: string,
    partyKey: string,
  ): Promise<NetResult> {
    if (!/^(user|contact):[A-Za-z0-9-]+$/.test(partyKey)) {
      throw new BadRequestException(
        'partyKey must be a counterparty key from GET /balances',
      );
    }
    const meKey = `user:${userId}`;

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

    interface OpenShare {
      id: string;
      expenseId: string;
      amount: number;
      userId: string | null;
      contactId: string | null;
      createdAt: Date;
    }
    const credit: OpenShare[] = []; // counterparty owes the user
    const debit: OpenShare[] = []; // user owes the counterparty

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
        if (!debtor || debtor.key === payer.key) continue;

        const open: OpenShare = {
          id: share.id,
          expenseId: expense.id,
          amount: share.amount,
          userId: share.userId,
          contactId: share.contactId,
          createdAt: share.createdAt,
        };
        if (payer.key === meKey && debtor.key === partyKey) credit.push(open);
        else if (payer.key === partyKey && debtor.key === meKey) {
          debit.push(open);
        }
      }
    }

    const byAge = (a: OpenShare, b: OpenShare) =>
      a.createdAt.getTime() - b.createdAt.getTime() ||
      a.id.localeCompare(b.id);
    credit.sort(byAge);
    debit.sort(byAge);

    const sum = (list: OpenShare[]) =>
      list.reduce((acc, s) => acc + s.amount, 0);
    const offset = Math.min(sum(credit), sum(debit));
    const balance = sum(credit) - sum(debit);
    if (offset === 0) return { offsetAmount: 0, balance, settledShares: 0 };

    let settledShares = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const side of [credit, debit]) {
        let budget = offset;
        for (const share of side) {
          if (budget === 0) break;
          if (share.amount <= budget) {
            await tx.expenseShare.update({
              where: { id: share.id },
              data: { isPaid: true },
            });
            budget -= share.amount;
            settledShares += 1;
          } else {
            await tx.expenseShare.update({
              where: { id: share.id },
              data: { amount: share.amount - budget },
            });
            await tx.expenseShare.create({
              data: {
                amount: budget,
                isPaid: true,
                expenseId: share.expenseId,
                userId: share.userId,
                contactId: share.contactId,
              },
            });
            budget = 0;
            settledShares += 1;
          }
        }
      }
    });

    if (offset > 0) {
      void this.notifyNetResult(userId, partyKey, offset, balance);
    }
    return { offsetAmount: offset, balance, settledShares };
  }
}
