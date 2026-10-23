# BUILD_LOG — Phase 0 (scaffold) + Phase 1 (backend core)

Date: 2026-10-21 · Environment: Node v24.20.0, npm 10.9.4, Ubuntu 24.04 (x86_64, OpenSSL 3.0)
Spec source: HANDOVER.md v1.0 + Addendum v1.1 (all three amendments implemented).

## What was created

- **Monorepo** (npm workspaces): root `package.json`, `README.md` (architecture,
  API table, run instructions, and a "📱 Mohammad's phone-only steps" section),
  `docker-compose.yml` (postgres:16 + redis:7 — for future use; docker is not
  installed on this VM), `.env.example` files at root, `apps/api`, `apps/web`.
- **apps/api — NestJS + TypeScript backend**
  - `prisma/schema.prisma`: HANDOVER models + v1.1 amendments — `User.phone`
    (unique), `Contact.phone` (+ index), `Expense.payerContactId` with both
    payer fields nullable (exactly-one enforced in the service), plus an
    `Expense.createdById` field (needed for settle authorization when the
    payer is a contact; the v1.0 schema had no creator field).
  - `auth/`: `validateInitData` (official Telegram HMAC-SHA256 algorithm,
    "WebAppData" secret, timing-safe compare, 24h `auth_date` limit) and
    `TelegramAuthGuard` (Authorization header = raw initData, optional `tma `
    prefix; upserts `User` by `telegramId`, attaches `request.user`).
  - `common/phone.util.ts`: Iranian mobile → E.164 normalization
    (09… / 9… / +98… / 98… / 0098…, separators ignored; landlines rejected).
  - `contacts/`: `POST/GET /contacts` (inline creation = same endpoint),
    `PhoneLinkService.linkContactsByPhone` — stores the phone on the user,
    links **all** unlinked contacts (any owner) with that phone, leaves their
    shares attached to the contacts; exposed via `POST /me/phone`.
  - `expenses/`: `POST /expenses` in a Prisma interactive transaction —
    payer = current user or owned `payerContactId`; participants = creator
    themself or creator's own contacts; equal split with the v1.1 remainder
    rule (+1 to first participants; 100000/3 → 33334/33333/33333) or custom
    split validated to sum to the total; payer's own share created settled.
    `GET /expenses` newest-first with shares.
  - `balances/`: `GET /balances` (per-counterparty net from unpaid shares;
    contacts resolve through `linkedUserId`), `POST /shares/:id/settle`
    (payer / creator / share holder only; idempotent).
  - DTO validation via class-validator + global ValidationPipe (whitelist).
  - Redis is in the stack/env/compose but intentionally **not wired yet**
    (no Phase 1 feature needs it; reserved for caching/sessions later).
- **apps/web — placeholder**: Vite + React + TS, `@telegram-apps/telegram-ui`
  + `@telegram-apps/sdk` declared and used (SDK `init()` guarded for
  non-Telegram browsers), Persian RTL hello screen. Full UI is Phase 2.

## Commands run and results

| Command | Result |
| --- | --- |
| `npm install` (root, workspaces) | ⚠️ failed twice — see issues below; succeeded as `npm install --ignore-scripts --no-audit --no-fund` → **added 656 packages** |
| `npx prisma validate` (dummy `DATABASE_URL`) | ✅ "The schema at prisma/schema.prisma is valid 🚀" |
| `npx prisma generate` | ✅ Generated Prisma Client v6.19.3 (after pointing `PRISMA_QUERY_ENGINE_LIBRARY` / `PRISMA_SCHEMA_ENGINE_BINARY` at manually downloaded engines — see issues) |
| `npm test` (apps/api, jest) | ✅ **4 suites, 33 tests, all passed** — initData accept/tamper/wrong-token/stale/24h-boundary, phone normalization (7 valid + 8 invalid cases), equal-split remainder + sum invariants, custom-split validation, phone-link merge with mocked Prisma |
| `npm run build` (root) | ✅ API `nest build` OK; web `tsc -b && vite build` OK (dist: index.html + assets) |
| Compiled-output smoke test | ✅ `dist` auth util accepts a correctly signed initData and rejects a wrong-token one |

## Dependency / environment issues encountered

1. **`@telegram-apps/telegram-ui@^3.0.0` does not exist.** The UI kit is still
   on the v2 line — pinned to `^2.1.13` (latest). `@telegram-apps/sdk` is v3
   (`^3.0.0` → installed 3.11.8). No code changes were needed.
