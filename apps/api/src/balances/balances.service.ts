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
import { computeSettlePlan } from './settle-plan.util';

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

export interface SettlePlanParty {
  key: string;
  /**
   * Net across the selected group's open shares. Positive: this party is
   * owed money. Negative: this party owes money. All nets sum to zero.
   */
  balance: number;
}

export interface SettlePlanTransfer {
  /** Debtor — pays this amount. */
  fromKey: string;
  /** Creditor — receives this amount. */
  toKey: string;
  amount: number;
}

export interface SettlePlan {
  /** The transfers, in order; executing them zeroes every party's net. */
  transfers: SettlePlanTransfer[];
  /** Every selected party's net (including zeroes), highest first. */
  parties: SettlePlanParty[];
  /** Sum of all transfer amounts. */
  totalAmount: number;
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

  /**
   * Settle one transfer of a settlement plan: the debtor (fromKey) pays
   * the creditor (toKey) `amount`, scoped to the given expenses (one group
   * expense's sub-expenses). The debtor's open shares to the creditor in
   * those expenses are marked settled, oldest first, splitting a share
   * when only part of it is covered — the same split «کم و وجه» uses.
   * A payment only ever reduces what the debtor owes the creditor; it
   * never creates a reverse debt. If the debtor owes the creditor less
   * than `amount` inside these expenses, only that much is settled and
   * the remainder is reported (the plan recomputes from the open shares).
   */
  async settleTransfer(
    userId: string,
    dto: { fromKey: string; toKey: string; amount: number; expenseIds: string[] },
  ): Promise<{
    settledAmount: number;
    remainingAmount: number;
    settledShares: number;
  }> {
    if (dto.fromKey === dto.toKey) {
      throw new BadRequestException('fromKey and toKey must differ');
    }
    // Resolve a linked contact key to its user, so a stale contact key
    // still settles against the right party (same as getSettlePlan).
    const resolveKey = async (key: string): Promise<string> => {
      if (!key.startsWith('contact:')) return key;
      const contact = await this.prisma.contact.findUnique({
        where: { id: key.slice('contact:'.length) },
        select: { linkedUserId: true },
      });
      return contact?.linkedUserId
        ? `user:${contact.linkedUserId}`
        : key;
    };
    const fromKey = await resolveKey(dto.fromKey);
    const toKey = await resolveKey(dto.toKey);
    const meKey = `user:${userId}`;

    const expenses = await this.prisma.expense.findMany({
      where: { id: { in: dto.expenseIds } },
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
    if (expenses.length !== dto.expenseIds.length) {
      throw new NotFoundException('One or more expenses were not found');
    }
    // Only the group creator, the debtor or the creditor may settle a
    // transfer of this group.
    for (const expense of expenses) {
      const allowed =
        expense.createdById === userId ||
        meKey === fromKey ||
        meKey === toKey;
      if (!allowed) {
        throw new ForbiddenException(
          'Only the creator, the debtor or the creditor can settle this transfer',
        );
      }
    }

    interface OpenShare {
      id: string;
      expenseId: string;
      amount: number;
      userId: string | null;
      contactId: string | null;
      createdAt: Date;
    }
    const owed: OpenShare[] = [];
    for (const expense of expenses) {
      const payer: Party | null = expense.payer
        ? partyFromUser(expense.payer)
        : expense.payerContact
          ? partyFromContact(expense.payerContact)
          : null;
      if (!payer || payer.key !== toKey) continue;
      for (const share of expense.shares) {
        const debtor: Party | null = share.user
          ? partyFromUser(share.user)
          : share.contact
            ? partyFromContact(share.contact)
            : null;
        if (!debtor || debtor.key !== fromKey) continue;
        owed.push({
          id: share.id,
          expenseId: expense.id,
          amount: share.amount,
          userId: share.userId,
          contactId: share.contactId,
          createdAt: share.createdAt,
        });
      }
    }
    owed.sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    );

    let budget = dto.amount;
    let settledShares = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const share of owed) {
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
    });

