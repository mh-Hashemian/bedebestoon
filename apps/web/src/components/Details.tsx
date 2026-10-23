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
import { ShareRow } from './ui';
import { useAppState } from '../state/AppState';

/** Full expense view: summary + every share (with settle where allowed). */
export function ExpenseDetailModal({
  expense,
  onClose,
}: {
  expense: Expense | null;
  onClose: () => void;
}) {
  const { me } = useAppState();
  return (
    <Modal
      open={!!expense}
      onOpenChange={(open) => {
        if (!open) onClose();
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
  const { me, expenses } = useAppState();
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
