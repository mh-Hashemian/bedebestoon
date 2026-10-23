import { useState } from 'react';
import { Button, Cell, Text } from '@telegram-apps/telegram-ui';
import { friendlyError } from '../api/client';
import type { Expense, Share } from '../api/types';
import { formatNumberFa, formatToman } from '../lib/format';
import { canSettleShare, shareDisplayName } from '../lib/parties';
import { colorForName, GREEN, RED } from '../lib/theme';
import { hapticError, hapticSuccess } from '../telegram/actions';
import { useAppState } from '../state/AppState';

/**
 * Initial-letter avatar (mockup style): nobody has real photos in our data,
 * so a deterministic colored circle with the first letter of the name is
 * used everywhere instead of external images.
 */
export function InitialAvatar({
  name,
  size = 40,
  ring = false,
}: {
  name: string;
  size?: number;
  ring?: boolean;
}) {
  const letter = (name.trim()[0] ?? '؟').toUpperCase();
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: colorForName(name),
        color: '#fff',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: size * 0.42,
        flexShrink: 0,
        boxShadow: ring ? '0 0 0 2px var(--tgui--bg_color, #fff)' : undefined,
      }}
    >
      {letter}
    </span>
  );
}

/** Overlapping row of participant avatars, "+N" when there are more. */
export function AvatarStack({
  names,
  max = 5,
  size = 26,
}: {
  names: string[];
  max?: number;
  size?: number;
}) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  return (
    <span style={{ display: 'inline-flex', direction: 'ltr' }}>
      {shown.map((name, i) => (
        <span key={i} style={{ marginLeft: i === 0 ? 0 : -8 }}>
          <InitialAvatar name={name} size={size} ring />
        </span>
      ))}
      {extra > 0 && (
        <span style={{ marginLeft: -8 }}>
          <span
            style={{
              width: size,
              height: size,
              borderRadius: '50%',
              background: '#8d99ae',
              color: '#fff',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 700,
              boxShadow: '0 0 0 2px var(--tgui--bg_color, #fff)',
            }}
          >
            +{formatNumberFa(extra)}
          </span>
        </span>
      )}
    </span>
  );
}

/** Small pill shown next to contacts that are linked to a real Telegram user. */
export function LinkedBadge() {
  return (
    <span
      style={{
        background: 'rgba(52, 168, 83, 0.15)',
        color: GREEN,
        borderRadius: 999,
        padding: '2px 8px',
        fontSize: 12,
        whiteSpace: 'nowrap',
      }}
    >
      وصل شده
    </span>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return (
    <div style={{ padding: '4px 20px 8px' }}>
      <Text style={{ color: RED, fontSize: 14 }}>{children}</Text>
    </div>
  );
}

/**
 * One expense share as a row: who, how much, paid state, and — when the
 * current user is allowed (payer / creator / share holder) and the share is
 * still unpaid — a «تسویه شد» button wired to POST /shares/:id/settle.
 */
export function ShareRow({
  expense,
  share,
}: {
  expense: Expense;
  share: Share;
}) {
  const { me, settle } = useAppState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;

  const name = shareDisplayName(share, me.firstName);
  const allowed = canSettleShare(expense, share, me.id);

  const onSettle = async () => {
    setBusy(true);
    setError(null);
    try {
      await settle(share.id);
      hapticSuccess();
    } catch (err) {
      hapticError();
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Cell
      before={<InitialAvatar name={name} size={38} />}
      subtitle={share.isPaid ? 'تسویه شده ✅' : 'تسویه نشده'}
      after={
        <div style={{ textAlign: 'left' }}>
          <div
            style={{
              fontWeight: 600,
              color: share.isPaid ? undefined : RED,
            }}
          >
            {formatToman(share.amount)}
          </div>
          {allowed && (
            <Button
              size="s"
              mode="bezeled"
              loading={busy}
              onClick={(e) => {
                e.stopPropagation();
                void onSettle();
              }}
              style={{ marginTop: 6 }}
            >
              تسویه شد
            </Button>
          )}
          {error && (
            <div style={{ color: RED, fontSize: 12, marginTop: 4 }}>
              {error}
            </div>
          )}
        </div>
      }
    >
      {name}
    </Cell>
  );
}
