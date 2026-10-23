import { useState } from 'react';
import {
  Button,
  Cell,
  Input,
  List,
  Section,
  Text,
} from '@telegram-apps/telegram-ui';
import { friendlyError } from '../api/client';
import { formatNumberFa } from '../lib/format';
import { ErrorNote, DeleteButton, InitialAvatar, LinkedBadge } from '../components/ui';
import { PhonePrompt } from '../components/PhonePrompt';
import { hapticError, hapticSuccess } from '../telegram/actions';
import { useAppState } from '../state/AppState';

export function ContactsScreen() {
  const { me, contacts, api, upsertContact, refresh } = useAppState();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const contact = await api.createContact({
        name: name.trim(),
        phone: phone.trim() || undefined,
      });
      upsertContact(contact);
      hapticSuccess();
      setName('');
      setPhone('');
      setNotice(`مخاطب «${contact.name}» اضافه شد.`);
      void refresh().catch(() => {});
    } catch (err) {
      hapticError();
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <List>
      <div style={{ padding: '16px 20px 0', fontSize: 21, fontWeight: 800 }}>
        مخاطب‌ها 👥
      </div>
      {/* Profile / settings spot: my linked phone (Addendum v1.1). */}
      <Section header="حساب من">
        <Cell
          subtitle={
            me?.phone
              ? 'شماره‌ات وصل است؛ دنگ‌هایی که با این شماره به نامت ثبت شوند خودکار به حسابت می‌آیند.'
              : 'هنوز شماره‌ای به حسابت وصل نشده است.'
          }
          after={
            me?.phone ? (
              <span dir="ltr" style={{ fontWeight: 600 }}>
                {me.phone}
              </span>
            ) : undefined
          }
        >
          {me ? `${me.firstName} ${me.lastName ?? ''}` : '—'}
        </Cell>
      </Section>
      {!me?.phone && <PhonePrompt dismissible={false} />}

      <Section
        header={`مخاطب‌های من (${formatNumberFa(contacts.length)})`}
        footer="مخاطب «وصل شده» یعنی آن شخص وارد اپ شده و حسابش به این مخاطب لینک شده است. شماره موبایل مخاطب فقط برای همین لینک‌شدن استفاده می‌شود."
      >
        {contacts.length === 0 && (
          <div style={{ padding: '4px 20px 16px', opacity: 0.7 }}>
            <Text>هنوز مخاطبی نداری. از فرم پایین اولین مخاطب را اضافه کن.</Text>
          </div>
        )}
        {contacts.map((contact) => (
          <Cell
            key={contact.id}
            before={<InitialAvatar name={contact.name} size={40} />}
            after={
              <span
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                {contact.linkedUserId ? <LinkedBadge /> : null}
                <DeleteButton
                  variant="inline"
                  label="🗑"
                  onDelete={async () => {
                    setListError(null);
                    await api.deleteContact(contact.id);
                    void refresh().catch(() => {});
                  }}
                  onError={setListError}
                />
              </span>
            }
            subtitle={
              contact.phone
                ? 'شماره دارد — با ورودش خودکار وصل می‌شود'
                : 'بدون شماره — خودکار وصل نمی‌شود'
            }
          >
            {contact.name}
          </Cell>
        ))}
        {listError && (
          <div style={{ padding: '0 20px 12px' }}>
            <ErrorNote>{listError}</ErrorNote>
          </div>
        )}
      </Section>

      <Section header="افزودن مخاطب">
        <div style={{ display: 'grid', gap: 10, padding: '4px 16px 16px' }}>
          <Input
            header="نام"
            placeholder="مثلاً علی رضایی"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Input
            header="شماره موبایل (برای وصل‌شدن خودکار)"
            placeholder="۰۹۱۲۳۴۵۶۷۸۹"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <ErrorNote>{error}</ErrorNote>
          {notice && (
            <div style={{ padding: '0 4px' }}>
              <Text style={{ color: '#2ea44f' }}>{notice}</Text>
            </div>
          )}
          <Button
            stretched
            loading={busy}
            disabled={name.trim().length === 0}
            onClick={() => void create()}
          >
            افزودن مخاطب
          </Button>
        </div>
      </Section>

      <div style={{ height: 96 }} />
    </List>
  );
}
