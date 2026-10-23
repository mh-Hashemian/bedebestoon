import { useEffect, useMemo, useState } from 'react';
import { Button, Input, Modal, Text } from '@telegram-apps/telegram-ui';
import { friendlyError } from '../api/client';
import type { CreateExpenseInput } from '../api/types';
import {
  formatNumberFa,
  formatPercentFa,
  formatToman,
  parseAmountInput,
} from '../lib/format';
import { equalSplit, isValidCustomSplit, sumAmounts } from '../lib/split';
import {
  AMBER,
  BLUE,
  BLUE_TINT,
  cardStyle,
  GREEN,
  GREEN_TINT,
} from '../lib/theme';
import { hapticError, hapticSuccess, hapticTap } from '../telegram/actions';
import {
  isMainButtonAvailable,
  useMainButton,
} from '../telegram/useMainButton';
import { ErrorNote, InitialAvatar, LinkedBadge } from './ui';
import { useAppState } from '../state/AppState';

/** Participant identity in the flow: 'me' (current user) or a contact id. */
type ParticipantKey = string;
const ME: ParticipantKey = 'me';


/** Circular avatar with an optional blue ✓ badge (mockup participant chips). */
function AvatarChip({
  name,
  selected,
  onClick,
  caption,
}: {
  name: string;
  selected?: boolean;
  onClick?: () => void;
  caption?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 5,
        cursor: onClick ? 'pointer' : 'default',
        minWidth: 56,
      }}
    >
      <span style={{ position: 'relative', display: 'inline-flex' }}>
        <span
          style={{
            borderRadius: '50%',
            boxShadow: selected ? `0 0 0 2px ${BLUE}` : undefined,
            display: 'inline-flex',
          }}
        >
          <InitialAvatar name={name} size={48} />
        </span>
        {selected && (
          <span
            style={{
              position: 'absolute',
              top: -3,
              insetInlineStart: -3,
              width: 19,
              height: 19,
              borderRadius: '50%',
              background: BLUE,
              color: '#fff',
              fontSize: 11,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 0 0 2px var(--tgui--bg_color, #fff)',
            }}
          >
            ✓
          </span>
        )}
      </span>
      <span style={{ fontSize: 12.5, color: 'var(--tgui--text_color)' }}>
        {caption ?? name.split(' ')[0]}
      </span>
    </button>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontWeight: 700, fontSize: 15, margin: '18px 0 8px' }}>
      {children}
    </div>
  );
}

/**
 * The core flow of the app, designed from Mohammad's mockups
 * (design/mockup-add-expense.png + mockup-custom-split.png): ONE bottom
 * sheet that contains amount, title, payer,
 * suggestions, participant selection (avatar chips + searchable list),
 * inline contact creation and the equal-split auto-calc box — plus a
 * dedicated Custom Split view inside the same sheet. Submission goes
 * through Telegram's MainButton («ثبت و ارسال» / «تایید و ثبت نهایی»),
 * with an in-app fallback button when the MainButton is unavailable.
 */
