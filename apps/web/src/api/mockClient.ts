import { equalSplit, isValidCustomSplit } from '../lib/split';
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
  Expense,
  Me,
  PhoneLinkResult,
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
}
