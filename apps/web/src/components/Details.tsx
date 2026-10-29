import { useState } from 'react';
import { List, Modal, Section, Text } from '@telegram-apps/telegram-ui';
import type { Balance, Expense } from '../api/types';
import { formatDateFa, formatSignedToman, formatToman } from '../lib/format';
import { GREEN, RED } from '../lib/theme';
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
  const myKey = me ? userPartyKey(me.id) : null;

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
