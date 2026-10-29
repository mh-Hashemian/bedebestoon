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
          {expense.createdById === me.id && (
            <div style={{ padding: '12px 16px 0' }}>
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
          <List>
            <Section header="سهم‌ها">
              {expense.shares.map((share) => (
                <ShareRow key={share.id} expense={expense} share={share} />
              ))}
            </Section>
          </List>
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
  const [delError, setDelError] = useState<{
    expenseId: string;
    message: string;
  } | null>(null);
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

  // Group the open shares by their expense so each expense gets one header
  // line (and, for expenses I created, its own delete action).
  const groups: { expense: Expense; shares: Expense['shares'] }[] = [];
  {
    const byId = new Map<string, { expense: Expense; shares: Expense['shares'] }>();
    for (const { expense, share } of openShares) {
      let g = byId.get(expense.id);
      if (!g) {
        g = { expense, shares: [] };
        byId.set(expense.id, g);
        groups.push(g);
      }
      g.shares.push(share);
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
                ? `به تو بدهکار است: ${formatToman(balance.balance)}`
                : `به او بدهکاری: ${formatToman(Math.abs(balance.balance))}`}
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
              {groups.map(({ expense, shares }) => (
                <div key={expense.id}>
                  <div
                    style={{ padding: '10px 20px 0', opacity: 0.65, fontSize: 13 }}
                  >
                    {expense.title} · {formatDateFa(expense.createdAt)}
                  </div>
                  {shares.map((share) => (
                    <ShareRow key={share.id} expense={expense} share={share} />
                  ))}
                  {me && expense.createdById === me.id && (
                    <div style={{ padding: '4px 20px 2px' }}>
                      <DeleteButton
                        key={expense.id}
                        variant="inline"
                        label="🗑 حذف کامل این مورد"
                        onDelete={async () => {
                          await api.deleteExpense(expense.id);
                          void refresh().catch(() => {});
                        }}
                        onError={(message) =>
                          setDelError({ expenseId: expense.id, message })
                        }
                      />
                      {delError?.expenseId === expense.id && (
                        <div style={{ color: RED, fontSize: 12, marginTop: 4 }}>
                          {delError.message}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </Section>
          </List>
        </div>
      )}
    </Modal>
  );
}
