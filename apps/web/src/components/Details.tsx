import { useEffect, useRef, useState } from 'react';
import { Button, List, Modal, Section, Text } from '@telegram-apps/telegram-ui';
import type { Balance, Expense } from '../api/types';
import { friendlyError } from '../api/client';
import { formatDateFa, formatSignedToman, formatToman } from '../lib/format';
import { GREEN, RED } from '../lib/theme';
import { hapticError, hapticSuccess } from '../telegram/actions';
import {
  payerDisplayName,
  payerPartyKey,
  sharePartyKey,
  userPartyKey,
} from '../lib/parties';
import {
  groupPaidBy,
  groupPartyTotals,
  groupPlan,
  groupShareLabel,
  groupTotal,
} from '../lib/groupExpenses';
import { DeleteButton, ShareRow } from './ui';
import { useAppState } from '../state/AppState';

/** Full expense view: summary + every share (with settle where allowed). */
export function ExpenseDetailModal({
  expense,
  onClose,
}: {
  expense: Expense | null;
  onClose: () => void;
}) {
  const { me, api, refresh } = useAppState();
  const [delError, setDelError] = useState<string | null>(null);
  const close = () => {
    setDelError(null);
    onClose();
  };
  return (
    <Modal
      open={!!expense}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      header={<Modal.Header>جزئیات هزینه</Modal.Header>}
    >
      {expense && me && (
        <div style={{ paddingBottom: 24 }}>
          <div style={{ padding: '4px 20px 0' }}>
            <Text style={{ fontSize: 18, fontWeight: 700 }}>
              {expense.title}
            </Text>
            <div style={{ opacity: 0.7, marginTop: 4, fontSize: 14 }}>
              پرداخت‌کننده: {payerDisplayName(expense, me.firstName)} ·{' '}
              {formatDateFa(expense.createdAt)}
            </div>
            <div style={{ marginTop: 6, fontWeight: 600 }}>
              مبلغ کل: {formatToman(expense.totalAmount)}
            </div>
          </div>
          <List>
            <Section header="سهم‌ها">
              {expense.shares.map((share) => (
                <ShareRow key={share.id} expense={expense} share={share} />
              ))}
            </Section>
          </List>
          {expense.createdById === me.id && (
            <div style={{ padding: '6px 16px 0' }}>
              <DeleteButton
                key={expense.id}
                label="🗑 حذف این خرج"
                onDelete={async () => {
                  await api.deleteExpense(expense.id);
                  close();
                  void refresh().catch(() => {});
                }}
                onError={setDelError}
              />
              {delError && (
                <div
                  style={{
                    color: RED,
                    fontSize: 13,
                    marginTop: 8,
                    textAlign: 'center',
                  }}
                >
                  {delError}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/**
 * Full view of one multi-payer («چندپرداخت‌کننده») group expense: the
 * group total, who paid what, each person's net and the minimum-
 * transaction settlement plan — recomputed from the stored sub-expenses.
 * Deleting removes every sub-expense of the group.
 */
export function GroupExpenseDetailModal({
  expenses,
  onClose,
}: {
  expenses: Expense[] | null;
  onClose: () => void;
}) {
  const { me, api, refresh } = useAppState();
  const [delError, setDelError] = useState<string | null>(null);
  const [settlingKey, setSettlingKey] = useState<string | null>(null);
  const [settleError, setSettleError] = useState<string | null>(null);
  /** The last transfer settled here, so a mistaken tap can be undone:
   * unsettling the shares the settle created re-opens the debt. */
  const [lastSettled, setLastSettled] = useState<{
    label: string;
    amount: number;
    shareIds: string[];
  } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const close = () => {
    setDelError(null);
    setSettleError(null);
    setLastSettled(null);
    onClose();
  };
  /** Settle one transfer of this group's plan; the plan recomputes from the
   * refreshed expenses, so the remaining transfers update. */
  const settleTransfer = async (
    fromKey: string,
    toKey: string,
    amount: number,
  ) => {
    if (!expenses || settlingKey) return;
    const key = `${fromKey}->${toKey}`;
    setSettlingKey(key);
    setSettleError(null);
    try {
      const res = await api.settleTransfer({
        fromKey,
        toKey,
        amount,
        expenseIds: expenses.map((e) => e.id),
      });
      if (res.settledAmount > 0) {
        setLastSettled({
          label: `${nameByKey.get(fromKey) ?? '؟'} به ${nameByKey.get(toKey) ?? '؟'}`,
          amount: res.settledAmount,
          shareIds: res.settledShareIds,
        });
      }
      hapticSuccess();
      await refresh().catch(() => {});
    } catch (err) {
      hapticError();
      setSettleError(friendlyError(err));
    } finally {
      setSettlingKey(null);
    }
  };
  /** Undo the last settle: re-open every share it settled. */
  const undoLastSettle = async () => {
    if (!lastSettled || undoing) return;
    setUndoing(true);
    setSettleError(null);
    try {
      for (const id of lastSettled.shareIds) {
        await api.unsettleShare(id);
      }
      hapticSuccess();
      setLastSettled(null);
      await refresh().catch(() => {});
    } catch (err) {
      hapticError();
      setSettleError(friendlyError(err));
    } finally {
      setUndoing(false);
    }
  };
  const totals =
    expenses && me ? groupPartyTotals(expenses, me.firstName) : [];
  const plan = expenses && me ? groupPlan(expenses, me.firstName) : null;
  const nameByKey = new Map(totals.map((t) => [t.key, t.name]));
  const paidBy =
    expenses && me ? groupPaidBy(expenses, me.firstName) : [];
  return (
    <Modal
      open={!!expenses}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      header={<Modal.Header>جزئیات خرج گروهی</Modal.Header>}
    >
      {expenses && me && (
        <div style={{ paddingBottom: 24 }}>
          <div style={{ padding: '4px 20px 0' }}>
            <Text style={{ fontSize: 18, fontWeight: 700 }}>
              {expenses[0].title}
            </Text>
            <div style={{ opacity: 0.7, marginTop: 4, fontSize: 14 }}>
              👥 چندپرداخت‌کننده · {formatDateFa(expenses[0].createdAt)}
            </div>
            <div style={{ marginTop: 6, fontWeight: 600 }}>
              مبلغ کل: {formatToman(groupTotal(expenses))}
            </div>
            <div style={{ marginTop: 2, fontWeight: 600 }}>
              {groupShareLabel(expenses, me.firstName)}
            </div>
          </div>
          <List>
            <Section header="هر نفر چقدر پرداخت کرد">
              {paidBy.map((p) => (
                <div
                  key={p.name}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '10px 20px',
                    fontSize: 15,
                  }}
                >
                  <span>{p.name}</span>
                  <b>{formatToman(p.amount)}</b>
                </div>
              ))}
            </Section>
            <Section header="خالص هر نفر">
              {totals.map((t) => (
                <div
                  key={t.key}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    padding: '10px 20px',
                    fontSize: 15,
                  }}
                >
                  <span>{t.name}</span>
                  <b style={{ color: t.balance > 0 ? GREEN : t.balance < 0 ? RED : undefined }}>
                    {formatSignedToman(t.balance)}
                  </b>
                </div>
              ))}
            </Section>
            <Section header="تسویه این خرج">
              {plan && plan.transfers.length === 0 && (
                <div style={{ padding: '8px 20px 16px', opacity: 0.7 }}>
                  تسویه شده ✅
                </div>
              )}
              {plan &&
                plan.transfers.map((t, i) => {
                  const tKey = `${t.fromKey}->${t.toKey}`;
                  return (
                    <div
                      key={`${t.fromKey}-${t.toKey}-${i}`}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 20px',
                        fontSize: 15,
                      }}
                    >
                      <span style={{ flex: 1 }}>
                        <b>{nameByKey.get(t.fromKey) ?? '؟'}</b> به{' '}
                        <b>{nameByKey.get(t.toKey) ?? '؟'}</b> بده
                      </span>
                      <b>{formatToman(t.amount)}</b>
                      <Button
                        size="s"
                        mode="outline"
                        loading={settlingKey === tKey}
                        disabled={settlingKey !== null}
                        onClick={() =>
                          void settleTransfer(t.fromKey, t.toKey, t.amount)
                        }
                      >
                        تسویه
                      </Button>
                    </div>
                  );
                })}
              {lastSettled && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 20px',
                    background: 'rgba(76, 175, 80, 0.08)',
                    fontSize: 14,
                  }}
                >
                  <span style={{ flex: 1 }}>
                    ✅ تسویه شد: {lastSettled.label}{' '}
                    {formatToman(lastSettled.amount)}
                  </span>
                  <Button
                    size="s"
                    mode="outline"
                    loading={undoing}
                    disabled={undoing}
                    onClick={() => void undoLastSettle()}
                  >
                    ↩️ لغو
                  </Button>
                </div>
              )}
              {settleError && (
                <div
                  style={{
                    padding: '0 20px 8px',
                    color: RED,
                    fontSize: 13,
                  }}
                >
                  {settleError}
                </div>
              )}
              <div
                style={{
                  padding: '4px 20px 12px',
                  fontSize: 13,
                  opacity: 0.6,
                }}
              >
                این تسویه فقط برای همین خرجه؛ بدهی‌ها و طلب‌های قبلی با این
                افراد جداگانه در تسویه حساب حساب می‌شن.
              </div>
            </Section>
          </List>
          {expenses[0].createdById === me.id && (
            <div style={{ padding: '6px 16px 0' }}>
              <DeleteButton
                key={expenses.map((e) => e.id).join('+')}
                label="🗑 حذف این خرج"
                onDelete={async () => {
                  for (const e of expenses) {
                    await api.deleteExpense(e.id);
                  }
                  close();
                  void refresh().catch(() => {});
                }}
                onError={setDelError}
              />
              {delError && (
                <div
                  style={{
                    color: RED,
                    fontSize: 13,
                    marginTop: 8,
                    textAlign: 'center',
                  }}
                >
                  {delError}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

/**
 * Per-person view from a balance row: net total plus every still-unsettled
 * share between me and that person (both directions), each settle-able.
 */
export function PersonDetailModal({
  balance,
  onClose,
}: {
  balance: Balance | null;
  onClose: () => void;
}) {
  const { me, expenses, api, refresh } = useAppState();
  const [netArmed, setNetArmed] = useState(false);
  const [netBusy, setNetBusy] = useState(false);
  const [netNote, setNetNote] = useState<string | null>(null);
  const [netError, setNetError] = useState<string | null>(null);
  const netTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const myKey = me ? userPartyKey(me.id) : null;

  // Fresh netting state whenever another person's account is opened.
  useEffect(() => {
    setNetArmed(false);
    setNetNote(null);
    setNetError(null);
  }, [balance?.key]);

  useEffect(
    () => () => {
      if (netTimer.current) clearTimeout(netTimer.current);
    },
    [],
  );

  const openShares: { expense: Expense; share: Expense['shares'][number] }[] =
    [];
  if (balance && myKey) {
    for (const expense of expenses) {
      const pKey = payerPartyKey(expense);
      for (const share of expense.shares) {
        if (share.isPaid) continue;
        const dKey = sharePartyKey(share);
        const betweenUs =
          (pKey === myKey && dKey === balance.key) ||
          (dKey === myKey && pKey === balance.key);
        if (betweenUs) openShares.push({ expense, share });
      }
    }
  }

  // «کم و وجه» preview: how much of the two directions cancels each other.
  let creditTotal = 0; // the counterparty owes me
  let debitTotal = 0; // I owe the counterparty
  if (myKey) {
    for (const { expense, share } of openShares) {
      if (payerPartyKey(expense) === myKey) creditTotal += share.amount;
      else debitTotal += share.amount;
    }
  }
  const offsetPreview = Math.min(creditTotal, debitTotal);

  const onNet = async () => {
    if (!balance) return;
    // Two-step like the other consequential actions: first tap arms it.
    if (!netArmed) {
      setNetArmed(true);
      if (netTimer.current) clearTimeout(netTimer.current);
      netTimer.current = setTimeout(() => setNetArmed(false), 4000);
      return;
    }
    setNetBusy(true);
    setNetError(null);
    try {
      const res = await api.netWithCounterparty(balance.key);
      hapticSuccess();
      if (res.balance === 0) {
        // Fully settled: the person leaves the balances list entirely.
        onClose();
        return;
      }
      setNetNote(
        `✓ ${formatToman(res.offsetAmount)} از هر دو طرف خط خورد؛ فقط خالص حساب موند.`,
      );
      void refresh().catch(() => {});
    } catch (err) {
      hapticError();
      setNetError(friendlyError(err));
    } finally {
      setNetBusy(false);
      setNetArmed(false);
    }
  };

  return (
    <Modal
      open={!!balance}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      header={<Modal.Header>جزئیات حساب</Modal.Header>}
    >
      {balance && (
        <div style={{ paddingBottom: 24 }}>
          <div style={{ padding: '4px 20px 0' }}>
            <Text style={{ fontSize: 18, fontWeight: 700 }}>
              {balance.name}
            </Text>
            <div
              style={{
                marginTop: 6,
                fontWeight: 700,
                color: balance.balance > 0 ? GREEN : RED,
              }}
            >
              {balance.balance > 0
                ? `${balance.name} ${formatToman(balance.balance)} تومان به تو بدهکاره`
                : `تو ${formatToman(Math.abs(balance.balance))} تومان به ${balance.name} بدهکاری`}
            </div>
            <div style={{ opacity: 0.6, fontSize: 13, marginTop: 2 }}>
              خالص: {formatSignedToman(balance.balance)}
            </div>
          </div>
          {offsetPreview > 0 && (
            <div style={{ padding: '14px 16px 0' }}>
              <Button
                size="l"
                stretched
                mode="bezeled"
                loading={netBusy}
                onClick={() => void onNet()}
                style={
                  netArmed ? { background: GREEN, color: '#fff' } : undefined
                }
              >
                {netArmed ? 'برای کم و وجه، دوباره بزن' : 'کم و وجه'}
              </Button>
              <div
                style={{
                  fontSize: 13,
                  opacity: 0.7,
                  marginTop: 8,
                  textAlign: 'center',
                }}
              >
                {formatToman(offsetPreview)} از بدهی‌های دوطرفه خط می‌خوره و
                فقط خالص حساب می‌مونه.
              </div>
              {netError && (
                <div
                  style={{
                    color: RED,
                    fontSize: 13,
                    marginTop: 6,
                    textAlign: 'center',
                  }}
                >
                  {netError}
                </div>
              )}
            </div>
          )}
          {netNote && (
            <div
              style={{
                padding: '12px 20px 0',
                color: GREEN,
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {netNote}
            </div>
          )}
          <List>
            <Section header="سهم‌های تسویه‌نشده">
              {openShares.length === 0 && (
                <div style={{ padding: '8px 20px 16px', opacity: 0.7 }}>
                  سهم بازِ مشترکی پیدا نشد.
                </div>
              )}
              {openShares.map(({ expense, share }) => (
                <div key={share.id}>
                  <div
                    style={{ padding: '10px 20px 0', opacity: 0.65, fontSize: 13 }}
                  >
                    {expense.title} · {formatDateFa(expense.createdAt)}
                  </div>
                  <ShareRow expense={expense} share={share} />
                </div>
              ))}
            </Section>
          </List>
        </div>
      )}
    </Modal>
  );
}
