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

export interface CreateContactInput {
  name: string;
  phone?: string;
}
