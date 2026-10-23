# Telegram Expense Settlement Mini App (دنگ)

A Telegram Mini App for managing shared expenses and debts among coworkers and
friends — quick-add expense, equal or custom splits, and settle-up, all inside
Telegram with silent authentication. Full product spec: [HANDOVER.md](./HANDOVER.md)
(including the binding **Addendum v1.1** design decisions).

## Architecture

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│  Telegram client        │        │  apps/web  (Phase 2 UI)      │
│  opens Mini App ────────┼───────▶│  React + Vite + TypeScript   │
└─────────────────────────┘        │  @telegram-apps/telegram-ui  │
                                   │  @telegram-apps/sdk          │
                                   └──────────────┬───────────────┘
                          Authorization: <raw initData>
                                                  ▼
┌───────────────────────────────────────────────────────────────────┐
│  apps/api — NestJS + TypeScript                                   │
│  TelegramAuthGuard: validates initData (HMAC-SHA256, "WebAppData")│
│  modules: auth · users · contacts (+ phone linking) ·             │
│           expenses (atomic create, equal/custom split) ·          │
│           balances (per-person net balance, settle)               │
└──────────────┬───────────────────────────────┬────────────────────┘
               ▼                               ▼
        PostgreSQL (Prisma)              Redis (reserved —
        Users, Contacts,                 caching/session,
        Expenses, ExpenseShares          wired in a later phase)
```

### Key design points (Addendum v1.1)

- **Virtual contacts matched by phone number.** A contact is created with a
  name + phone (normalized to E.164). Telegram never exposes a phone in
  `initData`, so a joining user shares their number once via Telegram's native
  contact-share; the backend then links every unlinked contact with that
  number to the real user (`POST /me/phone`). Invite deep-links are the
  fallback. Name alone never auto-merges.
- **A virtual contact can be the payer** (`Expense.payerContactId`) — "Sajad
  paid" can be recorded before Sajad joins. Exactly one payer kind per expense.
- **Balances & settlement:** `GET /balances` computes per-counterparty net
  amounts from unpaid shares; `POST /shares/:id/settle` marks a share paid.
  Equal splits use a fixed remainder rule: leftover Tomans go +1 each to the
  first participants in list order (`100000 / 3 → 33334, 33333, 33333`).

### API surface (Phase 1)

All endpoints except `GET /` require `Authorization: <raw Telegram initData>`
(the guard also accepts an optional `tma ` prefix).

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET | `/` | Health check |
| POST | `/contacts` | Create contact (also inline creation in the app) |
| GET | `/contacts` | List my contacts (with link status) |
| GET | `/contacts/recent` | My top 5 contacts by expense-share usage (Phase 2) |
| GET | `/me` | Current authenticated user (incl. phone, Phase 2) |
| POST | `/me/phone` | Record my shared phone; link matching virtual contacts |
| POST | `/expenses` | Create expense + shares (one transaction) |
| GET | `/expenses` | My expenses, newest first, with shares |
| GET | `/balances` | Per-counterparty net balance (positive = they owe me) |
| POST | `/shares/:id/settle` | Mark a share as settled |

## Running locally

Prerequisites: Node ≥ 20, npm. (PostgreSQL/Redis only needed to run the API
against a real database — the unit tests do **not** need them.)

```bash
# 1. Install all workspaces
npm install

# 2. Configure the API
cp apps/api/.env.example apps/api/.env   # fill in BOT_TOKEN etc.

# 3a. Optional: local Postgres + Redis (on a machine WITH docker)
docker compose up -d
#     ...then apply the schema:
cd apps/api && DATABASE_URL=postgresql://expense:expense@localhost:5432/expense_app npx prisma migrate dev

# 3b. Run the API
npm run dev:api        # http://localhost:3000

# 4. Run the web app (Phase 2 UI; currently a hello screen)
npm run dev:web

# Tests (no database needed) and builds
npm test
npm run build
```

---

## 📱 Mohammad's phone-only steps

_Everything above is done by Muse on the computer. The steps below are the
ONLY things Mohammad ever has to do — all from his phone, no PC, no terminal._

1. **Create the bot (about 2 minutes, inside Telegram).**
   Open **@BotFather** in Telegram → send `/newbot` → pick a display name
   (e.g. «دنگ») and a username ending in `bot` (e.g. `DongSettleBot`).
   BotFather replies with a **token** — a long code. ⚠️ Never paste the token
   into a normal chat; hand it over only through the secure form Muse gives
   you. It goes into the API's `.env` as `BOT_TOKEN`.

2. **Connect the app to the bot (1 minute, also BotFather).**
   When Muse says the app is deployed, send `/setmenubutton` to BotFather,
   choose your bot, and paste the web address Muse gives you. From then on,
   the bot's menu button opens the Mini App. (Or Muse does this step via the
   Bot API once the token is in place — then you do nothing at all.)

3. **Hosting sign-ins (a few taps each, in the phone browser).**
   For free hosting, Muse may ask you to sign up / sign in (e.g. Vercel for
   the web app, Railway for the API + database) with your Google/GitHub
   account in your phone browser and tap "Authorize". Passwords and codes
   only ever go to those sites — never to Muse in chat.

4. **First real test (inside Telegram).**
   Open your bot, tap the menu button, and try it: add a contact with a phone
   number, record an expense, check balances. The first time, the app asks
   you to share your phone number with one tap on Telegram's own share sheet —
   that's how your account gets linked to contacts others created for you.

That's it — everything else (coding, testing, deploying, updating) happens
without you touching a computer.