export function AddExpense({
  open,
  onClose,
  initialMode = 'expense',
}: {
  open: boolean;
  onClose: () => void;
  initialMode?: 'expense' | 'debt';
}) {
  const { api, me, contacts, recentContacts, upsertContact, refresh } =
    useAppState();

  const [view, setView] = useState<'main' | 'custom'>('main');
  const [mode, setMode] = useState<'expense' | 'debt'>('expense');
  const [debtDirection, setDebtDirection] = useState<'iOwe' | 'theyOwe'>(
    'iOwe',
  );
  const [debtPerson, setDebtPerson] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [amountRaw, setAmountRaw] = useState('');
  const [payerKey, setPayerKey] = useState<ParticipantKey>(ME);
  const [selected, setSelected] = useState<ParticipantKey[]>([ME]);
  const [splitMode, setSplitMode] = useState<'equal' | 'custom'>('equal');
  const [customRaw, setCustomRaw] = useState<Record<string, string>>({});
  const [query, setQuery] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline contact creation
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const amount = parseAmountInput(amountRaw);

  // Fresh state every time the sheet opens.
  useEffect(() => {
    if (open) {
      setView('main');
      setMode(initialMode);
      setDebtDirection('iOwe');
      setDebtPerson(null);
      setTitle('');
      setAmountRaw('');
      setPayerKey(ME);
      setSelected([ME]);
      setSplitMode('equal');
      setCustomRaw({});
      setQuery('');
      setError(null);
      setCreateError(null);
      setNewName('');
      setNewPhone('');
    }
  }, [open, initialMode ]);

  const nameOf = (key: ParticipantKey): string =>
    key === ME ? 'خودم' : (contacts.find((c) => c.id === key)?.name ?? '؟');

  const customAmountsInOrder = useMemo(
    () => selected.map((k) => parseAmountInput(customRaw[k] ?? '')),
    [selected, customRaw],
  );
  const customSum = sumAmounts(customAmountsInOrder);
  const remaining = amount - customSum;
  const customValid =
    mode === 'debt' ||
    splitMode === 'equal' ||
    isValidCustomSplit(amount, customAmountsInOrder);
  const debtAutoTitle = debtPerson
    ? debtDirection === 'iOwe'
      ? `بدهی به ${nameOf(debtPerson)}`
      : `طلب از ${nameOf(debtPerson)}`
    : '';
  const formValid =
    mode === 'debt'
      ? amount > 0 && debtPerson !== null
      : amount > 0 && title.trim().length > 0 && selected.length >= 1;

  const toggleParticipant = (key: ParticipantKey) => {
    hapticTap();
    setSelected((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key],
    );
  };

  const enterCustomView = () => {
    // Prefill custom amounts with the equal-split preview for easy edits.
    if (amount > 0 && selected.length > 0) {
      const preview = equalSplit(amount, selected.length);
      setCustomRaw((prev) => {
        const next = { ...prev };
        selected.forEach((k, i) => {
          if (next[k] === undefined) next[k] = String(preview[i]);
        });
        return next;
      });
    }
    setSplitMode('custom');
    setView('custom');
  };

  const submit = async () => {
    if (!me || submitting || !formValid || !customValid) return;
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'debt' && debtPerson) {
        // A plain personal debt, expressed with the expense model: the
        // lender is the "payer" and the borrower is the only participant,
        // so no custom split is ever needed.
        await api.createExpense({
          title: title.trim() || debtAutoTitle,
          totalAmount: amount,
          payerContactId: debtDirection === 'iOwe' ? debtPerson : undefined,
          participants:
            debtDirection === 'iOwe'
              ? [{ userId: me.id }]
              : [{ contactId: debtPerson }],
        });
      } else {
        const participants: CreateExpenseInput['participants'] = selected.map(
          (key, i) => {
            const base =
              key === ME ? { userId: me.id } : { contactId: key };
            return splitMode === 'custom'
              ? { ...base, amount: customAmountsInOrder[i] }
              : base;
          },
        );
        await api.createExpense({
          title: title.trim(),
          totalAmount: amount,
          payerContactId: payerKey === ME ? undefined : payerKey,
          participants,
        });
      }
      hapticSuccess();
      await refresh().catch(() => {});
      onClose();
    } catch (err) {
      hapticError();
      setError(friendlyError(err));
    } finally {
      setSubmitting(false);
    }
  };

  useMainButton(
    open
      ? {
          text:
            view === 'custom'
              ? submitting
                ? 'در حال ثبت…'
                : 'تایید و ثبت نهایی'
              : submitting
                ? 'در حال ثبت…'
                : mode === 'debt'
                  ? 'ثبت بدهی'
                  : 'ثبت و ارسال',
          enabled: formValid && customValid,
          loading: submitting,
          onClick: () => void submit(),
        }
      : null,
  );
  const showFallbackButton = open && !isMainButtonAvailable();

  const createInlineContact = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const contact = await api.createContact({
        name: newName.trim(),
        phone: newPhone.trim() || undefined,
      });
      upsertContact(contact);
      hapticSuccess();
      setNewName('');
      setNewPhone('');
      if (mode === 'debt') {
        setDebtPerson(contact.id);
      } else {
        setSelected((prev) =>
          prev.includes(contact.id) ? prev : [...prev, contact.id],
        );
      }
    } catch (err) {
      hapticError();
      setCreateError(friendlyError(err));
    } finally {
      setCreating(false);
    }
  };

  const filteredContacts = contacts.filter((c) =>
    query.trim() === '' ? true : c.name.includes(query.trim()),
  );

  const equalPreview =
    amount > 0 && selected.length > 0
      ? equalSplit(amount, selected.length)
      : [];
  const equalUniform =
    equalPreview.length > 0 &&
    equalPreview.every((a) => a === equalPreview[0]);

  const sheetHeader = (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '14px 18px 4px',
      }}
    >
      <span style={{ fontSize: 19 }}>
        {mode === 'debt' && view === 'main' ? '💸' : '💼'}
      </span>
      <span style={{ fontWeight: 800, fontSize: 16, flex: 1 }}>
        {view === 'custom'
          ? 'تنظیم سهم افراد (Custom Split)'
          : mode === 'debt'
            ? 'ثبت بدهی'
            : 'ثبت خرج گروهی'}
      </span>
      <button
        type="button"
        aria-label="بستن"
        onClick={onClose}
        style={{
          background: 'none',
          border: 'none',
          fontSize: 19,
          cursor: 'pointer',
          color: 'inherit',
          padding: 4,
        }}
      >
        ✕
      </button>
    </div>
  );

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      header={sheetHeader}
    >
      {view === 'main' ? (
        <div style={{ padding: '0 18px 30px' }}>
          {/* Mode switch: group expense vs plain personal debt */}
          <div
            style={{
              display: 'flex',
              background:
                'var(--tgui--secondary_bg_color, #f2f6fb)',
              borderRadius: 12,
              padding: 4,
              gap: 4,
              marginTop: 12,
            }}
          >
            {(
              [
                ['expense', '🧾 خرج گروهی'],
                ['debt', '💸 بدهی'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  hapticTap();
                  setMode(key);
                }}
                style={{
                  flex: 1,
                  border: 'none',
                  cursor: 'pointer',
                  borderRadius: 9,
                  padding: '9px 0',
                  fontWeight: 700,
                  fontSize: 14,
                  fontFamily: 'inherit',
                  background: mode === key ? BLUE : 'transparent',
                  color:
                    mode === key ? '#fff' : 'var(--tgui--text_color)',
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Amount + quick chips */}
          <FieldLabel>مبلغ کل</FieldLabel>
          <Input
            placeholder="۰"
            inputMode="numeric"
            value={amountRaw}
            onChange={(e) => setAmountRaw(e.target.value)}
            after={<span style={{ opacity: 0.55, fontSize: 13 }}>تومان</span>}
          />
          {/* Title */}
          <FieldLabel>
            {mode === 'debt' ? 'عنوان (اختیاری)' : 'عنوان خرج'}
          </FieldLabel>
          <Input
            placeholder={
              mode === 'debt'
                ? debtAutoTitle || 'مثلاً قرض دستی'
                : 'مثلاً ناهار رستوران'
            }
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />

          {mode === 'debt' ? (
            <>
              <FieldLabel>💸 نوع بدهی</FieldLabel>
              <div
                style={{
                  display: 'flex',
                  background: 'var(--tgui--secondary_bg_color, #f2f6fb)',
                  borderRadius: 12,
                  padding: 4,
                  gap: 4,
                }}
              >
                {(
                  [
                    ['iOwe', 'من بدهکارم'],
                    ['theyOwe', 'اون به من بدهکاره'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      hapticTap();
                      setDebtDirection(key);
                    }}
                    style={{
                      flex: 1,
                      border: 'none',
                      cursor: 'pointer',
                      borderRadius: 9,
                      padding: '9px 0',
                      fontWeight: 700,
                      fontSize: 14,
                      fontFamily: 'inherit',
                      background: debtDirection === key ? BLUE : 'transparent',
                      color:
                        debtDirection === key
                          ? '#fff'
                          : 'var(--tgui--text_color)',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <FieldLabel>👤 طرف حساب</FieldLabel>
              <Input
                placeholder="جستجوی مخاطب…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                before={<span style={{ opacity: 0.5 }}>🔍</span>}
              />
              <div style={{ marginTop: 6 }}>
                {filteredContacts.map((c) => {
                  const active = debtPerson === c.id;
                  return (
                    <div
                      key={c.id}
                      onClick={() => {
                        hapticTap();
                        setDebtPerson(c.id);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 2px',
                        cursor: 'pointer',
                        borderBottom: '1px solid rgba(120,140,170,0.10)',
                      }}
                    >
                      <InitialAvatar name={c.name} size={42} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 600 }}>{c.name}</div>
                        <div style={{ fontSize: 12.5, opacity: 0.6 }}>
                          {c.linkedUserId
                            ? 'وصل شده'
                            : 'هنوز وارد اپ نشده'}
                        </div>
                      </div>
                      <span
                        style={{
                          width: 24,
                          height: 24,
                          borderRadius: '50%',
                          border: `2px solid ${active ? BLUE : 'rgba(120,140,170,0.45)'}`,
                          background: active ? BLUE : 'transparent',
                          color: '#fff',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 13,
                          flexShrink: 0,
                        }}
                      >
                        {active ? '✓' : ''}
                      </span>
                    </div>
                  );
                })}
                {filteredContacts.length === 0 && (
                  <div style={{ padding: '10px 2px', opacity: 0.65 }}>
                    {contacts.length === 0
                      ? 'هنوز مخاطبی نداری؛ از فرم پایین این صفحه یکی اضافه کن.'
                      : 'مخاطبی با این نام پیدا نشد.'}
                  </div>
                )}
              </div>

              {amount > 0 && debtPerson && (
                <div
                  style={{
                    background: 'var(--tgui--secondary_bg_color, #f2f6fb)',
                    borderRadius: 16,
                    padding: 14,
                    marginTop: 16,
                    fontSize: 14.5,
                  }}
                >
                  {debtDirection === 'iOwe' ? (
                    <>
                      تو به <b>{nameOf(debtPerson)}</b> مبلغ{' '}
                      <b>{formatToman(amount)}</b> بدهکار می‌شی.
                    </>
                  ) : (
                    <>
                      <b>{nameOf(debtPerson)}</b> مبلغ{' '}
                      <b>{formatToman(amount)}</b> به تو بدهکار می‌شه.
                    </>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
          {/* Payer */}
          <FieldLabel>پرداخت‌کننده</FieldLabel>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[ME, ...contacts.map((c) => c.id)].map((key) => (
              <Button
                key={key}
                size="s"
                mode={payerKey === key ? 'filled' : 'bezeled'}
                onClick={() => setPayerKey(key)}
              >
                {key === ME ? 'خودم' : nameOf(key)}
              </Button>
            ))}
          </div>

          {/* Recent suggestions */}
          {recentContacts.length > 0 && (
            <>
              <FieldLabel>🕐 پیشنهادهای اخیر</FieldLabel>
              <div style={{ fontSize: 12.5, opacity: 0.6, marginTop: -4 }}>
                از مخاطب‌های پرتکرار انتخاب کنید
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: 14,
                  overflowX: 'auto',
                  padding: '12px 2px 4px',
                }}
              >
                {recentContacts.map((c) => (
                  <AvatarChip
                    key={c.id}
                    name={c.name}
                    selected={selected.includes(c.id)}
                    onClick={() => toggleParticipant(c.id)}
                  />
                ))}
                <button
                  type="button"
                  onClick={() =>
                    document
                      .getElementById('dong-new-contact-name')
                      ?.focus()
                  }
                  style={{
                    background: 'none',
                    border: 'none',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 5,
                    minWidth: 56,
                    cursor: 'pointer',
                    color: 'inherit',
                  }}
                >
                  <span
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: '50%',
                      border: '1.6px dashed rgba(130,150,180,0.6)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 20,
                      opacity: 0.75,
                    }}
                  >
                    +
                  </span>
                  <span style={{ fontSize: 12.5 }}>افزودن</span>
                </button>
              </div>
            </>
          )}

          {/* Selected participants strip */}
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              marginTop: 18,
            }}
          >
            <span style={{ fontWeight: 700, fontSize: 15 }}>
              افراد شرکت‌کننده
            </span>
            <span style={{ fontSize: 12.5, opacity: 0.6 }}>
              {formatNumberFa(selected.length)} نفر انتخاب شده
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              gap: 14,
              overflowX: 'auto',
              padding: '12px 2px 4px',
            }}
          >
            {selected.length === 0 && (
              <Text style={{ opacity: 0.6 }}>
                هنوز کسی انتخاب نشده است؛ از لیست پایین انتخاب کن.
              </Text>
            )}
            {selected.map((key) => (
              <AvatarChip
                key={key}
                name={key === ME ? `${me?.firstName ?? ''} (من)` : nameOf(key)}
                caption={key === ME ? 'خودم' : undefined}
                selected
                onClick={() => toggleParticipant(key)}
              />
            ))}
          </div>

          {/* Searchable colleague list */}
          <FieldLabel>👥 انتخاب افراد</FieldLabel>
          <Input
            placeholder="جستجوی مخاطب…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            before={<span style={{ opacity: 0.5 }}>🔍</span>}
          />
          <div style={{ marginTop: 6 }}>
            {[ME, ...filteredContacts.map((c) => c.id)].map((key) => {
              const isSelected = selected.includes(key);
              const contact =
                key === ME ? null : contacts.find((c) => c.id === key);
              return (
                <div
                  key={key}
                  onClick={() => toggleParticipant(key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '10px 2px',
                    cursor: 'pointer',
                    borderBottom: '1px solid rgba(120,140,170,0.10)',
                  }}
                >
                  <InitialAvatar
                    name={key === ME ? (me?.firstName ?? 'من') : nameOf(key)}
                    size={42}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>
                      {key === ME ? 'خودم' : nameOf(key)}
                    </div>
                    <div style={{ fontSize: 12.5, opacity: 0.6 }}>
                      {key === ME
                        ? 'حساب خودم'
                        : contact?.linkedUserId
                          ? 'مخاطب • وصل شده'
                          : 'مخاطب • هنوز وارد اپ نشده'}
                    </div>
                  </div>
                  {isSelected && (
                    <span
                      style={{
                        background: BLUE_TINT,
                        color: BLUE,
                        borderRadius: 999,
                        padding: '3px 10px',
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      انتخاب شده
                    </span>
                  )}
                  {contact?.linkedUserId && !isSelected && <LinkedBadge />}
                  <span
                    onClick={(e) => e.stopPropagation()}
                    style={{ display: 'inline-flex' }}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleParticipant(key)}
                      style={{
                        width: 23,
                        height: 23,
                        borderRadius: '50%',
                        accentColor: BLUE,
                        cursor: 'pointer',
                      }}
                    />
                  </span>
                </div>
              );
            })}
            {filteredContacts.length === 0 && contacts.length > 0 && (
              <div style={{ padding: '10px 2px', opacity: 0.65 }}>
                مخاطبی با این نام پیدا نشد.
              </div>
            )}
          </div>

            </>
          )}

          {/* Inline new colleague — pinned at the bottom of the sheet */}
          <div
            style={{
              background: BLUE_TINT,
              borderRadius: 16,
              padding: 14,
              marginTop: 16,
              display: 'grid',
              gap: 9,
            }}
          >
            <div style={{ fontWeight: 700 }}>👤 افزودن مخاطب جدید</div>
            <div style={{ fontSize: 12.5, opacity: 0.65, marginTop: -5 }}>
              نام مخاطب را وارد کنید؛ شماره برای وصل‌شدن خودکار حسابش لازم
              است.
            </div>
            <Input
              id="dong-new-contact-name"
              placeholder="نام مخاطب"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <div className="ltr-field">
              <Input
                placeholder="شماره موبایل — ۰۹۱۲۳۴۵۶۷۸۹"
                inputMode="tel"
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
              />
            </div>
            <ErrorNote>{createError}</ErrorNote>
            <Button
              size="s"
              stretched
              loading={creating}
              disabled={newName.trim().length === 0}
              onClick={() => void createInlineContact()}
            >
              افزودن و انتخاب کردن
            </Button>
          </div>

          {/* Equal-split auto-calc box / custom summary */}
          {mode === 'expense' && (splitMode === 'equal' ? (
            <div
              style={{
                background: 'var(--tgui--secondary_bg_color, #f2f6fb)',
                borderRadius: 16,
                padding: 14,
                marginTop: 16,
              }}
            >
              <div style={{ fontWeight: 700 }}>🧮 محاسبه خودکار سهم هر نفر</div>
              {amount > 0 && selected.length > 0 ? (
                <>
                  <div
                    style={{ fontSize: 19, fontWeight: 800, marginTop: 8 }}
                  >
                    سهم هر نفر:{' '}
                    {equalUniform
                      ? formatToman(equalPreview[0])
                      : `${formatToman(equalPreview[equalPreview.length - 1])} تا ${formatToman(equalPreview[0])}`}
                  </div>
                  <div style={{ fontSize: 12.5, opacity: 0.65, marginTop: 4 }}>
                    مبلغ کل ({formatNumberFa(amount)}) ÷ تعداد نفرات (
                    {formatNumberFa(selected.length)}) ={' '}
                    {formatToman(Math.floor(amount / selected.length))}
                    {!equalUniform &&
                      ' — تومان‌های باقی‌مانده یکی‌یکی به نفرات اول می‌رسد'}
                  </div>
                  {!equalUniform && (
                    <div style={{ marginTop: 8, fontSize: 13 }}>
                      {selected.map((key, i) => (
                        <div
                          key={key}
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            padding: '2px 0',
                          }}
                        >
                          <span>{nameOf(key)}</span>
                          <b>{formatToman(equalPreview[i])}</b>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 13, opacity: 0.65, marginTop: 6 }}>
                  مبلغ و شرکت‌کننده‌ها را انتخاب کن تا سهم هر نفر خودکار حساب
                  شود.
                </div>
              )}
              <Button
                mode="bezeled"
                stretched
                style={{ marginTop: 12 }}
                disabled={amount <= 0 || selected.length === 0}
                onClick={enterCustomView}
              >
                تقسیم دلخواه (Custom Split)
              </Button>
            </div>
          ) : (
            <div
              style={{
                background: remaining === 0 ? GREEN_TINT : BLUE_TINT,
                borderRadius: 16,
                padding: 14,
                marginTop: 16,
              }}
            >
              <div style={{ fontWeight: 700 }}>✂️ تقسیم دلخواه فعال است</div>
              <div style={{ fontSize: 13.5, marginTop: 5 }}>
                جمع سهم‌ها: {formatToman(customSum)} از {formatToman(amount)}
                {remaining === 0
                  ? ' ✅'
                  : ` — باقی‌مانده: ${formatToman(remaining)}`}
              </div>
              <Button
                mode="bezeled"
                stretched
                style={{ marginTop: 10 }}
                onClick={() => setView('custom')}
              >
                ویرایش سهم‌ها
              </Button>
            </div>
          ))}

          <ErrorNote>{error}</ErrorNote>
          {showFallbackButton && (
            <Button
              stretched
              size="l"
              loading={submitting}
              disabled={!formValid || !customValid}
              onClick={() => void submit()}
              style={{ marginTop: 14 }}
            >
              {mode === 'debt' ? 'ثبت بدهی 💸' : 'ثبت و ارسال ✈️'}
            </Button>
          )}
        </div>
      ) : (
        /* ---------- Custom Split view (mockup-custom-split) ---------- */
        <div style={{ padding: '0 18px 30px' }}>
          <div
            style={{
              ...cardStyle,
              boxShadow: 'none',
              background: remaining === 0 ? GREEN_TINT : 'rgba(232,161,58,0.10)',
              display: 'flex',
              alignItems: 'center',
              marginTop: 6,
            }}
          >
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, opacity: 0.7 }}>💼 مبلغ کل:</div>
              <div style={{ fontSize: 20, fontWeight: 800, marginTop: 3 }}>
                {formatToman(amount)}
              </div>
            </div>
            <div
              style={{
                width: 1,
                alignSelf: 'stretch',
                background: 'rgba(120,140,170,0.25)',
                margin: '0 14px',
              }}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, opacity: 0.7 }}>
                باقیمانده برای تقسیم:
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  marginTop: 3,
                  color: remaining === 0 ? GREEN : AMBER,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                }}
              >
                {formatToman(remaining)}
                <span
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: remaining === 0 ? GREEN : AMBER,
                    color: '#fff',
                    fontSize: 12.5,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {remaining === 0 ? '✓' : '!'}
                </span>
              </div>
            </div>
          </div>

          <FieldLabel>سهم هر فرد (مبلغ دلخواه)</FieldLabel>
          <div style={{ fontSize: 12.5, opacity: 0.6, marginTop: -4 }}>
            مبلغ مورد نظر هر نفر را به‌صورت دستی وارد کنید.
          </div>

          <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
            {selected.map((key) => {
              const value = parseAmountInput(customRaw[key] ?? '');
              return (
                <div
                  key={key}
                  style={{
                    ...cardStyle,
                    boxShadow: 'none',
                    border: '1px solid rgba(120,140,170,0.16)',
                    padding: '12px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                  }}
                >
                  <InitialAvatar
                    name={key === ME ? (me?.firstName ?? 'من') : nameOf(key)}
                    size={44}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700 }}>{nameOf(key)}</div>
                    <div style={{ fontSize: 12.5, opacity: 0.6 }}>
                      {formatPercentFa(amount > 0 ? value / amount : 0)} از کل
                      مبلغ
                    </div>
                  </div>
                  <div style={{ width: 148 }}>
                    <Input
                      placeholder="۰"
                      inputMode="numeric"
                      value={customRaw[key] ?? ''}
                      onChange={(e) =>
                        setCustomRaw((prev) => ({
                          ...prev,
                          [key]: e.target.value,
                        }))
                      }
                      after={
                        <span style={{ opacity: 0.55, fontSize: 12 }}>
                          تومان
                        </span>
                      }
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {remaining === 0 && amount > 0 && (
            <div
              style={{
                background: GREEN_TINT,
                borderRadius: 16,
                padding: 14,
                marginTop: 14,
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
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
                  fontSize: 14,
                  flexShrink: 0,
                }}
              >
                ✓
              </span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  مجموع مبالغ وارد شده برابر با مبلغ کل است
                </div>
                <div
                  style={{ color: GREEN, fontWeight: 800, marginTop: 3 }}
                >
                  {formatToman(amount)}
                </div>
              </div>
            </div>
          )}

          <ErrorNote>{error}</ErrorNote>

          <div
            style={{
              display: 'flex',
              gap: 10,
              marginTop: 14,
              alignItems: 'center',
            }}
          >
            <Button mode="plain" onClick={() => setView('main')}>
              بازگشت
            </Button>
            <Button
              mode="plain"
              onClick={() => {
                setSplitMode('equal');
                setView('main');
              }}
            >
              تقسیم مساوی شود
            </Button>
          </div>
          {showFallbackButton && (
            <Button
              stretched
              size="l"
              loading={submitting}
              disabled={!customValid || !formValid}
              onClick={() => void submit()}
              style={{ marginTop: 8 }}
            >
              تایید و ثبت نهایی ✈️
            </Button>
          )}
        </div>
      )}
    </Modal>
  );
}
