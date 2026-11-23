import { useMemo, useState } from 'react';
import {
  Button,
  List,
  Modal,
  Placeholder,
  Spinner,
  Text,
} from '@telegram-apps/telegram-ui';
import type { Balance, Expense } from '../api/types';
import {
  formatDateTimeFa,
  formatNumberFa,
  formatSignedToman,
  formatToman,
} from '../lib/format';
import {
  myNetForExpense,
  participantNames,
  payerDisplayName,
  perPersonLabel,
} from '../lib/parties';
import {
  groupExpenses,
  groupMyNet,
  groupPaidBy,
  groupShareLabel,
  groupTotal,
} from '../lib/groupExpenses';
import {
  cardStyle,
  categoryVisual,
  GREEN,
  GREEN_TINT,
  RED,
  RED_TINT,
} from '../lib/theme';
import {
  ExpenseDetailModal,
  GroupExpenseDetailModal,
  PersonDetailModal,
} from '../components/Details';
import { PhonePrompt } from '../components/PhonePrompt';
import { AvatarStack, InitialAvatar } from '../components/ui';
import { useAppState } from '../state/AppState';

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{ padding: '18px 20px 10px', fontSize: 17, fontWeight: 800 }}
    >
      {children}
    </div>
  );
}

/** One transaction card, styled after design/mockup-dashboard.png. */
function TransactionCard({
  expense,
  onOpen,
}: {
  expense: Expense;
  onOpen: () => void;
}) {
  const { me } = useAppState();
  if (!me) return null;
  const visual = categoryVisual(expense.title);
  const net = myNetForExpense(expense, me.id);
  const names = participantNames(expense, me.firstName);

  return (
    <div
      onClick={onOpen}
      style={{
        ...cardStyle,
        margin: '0 16px 12px',
        display: 'flex',
        gap: 12,
        cursor: 'pointer',
        alignItems: 'flex-start',
      }}
    >
      <span
        style={{
          width: 46,
          height: 46,
          borderRadius: 14,
          background: visual.tint,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 22,
          flexShrink: 0,
        }}
      >
        {visual.emoji}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>{expense.title}</div>
        <div style={{ fontSize: 13, opacity: 0.65, marginTop: 2 }}>
          {payerDisplayName(expense, me.firstName)} پرداخت کرد
        </div>
        <div style={{ fontSize: 13, opacity: 0.65, marginTop: 2 }}>
          {perPersonLabel(expense, me.id)}
        </div>
        <div style={{ marginTop: 6 }}>
          <AvatarStack names={names} />
        </div>
      </div>
      <div style={{ textAlign: 'left', flexShrink: 0 }}>
        {net !== 0 ? (
          <div
            style={{
              fontWeight: 800,
              color: net > 0 ? GREEN : RED,
              fontSize: 15,
            }}
          >
            {formatSignedToman(net)}
          </div>
        ) : (
          <div style={{ fontWeight: 700, color: GREEN, fontSize: 13 }}>
            تسویه شده ✅
          </div>
        )}
        <div style={{ fontSize: 12, opacity: 0.55, marginTop: 4 }}>
          {formatDateTimeFa(expense.createdAt)}
        </div>
        <div style={{ fontSize: 14, opacity: 0.35, marginTop: 2 }}>›</div>
      </div>
    </div>
  );
}

/**
 * One card for a whole multi-payer («چندپرداخت‌کننده») group expense:
 * the group total, who paid what, the per-person share and my net for
 * the group — instead of one confusing card per payer with the same title.
 */
function GroupExpenseCard({
  expenses,
  onOpen,
}: {
  expenses: Expense[];
  onOpen: () => void;
}) {
  const { me } = useAppState();
  if (!me) return null;
  const visual = categoryVisual(expenses[0].title);
  const total = groupTotal(expenses);
  const net = groupMyNet(expenses, me.id);
  const paidBy = groupPaidBy(expenses, me.firstName);
  const names = [
    ...new Set(
      expenses.flatMap((e) => participantNames(e, me.firstName)),
    ),
  ];

  return (
    <div
      onClick={onOpen}
      style={{
        ...cardStyle,
        margin: '0 16px 12px',
        display: 'flex',
        gap: 12,
        cursor: 'pointer',
        alignItems: 'flex-start',
      }}
    >
      <span
        style={{
          width: 46,
          height: 46,
          borderRadius: 14,
          background: visual.tint,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 22,
          flexShrink: 0,
        }}
      >
        {visual.emoji}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>{expenses[0].title}</div>
        <div style={{ fontSize: 13, opacity: 0.65, marginTop: 2 }}>
          👥 چندپرداخت‌کننده · مبلغ کل {formatToman(total)}
        </div>
        <div style={{ fontSize: 13, opacity: 0.65, marginTop: 2 }}>
          {groupShareLabel(expenses, me.firstName)}
        </div>
        <div style={{ fontSize: 13, opacity: 0.65, marginTop: 2 }}>
          {paidBy
            .map((p) => `${p.name}: ${formatToman(p.amount)}`)
            .join(' • ')}
        </div>
        <div style={{ marginTop: 6 }}>
          <AvatarStack names={names} />
        </div>
      </div>
      <div style={{ textAlign: 'left', flexShrink: 0 }}>
        {net !== 0 ? (
          <div
            style={{
              fontWeight: 800,
              color: net > 0 ? GREEN : RED,
              fontSize: 15,
            }}
          >
            {formatSignedToman(net)}
          </div>
        ) : (
          <div style={{ fontWeight: 700, color: GREEN, fontSize: 13 }}>
            تسویه شده ✅
          </div>
        )}
        <div style={{ fontSize: 12, opacity: 0.55, marginTop: 4 }}>
          {formatDateTimeFa(expenses[0].createdAt)}
        </div>
        <div style={{ fontSize: 14, opacity: 0.35, marginTop: 2 }}>›</div>
      </div>
    </div>
  );
}

