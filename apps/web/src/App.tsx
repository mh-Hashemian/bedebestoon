import { useMemo, useState } from 'react';
import { AppRoot, Placeholder, Tabbar } from '@telegram-apps/telegram-ui';
import type { ApiClient } from './api/client';
import { HttpApiClient } from './api/client';
import { MockApiClient } from './api/mockClient';
import { Dashboard } from './screens/Dashboard';
import { ContactsScreen } from './screens/Contacts';
import { AddExpense } from './components/AddExpense';
import { AppStateProvider } from './state/AppState';
import { detectEnv } from './telegram/env';
import { RED } from './lib/theme';

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'http://localhost:3000';

/** Shown in a plain browser: we never fabricate financial data. */
function BrowserNotice() {
  return (
    <Placeholder
      header="این مینی‌اپ باید داخل تلگرام باز شود"
      description={
        'بده‌بستون یک مینی‌اپ تلگرامی است و اطلاعات حساب تو را فقط از تلگرام ' +
        'می‌خواند؛ برای همین در مرورگر معمولی چیزی نمایش داده نمی‌شود و ' +
        'هیچ دادهٔ ساختگی‌ای هم نشان نمی‌دهیم. ربات @bedebestoonrobot را در ' +
        'تلگرام باز کن و از دکمهٔ منو وارد شو. برای توسعهٔ محلی می‌توانی ' +
        'حالت دمو را با ?mock=1 در انتهای آدرس فعال کنی.'
      }
    >
      <span style={{ fontSize: 56 }}>🧾</span>
    </Placeholder>
  );
}

function Shell({ api }: { api: ApiClient }) {
  const [tab, setTab] = useState<'dashboard' | 'contacts'>('dashboard');
  const [addOpen, setAddOpen] = useState(false);

  return (
    <AppStateProvider api={api}>
      {tab === 'dashboard' ? (
        <Dashboard onAddExpense={() => setAddOpen(true)} />
      ) : (
        <ContactsScreen />
      )}
      <Tabbar>
        <Tabbar.Item
          text="داشبورد"
          selected={tab === 'dashboard'}
          onClick={() => setTab('dashboard')}
        >
          <span style={{ fontSize: 22 }}>🏠</span>
        </Tabbar.Item>
        <Tabbar.Item
          text="مخاطب‌ها"
          selected={tab === 'contacts'}
          onClick={() => setTab('contacts')}
        >
          <span style={{ fontSize: 22 }}>👥</span>
        </Tabbar.Item>
      </Tabbar>
      <AddExpense open={addOpen} onClose={() => setAddOpen(false)} />
    </AppStateProvider>
  );
}

export default function App() {
  const env = useMemo(() => detectEnv(), []);
  const client = useMemo<ApiClient | null>(() => {
    if (env.kind === 'telegram') {
      return new HttpApiClient(API_URL, env.initDataRaw);
    }
    if (env.kind === 'mock') return new MockApiClient();
    return null;
  }, [env]);

  return (
    // The design mockups are a light theme; pinning appearance keeps the
    // app identical (and readable) on phones set to Telegram dark mode.
    <AppRoot appearance="light">
      {env.kind === 'mock' && (
        <div
          style={{
            background: RED,
            color: '#fff',
            textAlign: 'center',
            padding: '8px 12px',
            fontSize: 13,
            fontWeight: 700,
            position: 'sticky',
            top: 0,
            zIndex: 50,
          }}
        >
          حالت دمو (دادهٔ آزمایشی — mock) — این حساب واقعی نیست
        </div>
      )}
      {client ? <Shell api={client} /> : <BrowserNotice />}
    </AppRoot>
  );
}
