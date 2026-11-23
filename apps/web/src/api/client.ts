import type {
  Balance,
  Contact,
  CreateContactInput,
  CreateExpenseInput,
  CreateGroupExpenseInput,
  CreateGroupExpenseResult,
  Expense,
  Me,
  NetResult,
  PhoneLinkResult,
  SettlePlan,
} from './types';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Translate known backend (English) error messages into friendly Persian. */
export function friendlyError(err: unknown): string {
  if (err instanceof ApiError) {
    const m = err.message;
    if (m.includes('already have a contact with this name'))
      return 'مخاطبی با این نام قبلاً ثبت کرده‌ای.';
    if (m.includes('valid Iranian mobile'))
      return 'شماره موبایل معتبر نیست. مثال: ۰۹۱۲۳۴۵۶۷۸۹';
    if (m.includes('already linked to another account'))
      return 'این شماره قبلاً به حساب دیگری وصل شده است.';
    if (m.includes('sum up to totalAmount') || m.includes('every participant'))
      return 'جمع سهم‌ها باید دقیقاً برابر مبلغ کل باشد.';
    if (m.includes('do not exist in your contact list'))
      return 'یکی از مخاطب‌های انتخاب‌شده در لیستت نیست.';
    if (m.includes('only be yourself'))
      return 'در این مرحله فقط خودت رو می‌تونی به‌عنوان کاربر انتخاب کنی؛ بقیه باید مخاطب باشن.';
    if (m.includes('exactly one of userId or contactId'))
      return 'هر شرکت‌کننده باید دقیقاً یک نفر باشد.';
    if (m.includes('must be an integer'))
      return 'مبلغ باید عدد صحیح باشد.';
    if (m.includes('must not be less than 1'))
      return 'مبلغ باید بیشتر از صفر باشد.';
    if (m.includes('must be a UUID'))
      return 'یکی از انتخاب‌ها معتبر نیست. اپ را ببند و دوباره باز کن.';
    if (m.includes('must not be empty') || m.includes('should not be empty'))
      return 'همه‌ی فیلدهای لازم را پر کن.';
    if (m.includes('used in expenses'))
      return 'این مخاطب در خرج‌ها استفاده شده و قابل حذف نیست.';
    if (m.includes('partyKey'))
      return 'حساب طرف مقابل پیدا نشد. اپ را ببند و دوباره باز کن.';
    if (m.includes('at least one other person'))
      return 'حداقل یک نفر را برای تسویه گروهی انتخاب کن.';
    if (m.includes('At least two payers'))
      return 'حداقل دو نفر باید مبلغی پرداخت کرده باشند.';
    if (m.includes('Each payer must be one of the participants'))
      return 'هر پرداخت‌کننده باید جزو شرکت‌کننده‌ها باشد.';
    if (err.status === 401)
      return 'نشست تلگرام معتبر نیست. اپ را داخل تلگرام باز کن و دوباره تلاش کن.';
    if (err.status === 403)
      return 'اجازه انجام این کار را نداری.';
    if (err.status === 404) return 'موردی پیدا نشد.';
    return 'خطایی از سمت سرور رخ داد. دوباره تلاش کن.';
  }
  return 'ارتباط با سرور برقرار نشد. اتصال اینترنت را بررسی کن.';
}

export interface ApiClient {
  getMe(): Promise<Me>;
  listContacts(): Promise<Contact[]>;
  listRecentContacts(): Promise<Contact[]>;
  createContact(input: CreateContactInput): Promise<Contact>;
  deleteContact(id: string): Promise<void>;
  sharePhone(phone: string): Promise<PhoneLinkResult>;
  listExpenses(): Promise<Expense[]>;
  createExpense(input: CreateExpenseInput): Promise<Expense>;
  createGroupExpense(
    input: CreateGroupExpenseInput,
  ): Promise<CreateGroupExpenseResult>;
  deleteExpense(id: string): Promise<void>;
  getBalances(): Promise<Balance[]>;
  netWithCounterparty(partyKey: string): Promise<NetResult>;
  getSettlePlan(partyKeys: string[]): Promise<SettlePlan>;
  settleShare(shareId: string): Promise<void>;
  unsettleShare(shareId: string): Promise<void>;
}

/**
 * HTTP client for the NestJS API. Every request carries the raw Telegram
 * initData in the Authorization header (HANDOVER §4.1) — the backend
 * TelegramAuthGuard validates it and upserts the user.
 */
export class HttpApiClient implements ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly initDataRaw: string,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: this.initDataRaw,
          ...(init?.headers ?? {}),
        },
      });
    } catch {
      throw new ApiError(0, 'Network request failed');
    }
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body: unknown = await res.json();
        if (body && typeof body === 'object' && 'message' in body) {
          const m = (body as { message: unknown }).message;
          // Validation errors arrive as an ARRAY of strings; previously the
          // string-only check dropped them and the user saw the generic
          // "server error" text for a plain validation failure.
          if (typeof m === 'string') message = m;
          else if (Array.isArray(m)) message = m.filter((x) => typeof x === 'string').join('; ');
        }
      } catch {
        // keep default message
      }
      throw new ApiError(res.status, message);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  getMe() {
    return this.request<Me>('/me');
  }
  listContacts() {
    return this.request<Contact[]>('/contacts');
  }
  listRecentContacts() {
    return this.request<Contact[]>('/contacts/recent');
  }
  createContact(input: CreateContactInput) {
    return this.request<Contact>('/contacts', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  sharePhone(phone: string) {
    return this.request<PhoneLinkResult>('/me/phone', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    });
  }
  listExpenses() {
    return this.request<Expense[]>('/expenses');
  }
  createExpense(input: CreateExpenseInput) {
    return this.request<Expense>('/expenses', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  createGroupExpense(input: CreateGroupExpenseInput) {
    return this.request<CreateGroupExpenseResult>('/expenses/group', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }
  getBalances() {
    return this.request<Balance[]>('/balances');
  }
  netWithCounterparty(partyKey: string) {
    return this.request<NetResult>('/balances/net', {
      method: 'POST',
      body: JSON.stringify({ partyKey }),
    });
  }
  getSettlePlan(partyKeys: string[]) {
    return this.request<SettlePlan>('/balances/settle-plan', {
      method: 'POST',
      body: JSON.stringify({ partyKeys }),
    });
  }
  async settleShare(shareId: string) {
    await this.request<unknown>(`/shares/${shareId}/settle`, {
      method: 'POST',
    });
  }
  async unsettleShare(shareId: string) {
    await this.request<unknown>(`/shares/${shareId}/unsettle`, {
      method: 'POST',
    });
  }
  async deleteExpense(id: string) {
    await this.request<unknown>(`/expenses/${id}`, { method: 'DELETE' });
  }
  async deleteContact(id: string) {
    await this.request<unknown>(`/contacts/${id}`, { method: 'DELETE' });
  }
}
