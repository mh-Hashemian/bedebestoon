import { useState } from 'react';
import { Button, Input, Section, Text } from '@telegram-apps/telegram-ui';
import { friendlyError } from '../api/client';
import { formatNumberFa } from '../lib/format';
import { RED } from '../lib/theme';
import {
  canRequestContact,
  hapticError,
  hapticSuccess,
  requestPhoneFromTelegram,
} from '../telegram/actions';
import { useAppState } from '../state/AppState';

const DISMISS_KEY = 'dong.phonePrompt.dismissed';

/**
 * Addendum v1.1 first-open phone prompt. Shown while the user has no phone
 * on file: Telegram's native contact-share (one consent tap) when available,
 * manual entry always offered as fallback. Submitting calls POST /me/phone
 * and reports how many virtual contacts were linked to the account.
 * Dismissible on the dashboard; also rendered in the contacts/settings spot
 * (see ContactsScreen) until a phone is linked.
 */
export function PhonePrompt({ dismissible = true }: { dismissible?: boolean }) {
  const { api, me, refresh } = useAppState();
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === '1',
  );
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!me || me.phone) return null;
  if (dismissible && dismissed && !message) return null;

  const submitPhone = async (phone: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.sharePhone(phone);
      hapticSuccess();
      if (result.linkedCount > 0) {
        setMessage(
          `شماره‌ات ثبت شد و ${formatNumberFa(result.linkedCount)} مخاطب به حسابت وصل شد. 🎉`,
        );
      } else {
        setMessage(
          'شماره‌ات ثبت شد. فعلاً دنگی با این شماره به نامت ثبت نشده بود.',
        );
      }
      await refresh().catch(() => {});
    } catch (err) {
      hapticError();
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const onShareViaTelegram = async () => {
    setError(null);
    const phone = await requestPhoneFromTelegram();
    if (phone) {
      await submitPhone(phone);
    } else {
      setError(
        'شماره‌ای از تلگرام دریافت نشد. می‌توانی شماره را دستی وارد کنی.',
      );
    }
  };

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <Section header="اتصال شماره موبایل">
      <div style={{ padding: '4px 20px 16px', display: 'grid', gap: 10 }}>
        {message ? (
          <Text>{message}</Text>
        ) : (
          <>
            <Text>
              برای پیدا کردن دنگ‌هایی که به نامت ثبت شده، شماره‌ت را به اشتراک
              بگذار. دیگران شاید قبلاً با شماره‌ات برایت هزینه ثبت کرده
              باشند؛ با این کار آن دنگ‌ها خودکار به حسابت وصل می‌شوند.
            </Text>
            {canRequestContact() && (
              <Button
                stretched
                loading={busy}
                onClick={() => void onShareViaTelegram()}
              >
                📱 اشتراک شماره با تلگرام
              </Button>
            )}
            <div className="ltr-field">
              <Input
                header="یا شماره را دستی وارد کن"
                placeholder="۰۹۱۲۳۴۵۶۷۸۹"
                inputMode="tel"
                value={manual}
                onChange={(e) => setManual(e.target.value)}
              />
            </div>
            <Button
              mode="bezeled"
              stretched
              loading={busy}
              disabled={manual.trim().length < 10}
              onClick={() => void submitPhone(manual.trim())}
            >
              ثبت شماره
            </Button>
            {error && <Text style={{ color: RED }}>{error}</Text>}
            {dismissible && (
              <Button mode="plain" size="s" onClick={dismiss}>
                بعداً
              </Button>
            )}
          </>
        )}
      </div>
    </Section>
  );
}
