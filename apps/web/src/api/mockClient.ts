import { equalSplit, isValidCustomSplit } from '../lib/split';
import { computeSettlePlan } from '../lib/settlePlan';
import {
  contactPartyKey,
  payerPartyKey,
  sharePartyKey,
  userPartyKey,
} from '../lib/parties';
import { ApiError, type ApiClient } from './client';
import type {
  Balance,
  Contact,
  CreateContactInput,
  CreateExpenseInput,
  CreateGroupExpenseInput,
  CreateGroupExpenseResult,
  Expense,
  Me,
  NetResult,
  PhoneLinkResult,
  SettlePlan,
  SettleTransferInput,
  SettleTransferResult,
  Share,
} from './types';

/**
 * ⚠️ LOCAL DEMO ONLY — in-memory fake backend used when the app is opened
 * with ?mock=1 outside Telegram. All data below is invented sample data;
 * nothing is sent anywhere and everything resets on reload. The UI shows a
 * permanent "demo mode" banner whenever this client is active.
 */

const ME_ID = 'mock-me';
const now = Date.now();
const iso = (daysAgo: number) =>
  new Date(now - daysAgo * 24 * 3600 * 1000).toISOString();

let seq = 100;
const nextId = (prefix: string) => `${prefix}-mock-${++seq}`;

function fakePhone(seed: number): string {
  return `+98912${String(1000000 + seed * 137).slice(0, 7)}`;
}

export class MockApiClient implements ApiClient {
  private me: Me = {
    id: ME_ID,
    telegramId: '0',
    username: 'demo_user',
    firstName: 'کاربر',
    lastName: 'نمایشی',
    phone: null,
  };

  private contacts: Contact[] = [
    this.makeContact('علی رضایی', 1, 'mock-user-ali'),
    this.makeContact('سارا محمدی', 2, null),
    this.makeContact('رضا کریمی', 3, null),
    this.makeContact('مریم احمدی', 4, null),
  ];

  private expenses: Expense[] = [];

  constructor() {
    // Seed: two sample expenses so the dashboard isn't empty in demo mode.
    const [ali, sara, reza] = this.contacts;
    this.seedExpense(
      'ناهار تیمی (نمایشی)',
      450000,
      null,
      [
        { userId: ME_ID, amount: 150000, paid: true },
        { contact: ali, amount: 150000, paid: false },
        { contact: sara, amount: 150000, paid: false },
      ],
      2,
    );
    this.seedExpense(
      'اسنپ برگشت (نمایشی)',
      120000,
      reza,
      [
        { userId: ME_ID, amount: 60000, paid: false },
        { contact: reza, amount: 60000, paid: true },
      ],
      5,
    );
  }

  private makeContact(
    name: string,
    seed: number,
    linkedUserId: string | null,
  ): Contact {
    return {
      id: nextId('contact'),
      name,
      phone: fakePhone(seed),
      linkedUserId,
      ownerId: ME_ID,
      createdAt: iso(30 - seed),
      linkedUser: linkedUserId
        ? {
            id: linkedUserId,
            firstName: name.split(' ')[0],
            lastName: name.split(' ')[1] ?? null,
            username: null,
          }
        : null,
    };
  }

  private seedExpense(
    title: string,
    totalAmount: number,
    payerContact: Contact | null,
    parts: {
      userId?: string;
      contact?: Contact;
      amount: number;
      paid: boolean;
    }[],
    daysAgo: number,
  ) {
    const id = nextId('expense');
    const shares: Share[] = parts.map((p) => ({
      id: nextId('share'),
      amount: p.amount,
      isPaid: p.paid,
      expenseId: id,
      userId: p.userId ?? null,
      contactId: p.contact?.id ?? null,
      createdAt: iso(daysAgo),
      user: p.userId
        ? {
            id: p.userId,
            firstName: this.me.firstName,
            lastName: this.me.lastName,
            username: this.me.username,
          }
        : null,
      contact: p.contact
        ? {
            id: p.contact.id,
            name: p.contact.name,
            linkedUserId: p.contact.linkedUserId,
          }
        : null,
    }));
    this.expenses.unshift({
      id,
      title,
      totalAmount,
      payerId: payerContact ? null : ME_ID,
      payerContactId: payerContact?.id ?? null,
      createdById: ME_ID,
      createdAt: iso(daysAgo),
      payer: payerContact
        ? null
        : {
            id: ME_ID,
            firstName: this.me.firstName,
            lastName: this.me.lastName,
            username: this.me.username,
          },
      payerContact: payerContact
        ? {
            id: payerContact.id,
            name: payerContact.name,
            linkedUserId: payerContact.linkedUserId,
          }
        : null,
      shares,
    });
  }