    const settledAmount = dto.amount - budget;
    if (settledAmount > 0) {
      void this.notifyTransferSettled(userId, fromKey, toKey, settledAmount);
    }
    return {
      settledAmount,
      remainingAmount: budget,
      settledShares,
    };
  }

  /** DM the debtor and creditor (except the actor) that a transfer was settled. */
  private async notifyTransferSettled(
    actorId: string,
    fromKey: string,
    toKey: string,
    amount: number,
  ) {
    if (!this.notify) return;
    const notify = this.notify;
    try {
      const actor = await notify.nameOf(actorId);
      const amountFa = formatTomanFa(amount);
      const userIdOf = (key: string) =>
        key.startsWith('user:') ? key.slice('user:'.length) : null;
      const debtorId = userIdOf(fromKey);
      const creditorId = userIdOf(toKey);
      if (creditorId && creditorId !== actorId) {
        void notify.notifyUser(
          creditorId,
          `✅ ${actor} تسویه رو ثبت کرد: ${amountFa} تومان به تو پرداخت شد.`,
        );
      }
      if (debtorId && debtorId !== actorId) {
        void notify.notifyUser(
          debtorId,
          `✅ ${actor} پرداخت ${amountFa} تومان تو رو تسویه‌شده زد.`,
        );
      }
    } catch {
      // notifications are best-effort only
    }
  }

  /**
   * «تسویه گروهی» — the minimum-transaction plan for a set of people.
   * Each party's net is computed across the open shares where BOTH the
   * payer and the debtor are in the selected set; shares with anyone
   * outside the set are excluded, so the nets always sum to zero. The
   * current user is always included. Names are resolved on the client
   * from GET /balances (the keys match exactly).
   */
  async getSettlePlan(
    userId: string,
    partyKeys: string[],
  ): Promise<SettlePlan> {
    const meKey = `user:${userId}`;
    const keys = new Set<string>([meKey]);
    for (const key of partyKeys) {
      if (!/^(user|contact):[A-Za-z0-9-]+$/.test(key)) {
        throw new BadRequestException(
          'partyKey must be a counterparty key from GET /balances',
        );
      }
      keys.add(key);
    }
    if (keys.size < 2) {
      throw new BadRequestException(
        'Select at least one other person to settle with',
      );
    }

    // A linked contact resolves to its user (GET /balances already does
    // this, but resolve defensively so a stale contact key still settles
    // against the right party).
    const contactIds = [...keys]
      .filter((k) => k.startsWith('contact:'))
      .map((k) => k.slice('contact:'.length));
    if (contactIds.length > 0) {
      const linked = await this.prisma.contact.findMany({
        where: { id: { in: contactIds } },
        select: { id: true, linkedUserId: true },
      });
      for (const c of linked) {
        if (c.linkedUserId) {
          keys.delete(`contact:${c.id}`);
          keys.add(`user:${c.linkedUserId}`);
        }
      }
    }

    const expenses = await this.prisma.expense.findMany({
      where: {
        OR: [
          { payerId: userId },
          { payerContact: { linkedUserId: userId } },
          { shares: { some: { userId } } },
          { shares: { some: { contact: { linkedUserId: userId } } } },
          // Expenses the user recorded between other people (e.g. a
          // contact paid for two other contacts on the trip).
          { createdById: userId },
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

    const nets = new Map<string, number>();
    for (const expense of expenses) {
      const payer: Party | null = expense.payer
        ? partyFromUser(expense.payer)
        : expense.payerContact
          ? partyFromContact(expense.payerContact)
          : null;
      if (!payer || !keys.has(payer.key)) continue;

      for (const share of expense.shares) {
        const debtor: Party | null = share.user
          ? partyFromUser(share.user)
          : share.contact
            ? partyFromContact(share.contact)
            : null;
        if (!debtor || debtor.key === payer.key || !keys.has(debtor.key)) {
          continue;
        }
        nets.set(payer.key, (nets.get(payer.key) ?? 0) + share.amount);
        nets.set(debtor.key, (nets.get(debtor.key) ?? 0) - share.amount);
      }
    }

    const parties: SettlePlanParty[] = [...keys]
      .map((key) => ({ key, balance: nets.get(key) ?? 0 }))
      .sort((a, b) => b.balance - a.balance);
    const transfers = computeSettlePlan(parties);
    return {
      transfers,
      parties,
      totalAmount: transfers.reduce((sum, t) => sum + t.amount, 0),
    };
  }
}