export function Dashboard({
  onAddExpense,
}: {
  onAddExpense: (mode: 'expense' | 'debt') => void;
}) {
  const { me, contacts, balances, expenses, loading, loadError, refresh } =
    useAppState();
  const [selectedExpense, setSelectedExpense] = useState<Expense | null>(null);
  const [selectedBalance, setSelectedBalance] = useState<Balance | null>(null);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[] | null>(
    null,
  );
  const [settleOpen, setSettleOpen] = useState(false);

  const totals = useMemo(() => {
    let owedToMe = 0;
    let iOwe = 0;
    for (const b of balances) {
      if (b.balance > 0) owedToMe += b.balance;
      else iOwe += Math.abs(b.balance);
    }
    return { owedToMe, iOwe, net: owedToMe - iOwe };
  }, [balances]);

  // Keep open detail modals in sync with refreshed data.
  const liveExpense = selectedExpense
    ? (expenses.find((e) => e.id === selectedExpense.id) ?? null)
    : null;
  const liveGroup = selectedGroupIds
    ? expenses.filter((e) => selectedGroupIds.includes(e.id))
    : null;
  const liveGroupOrNull =
    liveGroup && liveGroup.length > 0 ? liveGroup : null;
  const liveBalance = selectedBalance
    ? (balances.find((b) => b.key === selectedBalance.key) ?? selectedBalance)
    : null;
  // Multi-payer sub-expenses read as one transaction, not one card per payer.
  const items = useMemo(() => groupExpenses(expenses), [expenses]);

  if (loading && !me) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', padding: 64 }}>
        <Spinner size="l" />
      </div>
    );
  }

  if (loadError && !me) {
    return (
      <Placeholder
        header="خطا در بارگذاری"
        description={loadError}
        action={<Button onClick={() => void refresh()}>تلاش دوباره</Button>}
      >
        <span style={{ fontSize: 48 }}>⚠️</span>
      </Placeholder>
    );
  }

  const net = totals.net;
  const peopleCount = contacts.length + 1;

  return (
    <div style={{ paddingBottom: 96 }}>
      {/* Greeting (mockup-dashboard) */}
      <div style={{ padding: '16px 20px 0' }}>
        <div style={{ fontSize: 21, fontWeight: 800 }}>
          سلام، {me?.firstName} خوش آمدی 👋
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginTop: 12,
          }}
        >
          <span
            style={{
              width: 42,
              height: 42,
              borderRadius: '50%',
              background: 'var(--tgui--bg_color, #fff)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 19,
              boxShadow: '0 2px 10px rgba(31,64,120,0.08)',
            }}
          >
            👥
          </span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 15 }}>حساب گروهی</div>
            <div style={{ fontSize: 13, opacity: 0.6 }}>
              {formatNumberFa(peopleCount)} نفر • تسویه هزینه‌های مشترک
            </div>
          </div>
        </div>
      </div>

      <List>
        <PhonePrompt />
      </List>

      {/* Balance hero card (mockup-dashboard) */}
      <div
        style={{
          ...cardStyle,
          margin: '14px 16px 0',
          background: net < 0 ? RED_TINT : GREEN_TINT,
          boxShadow: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span
            style={{
              width: 50,
              height: 50,
              borderRadius: '50%',
              background: 'var(--tgui--bg_color, #fff)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 24,
              flexShrink: 0,
            }}
          >
            💼
          </span>
          <div>
            <div style={{ fontSize: 14, opacity: 0.75 }}>
              مجموع بدهی/طلب شما
            </div>
            <div
              style={{
                fontSize: 24,
                fontWeight: 800,
                color: net < 0 ? RED : GREEN,
                marginTop: 2,
              }}
            >
              {formatSignedToman(net)}
            </div>
            <div style={{ fontSize: 13, opacity: 0.7, marginTop: 2 }}>
              {net > 0
                ? '(به نفع شماست)'
                : net < 0
                  ? '(بدهی شماست)'
                  : '(حسابی باز نیست)'}
            </div>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 16,
            marginTop: 12,
            fontSize: 13,
            opacity: 0.85,
          }}
        >
          <span>
            طلب من: <b style={{ color: GREEN }}>{formatToman(totals.owedToMe)}</b>
          </span>
          <span>
            بدهی من: <b style={{ color: RED }}>{formatToman(totals.iOwe)}</b>
          </span>
        </div>
      </div>

      {/* Actions (mockup-dashboard) */}
      <div style={{ display: 'flex', gap: 10, padding: '14px 16px 0' }}>
        <Button
          size="l"
          onClick={() => onAddExpense('expense')}
          style={{ flex: 1.35 }}
        >
          + ثبت خرج گروهی
        </Button>
        <Button
          size="l"
          mode="bezeled"
          onClick={() => setSettleOpen(true)}
          style={{ flex: 1 }}
        >
          🤝 تسویه حساب
        </Button>
      </div>
      <div style={{ padding: '10px 16px 0' }}>
        <Button
          size="l"
          mode="bezeled"
          stretched
          onClick={() => onAddExpense('debt')}
        >
          💸 ثبت بدهی
        </Button>
      </div>

      {/* Recent transactions (mockup-dashboard) */}
      <SectionTitle>تراکنش‌های اخیر</SectionTitle>
      {expenses.length === 0 && (
        <div style={{ padding: '0 20px 8px', opacity: 0.7 }}>
          <Text>هنوز هزینه‌ای ثبت نشده است. اولین خرج گروهی را ثبت کن!</Text>
        </div>
      )}
      {items.map((item) =>
        item.kind === 'group' ? (
          <GroupExpenseCard
            key={item.expenses.map((e) => e.id).join('+')}
            expenses={item.expenses}
            onOpen={() =>
              setSelectedGroupIds(item.expenses.map((e) => e.id))
            }
          />
        ) : (
          <TransactionCard
            key={item.expense.id}
            expense={item.expense}
            onOpen={() => setSelectedExpense(item.expense)}
          />
        ),
      )}

      {/* Per-person balances */}
      <SectionTitle>حساب‌وکتاب با هر نفر</SectionTitle>
      {balances.length === 0 && (
        <div style={{ padding: '0 20px 8px', opacity: 0.7 }}>
          <Text>فعلاً با کسی حساب باز نداری. 🎉</Text>
        </div>
      )}
      <div style={{ display: 'grid', gap: 10, padding: '0 16px' }}>
        {balances.map((b) => (
          <div
            key={b.key}
            onClick={() => setSelectedBalance(b)}
            style={{
              ...cardStyle,
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              cursor: 'pointer',
            }}
          >
            <InitialAvatar name={b.name} size={40} />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{b.name}</div>
              <div style={{ fontSize: 13, opacity: 0.6 }}>
                {b.balance > 0
                  ? `${formatToman(b.balance)} تومان به تو بدهکاره`
                  : `${formatToman(-b.balance)} تومان به او بدهکاری`}
              </div>
            </div>
            <span
              style={{
                fontWeight: 800,
                color: b.balance > 0 ? GREEN : RED,
              }}
            >
              {formatSignedToman(b.balance)}
            </span>
          </div>
        ))}
      </div>

      {/* Settle overview: pick a person, then settle share by share */}
      <Modal
        open={settleOpen}
        onOpenChange={setSettleOpen}
        header={<Modal.Header>تسویه حساب</Modal.Header>}
      >
        <div style={{ padding: '4px 16px 28px', display: 'grid', gap: 10 }}>
          {balances.length === 0 && (
            <Text>حساب بازی برای تسویه نداری. 🎉</Text>
          )}
          {balances.map((b) => (
            <div
              key={b.key}
              onClick={() => {
                setSettleOpen(false);
                setSelectedBalance(b);
              }}
              style={{
                ...cardStyle,
                boxShadow: 'none',
                border: '1px solid rgba(120,140,170,0.18)',
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                cursor: 'pointer',
              }}
            >
              <InitialAvatar name={b.name} size={38} />
              <span style={{ flex: 1, fontWeight: 700 }}>{b.name}</span>
              <span
                style={{ fontWeight: 800, color: b.balance > 0 ? GREEN : RED }}
              >
                {formatSignedToman(b.balance)}
              </span>
            </div>
          ))}
        </div>
      </Modal>

      <ExpenseDetailModal
        expense={liveExpense}
        onClose={() => setSelectedExpense(null)}
      />
      <GroupExpenseDetailModal
        expenses={liveGroupOrNull}
        onClose={() => setSelectedGroupIds(null)}
      />
      <PersonDetailModal
        balance={liveBalance}
        onClose={() => setSelectedBalance(null)}
      />
    </div>
  );
}
