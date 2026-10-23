import type { Expense, Share } from '../api/types';
import { formatToman } from './format';

/**
 * Party identity helpers — mirror the backend's party resolution
 * (apps/api balances/expenses services): a contact that has been linked to
 * a real user resolves to that user; an unlinked contact is its own party.
 * Keys match GET /balances keys exactly ("user:<id>" / "contact:<id>").
 */

export function userPartyKey(userId: string): string {
  return `user:${userId}`;
}

export function contactPartyKey(contact: {
  id: string;
  linkedUserId: string | null;
}): string {
  return contact.linkedUserId
    ? `user:${contact.linkedUserId}`
    : `contact:${contact.id}`;
}

export function sharePartyKey(share: Share): string | null {
  if (share.user) return userPartyKey(share.user.id);
  if (share.userId) return userPartyKey(share.userId);
  if (share.contact) return contactPartyKey(share.contact);
  if (share.contactId) return `contact:${share.contactId}`;
  return null;
}

export function payerPartyKey(expense: Expense): string | null {
  if (expense.payer) return userPartyKey(expense.payer.id);
  if (expense.payerId) return userPartyKey(expense.payerId);
  if (expense.payerContact) return contactPartyKey(expense.payerContact);
  if (expense.payerContactId) return `contact:${expense.payerContactId}`;
  return null;
}

export function personName(user: {
  firstName: string;
  lastName: string | null;
}): string {
  return [user.firstName, user.lastName].filter(Boolean).join(' ');
}

export function shareDisplayName(share: Share, myName: string): string {
  if (share.user) return personName(share.user);
  if (share.contact) return share.contact.name;
  return myName;
}

export function payerDisplayName(expense: Expense, myName: string): string {
  if (expense.payer) return personName(expense.payer);
  if (expense.payerContact) return expense.payerContact.name;
  return myName;
}

/**
 * May the current user mark this share settled? Mirrors the backend rule
 * (BalancesService.settleShare): the payer, the expense creator, or the
 * share's holder — each resolved through linked contacts.
 */
export function canSettleShare(
  expense: Expense,
  share: Share,
  myUserId: string,
): boolean {
  if (share.isPaid) return false;
  return (
    expense.payerId === myUserId ||
    expense.createdById === myUserId ||
    expense.payerContact?.linkedUserId === myUserId ||
    share.userId === myUserId ||
    share.contact?.linkedUserId === myUserId
  );
}

/** The share in this expense that belongs to the current user, if any. */
export function myShareOf(expense: Expense, myUserId: string): Share | null {
  const myKey = userPartyKey(myUserId);
  return expense.shares.find((s) => sharePartyKey(s) === myKey) ?? null;
}

/**
 * My outstanding net for one expense (dashboard transaction rows):
 * I paid -> others' still-unpaid shares are + (owed to me);
 * someone else paid -> my still-unpaid share is − (I owe).
 * 0 means nothing outstanding between me and this expense.
 */
export function myNetForExpense(expense: Expense, myUserId: string): number {
  const myKey = userPartyKey(myUserId);
  const pKey = payerPartyKey(expense);
  if (!pKey) return 0;
  let net = 0;
  for (const share of expense.shares) {
    if (share.isPaid) continue;
    const dKey = sharePartyKey(share);
    if (!dKey || dKey === pKey) continue;
    if (pKey === myKey) net += share.amount;
    else if (dKey === myKey) net -= share.amount;
  }
  return net;
}

/**
 * "سهم هر نفر" label for a transaction row, as in the mockups: when every
 * share is equal it's the per-person amount; otherwise it's my own share.
 */
export function perPersonLabel(expense: Expense, myUserId: string): string {
  const amounts = expense.shares.map((s) => s.amount);
  if (amounts.length > 0 && amounts.every((a) => a === amounts[0])) {
    return `سهم هر نفر: ${formatToman(amounts[0])}`;
  }
  const mine = myShareOf(expense, myUserId);
  if (mine) return `سهم تو: ${formatToman(mine.amount)}`;
  return amounts.length > 0
    ? `سهم هر نفر: ${formatToman(amounts[0])}`
    : '';
}

/** Display names of all participants of an expense (for avatar stacks). */
export function participantNames(
  expense: Expense,
  myName: string,
): string[] {
  return expense.shares.map((s) => shareDisplayName(s, myName));
}