  private contactById(id: string): Contact {
    const c = this.contacts.find((x) => x.id === id);
    if (!c) throw new ApiError(400, 'contact not in your contact list');
    return c;
  }

  async getMe(): Promise<Me> {
    return { ...this.me };
  }

  async listContacts(): Promise<Contact[]> {
    return [...this.contacts].sort((a, b) => a.name.localeCompare(b.name, 'fa'));
  }

  async listRecentContacts(): Promise<Contact[]> {
    const counts = new Map<string, number>();
    for (const e of this.expenses)
      for (const s of e.shares)
        if (s.contactId)
          counts.set(s.contactId, (counts.get(s.contactId) ?? 0) + 1);
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, usageCount]) => ({ ...this.contactById(id), usageCount }));
  }

  async createContact(input: CreateContactInput): Promise<Contact> {
    const name = input.name.trim();
    if (this.contacts.some((c) => c.name === name)) {
      throw new ApiError(409, 'You already have a contact with this name');
    }
    const contact = this.makeContact(
      name,
      this.contacts.length + 1,
      null,
    );
    if (input.phone) contact.phone = input.phone;
    this.contacts.push(contact);
    return contact;
  }

  async sharePhone(phone: string): Promise<PhoneLinkResult> {
    this.me = { ...this.me, phone };
    return { phone, linkedContactIds: [], linkedCount: 0 };
  }

  async listExpenses(): Promise<Expense[]> {
    return [...this.expenses];
  }

  async createExpense(input: CreateExpenseInput): Promise<Expense> {
    const { participants } = input;
    const withAmounts = participants.filter((p) => p.amount !== undefined);
    let amounts: number[];
    if (withAmounts.length === 0) {
      amounts = equalSplit(input.totalAmount, participants.length);
    } else {
      amounts = participants.map((p) => p.amount as number);
      if (!isValidCustomSplit(input.totalAmount, amounts)) {
        throw new ApiError(400, 'Custom split amounts must sum up to totalAmount');
      }
    }
    const payerContact = input.payerContactId
      ? this.contactById(input.payerContactId)
      : null;
    const payerKey = payerContact
      ? contactPartyKey(payerContact)
      : userPartyKey(ME_ID);

    const id = nextId('expense');
    const shares: Share[] = participants.map((p, i) => {
      const contact = p.contactId ? this.contactById(p.contactId) : null;
      const holderKey = p.userId
        ? userPartyKey(p.userId)
        : contactPartyKey(contact as Contact);
      return {
        id: nextId('share'),
        amount: amounts[i],
        isPaid: holderKey === payerKey,
        expenseId: id,
        userId: p.userId ?? null,
        contactId: p.contactId ?? null,
        createdAt: iso(0),
        user: p.userId
          ? {
              id: p.userId,
              firstName: this.me.firstName,
              lastName: this.me.lastName,
              username: this.me.username,
            }
          : null,
        contact: contact
          ? {
              id: contact.id,
              name: contact.name,
              linkedUserId: contact.linkedUserId,
            }
          : null,
      };
    });

    const expense: Expense = {
      id,
      title: input.title,
      totalAmount: input.totalAmount,
      payerId: payerContact ? null : ME_ID,
      payerContactId: payerContact?.id ?? null,
      createdById: ME_ID,
      createdAt: iso(0),
      payer: payerContact
        ? null
        : {
            id: ME_ID,
            firstName: this.me.firstName,
            lastName: this.me.lastName,
            username: this.me.username,
          },
      payerContact: payerContact
        ? {
            id: payerContact.id,
            name: payerContact.name,
            linkedUserId: payerContact.linkedUserId,
          }
        : null,
      shares,
    };
    this.expenses.unshift(expense);
    return expense;
  }

  /**
   * Mirrors POST /expenses/group: one expense per payer (equal split),
   * then the trip's settlement plan from the new shares' nets.
   */
  async createGroupExpense(
    input: CreateGroupExpenseInput,
  ): Promise<CreateGroupExpenseResult> {
    const { participants, payers } = input;
    if (participants.length < 2) {
      throw new ApiError(400, 'At least two participants are required');
    }
    if (payers.length < 2) {
      throw new ApiError(400, 'At least two payers are required');
    }
    const participantKeys = new Set(
      participants.map((p) =>
        p.userId
          ? userPartyKey(p.userId)
          : contactPartyKey(this.contactById(p.contactId as string)),
      ),
    );
    for (const payer of payers) {
      const key = payer.userId
        ? userPartyKey(payer.userId)
        : contactPartyKey(this.contactById(payer.contactId as string));
      if (!participantKeys.has(key)) {
        throw new ApiError(
          400,
          'Each payer must be one of the participants',
        );
      }
    }

    const created: Expense[] = [];
    for (const payer of payers) {
      const expense = await this.createExpense({
        title: input.title,
        totalAmount: payer.amount,
        payerContactId: payer.contactId,
        participants: participants.map((p) => ({ ...p })),
      });
      created.push(expense);
    }

    // Nets from the new shares only: paid − share per party.
    const nets = new Map<string, number>();
    for (const expense of created) {
      const pKey = payerPartyKey(expense);
      if (!pKey) continue;
      for (const s of expense.shares) {
        if (s.isPaid) continue;
        const dKey = sharePartyKey(s);
        if (!dKey || dKey === pKey) continue;
        nets.set(pKey, (nets.get(pKey) ?? 0) + s.amount);
        nets.set(dKey, (nets.get(dKey) ?? 0) - s.amount);
      }
    }
    const parties = [...participantKeys]
      .map((key) => ({ key, balance: nets.get(key) ?? 0 }))
      .sort((a, b) => b.balance - a.balance);
    const transfers = computeSettlePlan(parties);
    return {
      expenses: created,
      plan: {
        transfers,
        parties,
        totalAmount: transfers.reduce((sum, t) => sum + t.amount, 0),
      },
    };
  }

  async getBalances(): Promise<Balance[]> {
    const meKey = userPartyKey(ME_ID);
    const totals = new Map<string, Balance>();
    const add = (key: string, name: string, delta: number) => {
      const cur = totals.get(key);
      if (cur) cur.balance += delta;
      else totals.set(key, { key, name, balance: delta });
    };
    for (const e of this.expenses) {
      const pKey = payerPartyKey(e);
      if (!pKey) continue;
      for (const s of e.shares) {
        if (s.isPaid) continue;
        const dKey = sharePartyKey(s);
        if (!dKey || dKey === pKey) continue;
        const debtorName = s.contact?.name ?? this.me.firstName;
        const payerName = e.payerContact?.name ?? this.me.firstName;
        if (pKey === meKey) add(dKey, debtorName, s.amount);
        else if (dKey === meKey) add(pKey, payerName, -s.amount);
      }
    }
    return [...totals.values()]
      .filter((b) => b.balance !== 0)
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  }

  /** Mirrors the server's netting: both directions cancel up to the smaller total. */
  async netWithCounterparty(partyKey: string): Promise<NetResult> {
    const meKey = userPartyKey(ME_ID);
    const credit: { expense: Expense; share: Share }[] = [];
    const debit: { expense: Expense; share: Share }[] = [];
    for (const e of this.expenses) {
      const pKey = payerPartyKey(e);
      if (!pKey) continue;
      for (const s of e.shares) {
        if (s.isPaid) continue;
        const dKey = sharePartyKey(s);
        if (!dKey || dKey === pKey) continue;
        if (pKey === meKey && dKey === partyKey) credit.push({ expense: e, share: s });
        else if (pKey === partyKey && dKey === meKey) debit.push({ expense: e, share: s });
      }
    }
    const byAge = (
      a: { share: Share },
      b: { share: Share },
    ) =>
      a.share.createdAt.localeCompare(b.share.createdAt) ||
      a.share.id.localeCompare(b.share.id);
    credit.sort(byAge);
    debit.sort(byAge);
    const sum = (list: { share: Share }[]) =>
      list.reduce((acc, x) => acc + x.share.amount, 0);
    const offset = Math.min(sum(credit), sum(debit));
    const balance = sum(credit) - sum(debit);
    if (offset === 0) return { offsetAmount: 0, balance, settledShares: 0 };

    let settledShares = 0;
    for (const side of [credit, debit]) {
      let budget = offset;
      for (const { expense, share } of side) {
        if (budget === 0) break;
        if (share.amount <= budget) {
          share.isPaid = true;
          budget -= share.amount;
          settledShares += 1;
        } else {
          const piece: Share = {
            ...share,
            id: nextId('share'),
            amount: budget,
            isPaid: true,
          };
          share.amount -= budget;
          expense.shares.push(piece);
          budget = 0;
          settledShares += 1;
        }
      }
    }
    return { offsetAmount: offset, balance, settledShares };
  }

  /** Mirrors the server's group settlement: nets across the selected set, then the greedy plan. */
  async getSettlePlan(partyKeys: string[]): Promise<SettlePlan> {
    const meKey = userPartyKey(ME_ID);
    const keys = new Set<string>([meKey, ...partyKeys]);
    if (keys.size < 2) {
      throw new ApiError(
        400,
        'Select at least one other person to settle with',
      );
    }
    for (const key of [...keys]) {
      if (!key.startsWith('contact:')) continue;
      const contact = this.contacts.find(
        (c) => c.id === key.slice('contact:'.length),
      );
      if (contact?.linkedUserId) {
        keys.delete(key);
        keys.add(userPartyKey(contact.linkedUserId));
      }
    }
    const nets = new Map<string, number>();
    for (const e of this.expenses) {
      const pKey = payerPartyKey(e);
      if (!pKey || !keys.has(pKey)) continue;
      for (const s of e.shares) {
        if (s.isPaid) continue;
        const dKey = sharePartyKey(s);
        if (!dKey || dKey === pKey || !keys.has(dKey)) continue;
        nets.set(pKey, (nets.get(pKey) ?? 0) + s.amount);
        nets.set(dKey, (nets.get(dKey) ?? 0) - s.amount);
      }
    }
    const parties = [...keys]
      .map((key) => ({ key, balance: nets.get(key) ?? 0 }))
      .sort((a, b) => b.balance - a.balance);
    const transfers = computeSettlePlan(parties);
    return {
      transfers,
      parties,
      totalAmount: transfers.reduce((sum, t) => sum + t.amount, 0),
    };
  }

  /** Mirrors the server's settle-transfer: the debtor's open shares to the creditor, within the given expenses, settle up to the amount (splitting a straddling share). */
  async settleTransfer(
    input: SettleTransferInput,
  ): Promise<SettleTransferResult> {
    if (input.fromKey === input.toKey) {
      throw new ApiError(400, 'fromKey and toKey must differ');
    }
    const resolveKey = (key: string): string => {
      if (!key.startsWith('contact:')) return key;
      const contact = this.contacts.find(
        (c) => c.id === key.slice('contact:'.length),
      );
      return contact?.linkedUserId
        ? userPartyKey(contact.linkedUserId)
        : key;
    };
    const fromKey = resolveKey(input.fromKey);
    const toKey = resolveKey(input.toKey);
    const owed: { expense: Expense; share: Share }[] = [];
    for (const e of this.expenses) {
      if (!input.expenseIds.includes(e.id)) continue;
      const pKey = payerPartyKey(e);
      if (!pKey || pKey !== toKey) continue;
      for (const s of e.shares) {
        if (s.isPaid) continue;
        const dKey = sharePartyKey(s);
        if (!dKey || dKey !== fromKey) continue;
        owed.push({ expense: e, share: s });
      }
    }
    owed.sort(
      (a, b) =>
        a.share.createdAt.localeCompare(b.share.createdAt) ||
        a.share.id.localeCompare(b.share.id),
    );
    let budget = input.amount;
    let settledShares = 0;
    for (const { expense, share } of owed) {
      if (budget === 0) break;
      if (share.amount <= budget) {
        share.isPaid = true;
        budget -= share.amount;
        settledShares += 1;
      } else {
        const piece: Share = {
          ...share,
          id: nextId('share'),
          amount: budget,
          isPaid: true,
        };
        share.amount -= budget;
        expense.shares.push(piece);
        budget = 0;
        settledShares += 1;
      }
    }
    return {
      settledAmount: input.amount - budget,
      remainingAmount: budget,
      settledShares,
    };
  }

  async settleShare(shareId: string): Promise<void> {
    for (const e of this.expenses) {
      const share = e.shares.find((s) => s.id === shareId);
      if (share) {
        share.isPaid = true;
        return;
      }
    }
    throw new ApiError(404, 'Share not found');
  }

  async unsettleShare(shareId: string): Promise<void> {
    for (const e of this.expenses) {
      const share = e.shares.find((s) => s.id === shareId);
      if (share) {
        share.isPaid = false;
        return;
      }
    }
    throw new ApiError(404, 'Share not found');
  }

  async deleteExpense(id: string): Promise<void> {
    const idx = this.expenses.findIndex((e) => e.id === id);
    if (idx === -1) throw new ApiError(404, 'Expense not found');
    this.expenses.splice(idx, 1);
  }

  async deleteContact(id: string): Promise<void> {
    const used = this.expenses.some(
      (e) =>
        e.payerContactId === id ||
        e.shares.some((s) => s.contactId === id),
    );
    if (used) {
      throw new ApiError(
        400,
        'This contact is used in expenses and cannot be deleted',
      );
    }
    const idx = this.contacts.findIndex((c) => c.id === id);
    if (idx === -1) throw new ApiError(404, 'Contact not found');
    this.contacts.splice(idx, 1);
  }
}
