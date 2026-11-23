import { useEffect, useState } from 'react';
import { Button, Modal, Text } from '@telegram-apps/telegram-ui';
import { friendlyError } from '../api/client';
import type { SettlePlan } from '../api/types';
import { formatNumberFa, formatSignedToman, formatToman } from '../lib/format';
import { cardStyle, GREEN, GREEN_TINT, RED } from '../lib/theme';
import { InitialAvatar } from './ui';
import { useAppState } from '../state/AppState';

/**
 * «تسویه گروهی» — pick the people of a trip/group, and the app works out
 * who pays whom, with the fewest transactions, so every net becomes zero.
 * Read-only: it only shows the plan; nothing is settled by itself.
 */
export function GroupSettleModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { me, balances, api } = useAppState();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<SettlePlan | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fresh start each time the modal opens: everyone pre-selected.
  useEffect(() => {
    if (open) {
      setSelected(new Set(balances.map((b) => b.key)));
      setPlan(null);
      setError(null);
    }
    // balances are read at open time only; the modal opens after load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open ]);

  const nameForKey = (key: string): string => {
    if (me && key === `user:${me.id}`) return 'تو';
    return balances.find((b) => b.key === key)?.name ?? '؟';
  };

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const calculate = async () => {
    setCalculating(true);
    setError(null);
    try {
      const res = await api.getSettlePlan([...selected]);
      setPlan(res);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setCalculating(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      header={<Modal.Header>تسویه گروهی 🧮</Modal.Header>}
    >
      <div style={{ padding: '4px 16px 28px', display: 'grid', gap: 10 }}>
        {plan === null ? (
          <>
            <Text>
              افرادی که توی سفر یا گروه بودن رو انتخاب کن؛ با کمترین تراکنش
              حساب می‌کنه هر کی به کی چقدر بده تا همه صاف بشن.
            </Text>

            {/* Me: always included. */}
            <div
              style={{
                ...cardStyle,
                boxShadow: 'none',
                border: '1px solid rgba(120,140,170,0.18)',
                padding: '12px 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                opacity: 0.85,
              }}
            >
              <InitialAvatar name={me?.firstName ?? 'تو'} size={38} />
              <span style={{ flex: 1, fontWeight: 700 }}>
                {me?.firstName ?? 'تو'} (تو)
              </span>
              <span
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: GREEN,
                  color: '#fff',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 14,
                  fontWeight: 800,
                }}
              >
                ✓
              </span>
            </div>

            {balances.length === 0 && (
              <Text>فعلاً با کسی حساب باز نداری. 🎉</Text>
            )}
            {balances.map((b) => {
              const on = selected.has(b.key);
              return (
                <div
                  key={b.key}
                  onClick={() => toggle(b.key)}
                  style={{
                    ...cardStyle,
                    boxShadow: 'none',
                    border: `1px solid ${on ? GREEN : 'rgba(120,140,170,0.18)'}`,
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
                    style={{
                      fontWeight: 800,
                      color: b.balance > 0 ? GREEN : RED,
                      fontSize: 14,
                    }}
                  >
                    {formatSignedToman(b.balance)}
                  </span>
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: '50%',
                      background: on ? GREEN : 'transparent',
                      border: on
                        ? 'none'
                        : '2px solid rgba(120,140,170,0.4)',
                      color: '#fff',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 14,
                      fontWeight: 800,
                      flexShrink: 0,
                    }}
                  >
                    {on ? '✓' : ''}
                  </span>
                </div>
              );
            })}

            {error && <Text style={{ color: RED }}>{error}</Text>}
            <Button
              size="l"
              stretched
              disabled={selected.size === 0 || calculating}
              onClick={() => void calculate()}
            >
              {calculating
                ? 'در حال محاسبه…'
                : `محاسبه تسویه (${formatNumberFa(selected.size + 1)} نفر)`}
            </Button>
          </>
        ) : (
          <>
            {plan.transfers.length === 0 ? (
              <div
                style={{
                  ...cardStyle,
                  background: GREEN_TINT,
                  boxShadow: 'none',
                  padding: '16px',
                  textAlign: 'center',
                  fontWeight: 800,
                  fontSize: 16,
                }}
              >
                همه صافن! 🎉
              </div>
            ) : (
              <>
                <div
                  style={{
                    ...cardStyle,
                    background: GREEN_TINT,
                    boxShadow: 'none',
                    padding: '16px',
                    textAlign: 'center',
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: 17 }}>
                    با {formatNumberFa(plan.transfers.length)} تراکنش همه صاف
                    می‌شن
                  </div>
                  <div style={{ fontSize: 13, opacity: 0.7, marginTop: 4 }}>
                    مجموع جابه‌جایی: {formatToman(plan.totalAmount)} تومان
                  </div>
                </div>
                {plan.transfers.map((t, i) => (
                  <div
                    key={`${t.fromKey}-${t.toKey}-${i}`}
                    style={{
                      ...cardStyle,
                      boxShadow: 'none',
                      border: '1px solid rgba(120,140,170,0.18)',
                      padding: '12px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                    }}
                  >
                    <span
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: '50%',
                        background: GREEN,
                        color: '#fff',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 13,
                        fontWeight: 800,
                        flexShrink: 0,
                      }}
                    >
                      {formatNumberFa(i + 1)}
                    </span>
                    <div style={{ flex: 1, fontWeight: 700 }}>
                      {nameForKey(t.fromKey)} به {nameForKey(t.toKey)} بده
                    </div>
                    <span style={{ fontWeight: 800 }}>
                      {formatToman(t.amount)}
                    </span>
                  </div>
                ))}
              </>
            )}

            {/* Each party's net, so the plan is checkable at a glance. */}
            <div style={{ fontWeight: 800, marginTop: 6 }}>
              خالص هر نفر
            </div>
            {plan.parties.map((p) => (
              <div
                key={p.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '4px 4px',
                }}
              >
                <InitialAvatar name={nameForKey(p.key)} size={32} />
                <span style={{ flex: 1 }}>{nameForKey(p.key)}</span>
                <span
                  style={{
                    fontWeight: 700,
                    color: p.balance > 0 ? GREEN : p.balance < 0 ? RED : undefined,
                  }}
                >
                  {p.balance === 0
                    ? 'صاف ✅'
                    : p.balance > 0
                      ? `${formatToman(p.balance)} طلبکاره`
                      : `${formatToman(-p.balance)} بدهکاره`}
                </span>
              </div>
            ))}

            <Button
              size="l"
              mode="bezeled"
              stretched
              onClick={() => setPlan(null)}
            >
              تغییر انتخاب
            </Button>
          </>
        )}
      </div>
    </Modal>
  );
}
