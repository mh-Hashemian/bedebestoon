import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { friendlyError, type ApiClient } from '../api/client';
import type { Balance, Contact, Expense, Me } from '../api/types';

interface AppState {
  api: ApiClient;
  me: Me | null;
  contacts: Contact[];
  recentContacts: Contact[];
  expenses: Expense[];
  balances: Balance[];
  loading: boolean;
  /** Error of the last initial/refresh load, already in friendly Persian. */
  loadError: string | null;
  refresh: () => Promise<void>;
  settle: (shareId: string) => Promise<void>;
  unsettle: (shareId: string) => Promise<void>;
  /** Replace the contact list locally after an inline creation. */
  upsertContact: (contact: Contact) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppStateProvider({
  api,
  children,
}: {
  api: ApiClient;
  children: ReactNode;
}) {
  const [me, setMe] = useState<Me | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [recentContacts, setRecentContacts] = useState<Contact[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const apiRef = useRef(api);
  apiRef.current = api;

  const refresh = useCallback(async () => {
    const client = apiRef.current;
    try {
      const [meRes, contactsRes, recentRes, expensesRes, balancesRes] =
        await Promise.all([
          client.getMe(),
          client.listContacts(),
          client.listRecentContacts().catch(() => [] as Contact[]),
          client.listExpenses(),
          client.getBalances(),
        ]);
      setMe(meRes);
      setContacts(contactsRes);
      setRecentContacts(recentRes);
      setExpenses(expensesRes);
      setBalances(balancesRes);
      setLoadError(null);
    } catch (err) {
      setLoadError(friendlyError(err));
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh().catch(() => {
      // loadError already stored for the UI
    });
  }, [refresh]);

  const settle = useCallback(
    async (shareId: string) => {
      await apiRef.current.settleShare(shareId);
      await refresh().catch(() => {});
    },
    [refresh],
  );

  const unsettle = useCallback(
    async (shareId: string) => {
      await apiRef.current.unsettleShare(shareId);
      await refresh().catch(() => {});
    },
    [refresh],
  );

  const upsertContact = useCallback((contact: Contact) => {
    setContacts((prev) => {
      const rest = prev.filter((c) => c.id !== contact.id);
      return [...rest, contact].sort((a, b) =>
        a.name.localeCompare(b.name, 'fa'),
      );
    });
  }, []);

  const value = useMemo<AppState>(
    () => ({
      api,
      me,
      contacts,
      recentContacts,
      expenses,
      balances,
      loading,
      loadError,
      refresh,
      settle,
      unsettle,
      upsertContact,
    }),
    [
      api,
      me,
      contacts,
      recentContacts,
      expenses,
      balances,
      loading,
      loadError,
      refresh,
      settle,
      unsettle,
      upsertContact,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAppState must be used inside AppStateProvider');
  return ctx;
}