2. **Prisma engine download is reset by this VM's egress proxy.** Every plain
   `npm install` failed in the `@prisma/engines` postinstall
   (`ECONNRESET` downloading engine binaries); npm's own audit request also
   reset once. Workaround used (documented so it can be repeated):
   - install with `--ignore-scripts --no-audit --no-fund`;
   - download the two engine files with `curl` (proxy-friendly) from
     `https://binaries.prisma.sh/all_commits/c2990dca591cba766e3b7ef5d9e8a84796e47ab7/debian-openssl-3.0.x/`
     → `libquery_engine-debian-openssl-3.0.x.so.node` and
     `schema-engine-debian-openssl-3.0.x` into `node_modules/@prisma/engines/`;
   - run `prisma generate` with `PRISMA_QUERY_ENGINE_LIBRARY` and
     `PRISMA_SCHEMA_ENGINE_BINARY` pointing at those files.
   On a normal network none of this is needed — a plain `npm install` works.
   `PRISMA_ENGINES_MIRROR` (npmmirror) was also tried; the reset persisted.
3. Versions resolved: NestJS 11.2.7, Prisma 6.19.3, React 18.3.1, Vite 6.4.4,
   TypeScript 5.9.3.

## Known Phase 1 simplifications (deliberate)

- A `userId` expense participant may only be the creator themself; everyone
  else participates via contacts (per the task spec). Lifting this (friends
  who already have accounts) is a small change in `ExpensesService`.
- `POST /me/phone` trusts the authenticated client to pass the number it got
  from Telegram's contact-share. Before production, the number must be fed
  from the **bot's verified contact update** (`contact.user_id` == sender) —
  see Phase 3 hardening.
- API runtime boot was not smoke-tested against a live DB (no Postgres on
  this VM and docker unavailable). First run: `docker compose up -d` on a
  docker-capable machine (or a hosted Postgres), then `prisma migrate dev`.

## What remains

**Phase 2 — frontend UI** (per HANDOVER §5): core layout (Header, Balance
Card, Transaction List), API client injecting initData, Add Expense modal
(amount/title + quick chips → contact selection with Recent + inline create →
split Equal/Custom), contacts & balances screens, MainButton + haptics,
light/dark theme, Persian RTL polish. Also a "Recent contacts" endpoint may
be added to the API (top 3–5 by usage).
**Phase 3 — deploy**: needs Mohammad's phone-only steps (root README):
BotFather bot creation + token via the secure form → set `BOT_TOKEN`,
menu-button/deep-link setup, hosting sign-ins (e.g. Vercel for web, Railway
for API + Postgres + Redis), bot webhook for verified contact-share feeding
`PhoneLinkService`, `prisma migrate deploy`, end-to-end test inside Telegram.

## Phase 2 — Frontend UI (completed 2026-10-21)

Design reference: Mohammad's three mockups in `design/` —
`mockup-dashboard.png`, `mockup-add-expense.png`, `mockup-custom-split.png`.
The UI follows them closely: white cards with ~20px radii and soft shadows
on a light gray-blue backdrop (`--tgui--secondary_bg_color`), primary blue
from Telegram's button color, green `#34a853` for positive/valid, red for
amounts owed, Persian digits + fa-IR formatting everywhere, and
initial-letter colored circles instead of photos for people (no external
stock images are shipped).

### Design-driven layouts
- **Dashboard**: greeting «سلام، {firstName} خوش آمدی 👋» + group line
  («{N} نفر • حساب گروهی»); soft green-tinted hero card (red when the net
  is negative) with wallet icon, «مجموع بدهی/طلب شما» as a large signed
  amount, «(به نفع شماست)»/«(بدهی شماست)» caption, and small طلب/بدهی
  breakdown; two actions side by side — primary «+ ثبت خرج گروهی جدید» and
  bezeled «🤝 تسویه حساب» (opens a person picker, then the per-share
  settle list); «تراکنش‌های اخیر» cards with a category emoji in a soft
  rounded square (guessed from the title: 🍕 ☕ 🚕 🛍️ 💡 🏠 🎬 🧾),
  «{payer} پرداخت کرد», «سهم هر نفر»/«سهم تو», a participant avatar
  stack, my outstanding signed net for that expense (+ green / − red,
  «تسویه شده ✅» when zero) and mockup-style relative dates («امروز • ۱۳:۴۲»).
  A per-person balances section follows; tapping any balance row or
  transaction opens a detail modal with per-share «تسویه شد» buttons where
  the backend rules allow them (mirror of the backend permission logic).
