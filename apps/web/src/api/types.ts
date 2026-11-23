/** Response shapes of the Phase 1/2 API (apps/api). Keep in sync with the backend. */

export interface PublicUser {
  id: string;
  firstName: string;
  lastName: string | null;
  username: string | null;
}

export interface Me {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  /** Normalized (+98…) once the user shared their number; null before that. */
  phone: string | null;
}

export interface Contact {
  id: string;
  name: string;
  phone: string | null;
  linkedUserId: string | null;
  ownerId: string;
  createdAt: string;
  linkedUser: PublicUser | null;
  /** Present only on GET /contacts/recent responses. */
  usageCount?: number;
}

export interface Share {
  id: string;
  amount: number;
  isPaid: boolean;
  expenseId: string;
  userId: string | null;
  contactId: string | null;
  createdAt: string;
  user: PublicUser | null;
  contact: { id: string; name: string; linkedUserId: string | null } | null;
}

export interface Expense {
  id: string;
  title: string;
  totalAmount: number;
  payerId: string | null;
  payerContactId: string | null;
  createdById: string;
  createdAt: string;
  payer: PublicUser | null;
  payerContact: { id: string; name: string; linkedUserId: string | null } | null;
  shares: Share[];
}

export interface Balance {
  /** "user:<id>" or "contact:<id>" — a linked contact resolves to its user. */
  key: string;
  userId?: string;
  contactId?: string;
  name: string;
  /** Positive: they owe me. Negative: I owe them. */
  balance: number;
}

export interface PhoneLinkResult {
  phone: string;
  linkedContactIds: string[];
  linkedCount: number;
}

/** Result of «کم و وجه» (netting) with one counterparty. */
export interface NetResult {
  /** Amount crossed out on EACH side (both sides lose exactly this much). */
  offsetAmount: number;
  /** Net balance after netting (netting never changes it). Positive: they owe me. */
  balance: number;
  /** Shares marked settled, including pieces created by splitting. */
  settledShares: number;
}

/** «تسویه گروهی»: one party's net across the selected group. */
export interface SettlePlanParty {
  /** "user:<id>" or "contact:<id>" — matches GET /balances keys. */
  key: string;
  /** Positive: this party is owed money. Negative: this party owes money. */
  balance: number;
}

/** «تسویه گروهی»: one transfer of the plan (debtor pays creditor). */
export interface SettlePlanTransfer {
  fromKey: string;
  toKey: string;
  amount: number;
}

/** «تسویه گروهی»: the minimum-transaction plan for a group of people. */
export interface SettlePlan {
  /** The transfers, in order; executing them zeroes every party's net. */
  transfers: SettlePlanTransfer[];
  /** Every selected party's net (including zeroes), highest first. */
  parties: SettlePlanParty[];
  /** Sum of all transfer amounts. */
  totalAmount: number;
}

export interface ParticipantInput {
  userId?: string;
  contactId?: string;
  /** Set for custom splits only; omit for equal split. */
  amount?: number;
}

export interface CreateExpenseInput {
  title: string;
  totalAmount: number;
  payerContactId?: string;
  participants: ParticipantInput[];
}

/** «چندپرداخت‌کننده»: how much one participant of a group expense paid. */
export interface GroupPayerInput {
  userId?: string;
  contactId?: string;
  amount: number;
}

/** «چندپرداخت‌کننده»: one form, several payers; total = sum of paid. */
export interface CreateGroupExpenseInput {
  title: string;
  participants: ParticipantInput[];
  payers: GroupPayerInput[];
}

/** Result of creating a multi-payer group expense: the sub-expenses plus the trip's settlement plan. */
export interface CreateGroupExpenseResult {
  expenses: Expense[];
  plan: SettlePlan;
}

export interface CreateContactInput {
  name: string;
  phone?: string;
}
