import { useEffect, useRef, useState } from 'react';
import { Button, Cell, Text } from '@telegram-apps/telegram-ui';
import { friendlyError } from '../api/client';
import type { Expense, Share } from '../api/types';
import { formatNumberFa, formatToman } from '../lib/format';
import {
  canSettleShare,
  canUnsettleShare,
  shareDisplayName,
} from '../lib/parties';
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
  const { me, settle, unsettle } = useAppState();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armUndo, setArmUndo] = useState(false);
  if (!me) return null;

  const name = shareDisplayName(share, me.firstName);
  const allowed = canSettleShare(expense, share, me.id);
  const canUndo = canUnsettleShare(expense, share, me.id);

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

  const onUnsettle = async () => {
    // Two-step: an accidental tap is what this toggle exists to fix.
    if (!armUndo) {
      setArmUndo(true);
      setTimeout(() => setArmUndo(false), 4000);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await unsettle(share.id);
      hapticSuccess();
    } catch (err) {
      hapticError();
      setError(friendlyError(err));
    } finally {
      setBusy(false);
      setArmUndo(false);
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
          {canUndo && (
            <Button
              size="s"
              mode="plain"
              loading={busy}
              onClick={(e) => {
                e.stopPropagation();
                void onUnsettle();
              }}
              style={{
                marginTop: 2,
                color: armUndo ? RED : undefined,
                fontWeight: armUndo ? 700 : undefined,
              }}
            >
              {armUndo ? 'مطمئنی؟ برگرده' : '↩ برگردوندن'}
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

/**
 * Two-step destructive action: the first tap arms it, a second tap within
 * a few seconds actually deletes. Works identically in Telegram and in a
 * plain browser — no dependency on Telegram's native popups.
 */
export function DeleteButton({
  label,
  confirmLabel = 'برای حذف، دوباره بزن',
  onDelete,
  onError,
  variant = 'block',
}: {
  label: string;
  confirmLabel?: string;
  onDelete: () => Promise<void>;
  onError?: (message: string) => void;
  variant?: 'block' | 'inline';
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const arm = () => {
    setArmed(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setArmed(false), 4000);
  };

  const run = async () => {
    setBusy(true);
    try {
      await onDelete();
      hapticSuccess();
    } catch (err) {
      hapticError();
      setArmed(false);
      onError?.(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (armed) void run();
    else arm();
  };

  if (variant === 'inline') {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={handleClick}
        style={{
          border: 'none',
          cursor: 'pointer',
          borderRadius: 999,
          padding: '4px 10px',
          fontSize: 13,
          fontWeight: 700,
          background: armed ? RED : 'rgba(229, 72, 77, 0.10)',
          color: armed ? '#fff' : RED,
        }}
      >
        {busy ? '…' : armed ? 'حذف؟' : label}
      </button>
    );
  }

  return (
    <Button
      size="l"
      stretched
      loading={busy}
      onClick={handleClick}
      style={
        armed
          ? { background: RED, color: '#fff' }
          : { background: 'rgba(229, 72, 77, 0.10)', color: RED }
      }
    >
      {armed ? confirmLabel : label}
    </Button>
  );
}