- **Add Expense — ONE bottom sheet** (amount, quick chips and participants
  together, like the mockup; not a paged wizard): title row «💼 ثبت خرج
  گروهی جدید» with a ✕ close; «مبلغ کل» input with تومان suffix; «⚡
  میانبرهای سریع» light-blue pills (+۵۰٬۰۰۰ / +۱۰۰٬۰۰۰ / +۵۰۰٬۰۰۰);
  «عنوان خرج»; compact payer chips (خودم or any contact → payerContactId);
  «🕐 پیشنهادهای اخیر» horizontal avatar circles from GET /contacts/recent
  plus a dashed «+ افزودن» circle that focuses the inline form;
  «افراد شرکت‌کننده» strip of selected avatar chips with blue ✓ badges and
  a «N نفر انتخاب شده» caption; «👥 انتخاب همکاران» searchable list («خودم»
  first) with round checkboxes and «انتخاب شده» pills; inline «افزودن همکار
  جدید» (name + phone, POST /contacts, auto-selects) in a light-blue box at
  the bottom of the same sheet; and the equal-split «🧮 محاسبه خودکار سهم
  هر نفر» box showing the per-person amount with the formula
  «مبلغ کل (Y) ÷ تعداد نفرات (N) = X» — using the exact backend remainder
  rule (when the split is uneven it shows the range and the exact
  per-person amounts).
- **Custom Split — dedicated view inside the same sheet**
  (mockup-custom-split): header «تنظیم سهم افراد (Custom Split)»; summary
  card split in two — «مبلغ کل» and «باقیمانده برای تقسیم» with a green ✓
  circle when the remainder is 0 (amber ! otherwise); per-person white
  cards with avatar, name, live «٪X از کل مبلغ» (fa-IR percent) and a
  تومان amount input prefilled from the equal split; green success banner
  «مجموع مبالغ وارد شده برابر با مبلغ کل است — X تومان» on an exact
  match; «بازگشت» / «تقسیم مساوی شود» exits. Submission everywhere goes
  through Telegram's MainButton — «ثبت و ارسال» on the main view,
  «تایید و ثبت نهایی» on the custom view — with progress state, haptic
  success/error feedback, and an in-app fallback button when the
  MainButton is unavailable (browser/mock contexts).

### Also built
- **API client** (`src/api/client.ts`): base URL from `VITE_API_URL`
  (default http://localhost:3000); raw Telegram initData attached as the
  Authorization header on every request; backend error messages mapped
  to friendly Persian. Environment gating (`src/telegram/env.ts`): real
  Telegram → HTTP client; plain browser → a clear «باید داخل تلگرام باز
  شود» notice with NO fabricated data; `?mock=1` → an unmistakable local
  demo (MockApiClient) behind a permanent red banner.
- **First-open phone prompt** (Addendum v1.1): when GET /me shows no
  phone, a friendly card offers SDK requestContact() with manual entry as
  an always-available fallback → POST /me/phone → reports how many
  contacts were linked. Dismissible on the dashboard (localStorage) and
  always available again, non-dismissible, on the مخاطب‌ها screen under
  «حساب من».
- **Contacts screen**: profile section (my phone/link state), list with
  avatars + «وصل شده» badges, create form (name + optional phone).
- **Shell**: Persian full RTL, telegram-ui AppRoot (theme follows
  Telegram light/dark via the official telegram-web-app.js script +
  SDK themeParams mounting), bottom Tabbar (داشبورد / مخاطب‌ها).

### Backend endpoints added in Phase 2
- `GET /me` — authenticated user incl. phone (telegramId as string).
- `GET /contacts/recent` — top 5 contacts by expense-share count
  (desc), each with `usageCount`. README API table updated.

### Verification (this VM: builds + unit tests only, no live run possible)
- Root `npm run build` — **passes** (api `nest build`; web `tsc -b` +
  `vite build`, bundle ≈ 346 kB / 106 kB gzip).
- API jest: **6 suites / 38 tests pass** (33 Phase 1 + 3 new
  listRecentContacts + 2 new MeController).
- Web vitest: **1 file / 10 tests pass** (`src/lib/split.test.ts` —
  equal-split mirror incl. 100000/3 → 33334/33333/33333, custom-split
  validation, Persian-digit amount parsing). Vitest installed cleanly;
  root `npm test` now runs API jest + web vitest.

### Issues / notes
- `Modal` from telegram-ui renders as a bottom sheet on mobile — matches
  the mockups. The vaul drawer needs the official
  `telegram-web-app.js` script for theming; added to `index.html`.
- `equalSplit` throws on 0 participants by design (mirrors the backend
  util); every UI call site guards `selected.length > 0`.
- One TS fix was needed in Phase 2 backend code: the recent-contacts
  accumulator needed an explicit element type (inferred `never[]`).
- No live E2E was possible here (no Postgres/Telegram client on this VM);
  the mock demo (`?mock=1`) exercises the full UI against an in-memory
  fake backend and is the closest available smoke test.
