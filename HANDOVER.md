# Project Handover: Telegram Debt & Expense Settlement Mini App
Date: May 24, 2024
Version: 1.0
Status: Planning & Architecture Phase (Ready for Frontend Implementation)

## 1. Executive Summary
Telegram Mini App (TMA) to manage shared expenses and debts among coworkers and friends. Core value: speed, simplicity, zero-friction onboarding via Telegram authentication and identity. Ready to transition from architecture to frontend development using React and the Telegram UI Kit.

## 2. Product Context & User Flow
Targets professional teams who split costs (team lunches, coffee, cab fares). Minimize time/effort to record a shared expense.
- Platform: Strictly a Telegram Mini App. No standalone web/mobile app in initial phase.
- Authentication: Silent auth via Telegram initData. No login/signup.
- Virtual Contacts: users can add expenses with colleagues who haven't used the app; system creates a "Virtual Contact" linked to the adder, based solely on a Name (string). Auto-Linkage: when the colleague opens the Mini App, their Telegram ID is matched with existing Virtual Contact records via backend logic, merging accounts.
- Expense Management: Quick Add; Equal Split default; Custom/Unequal Split with manual per-person adjustment.
- Shortcuts: Inline Contact Creation inside "Select Participants"; Recent Contacts (top 3-5 frequent); Quick Amount Chips (+50k, +100k, +500k Tomans).

## 3. Technology Stack
Backend: NestJS (Node.js), TypeScript, PostgreSQL, Prisma ORM, Redis (cache/session).
Frontend: React + Vite, TypeScript, @telegram-apps/telegram-ui, @telegram-apps/sdk (initData, haptics, MainButton).

## 4. System Architecture & Technical Decisions
### 4.1 Auth & Security
Telegram initData -> frontend passes it to NestJS via Authorization header -> custom TelegramAuthGuard validates with HMAC-SHA256 against Bot Token -> user retrieved or created.

### 4.2 Database Schema (Prisma)
Models: User (id uuid, telegramId BigInt unique, username?, firstName, lastName?, paymentsMade Expense[] "ExpensePayer", sharesReceived ExpenseShare[] "UserShares", contactsOwned Contact[] "ContactOwner", createdAt),
Contact (id uuid, name, linkedUserId? -> User "LinkedUser", ownerId -> User "ContactOwner", shares ExpenseShare[] "ContactShares", @@unique([ownerId, name])),
Expense (id uuid, title, totalAmount Int (Tomans), payerId -> User "ExpensePayer", shares, createdAt),
ExpenseShare (id uuid, amount Int, isPaid default false, expenseId -> Expense (Cascade), userId? -> User "UserShares", contactId? -> Contact "ContactShares").

### 4.3 Creating a Group Expense
Atomic via Prisma interactive transactions: create Expense (payer = current user), iterate participants (User or Contact UUIDs), calculate split (handle remainder), create ExpenseShares, commit.

### 4.4 Frontend UI/UX
Native look via telegram-ui; light/dark from Telegram theme; RTL for Persian; SPA feel; Bottom Sheets/Modals for forms (Add Expense); MainButton for submission; haptic feedback for confirmations.

## Addendum v1.1 — Design decisions (2026-10-21, agreed with Mohammad)
1. **Virtual-contact matching is by PHONE NUMBER** (Mohammad's proposal), not name alone:
   - Contact model gains `phone` (normalized E.164, e.g. +98912…; Iranian formats 09…/+98/0098 normalized on write). Owner enters name + phone when creating a virtual contact; phone is required for auto-linking (without it, the contact can never auto-link).
   - User model gains `phone` (unique, nullable), filled only after the user shares their contact.
   - Telegram does NOT give the phone number in initData and cannot be fetched from a Telegram ID. On first open, if the user's phone is unknown, the app shows a one-time prompt with Telegram's native contact-share action (requestContact / request_contact button). The bot backend receives the shared contact, verifies it belongs to the sender (contact.user_id == telegramId), normalizes, then links every unlinked Contact with that phone: shares are merged onto the real user.
   - Fallbacks when matching fails (owner entered a different line than the Telegram account number, or user declines to share): per-contact invite deep link (t.me/bot?start=invite_<token>) and owner-confirmed name suggestion. Never auto-merge on name alone.
   - Privacy: phone is used only as a matching key; not shown to other users.
2. **Payer can be a virtual contact**: Expense gains optional `payerContactId` (exactly one of payerId / payerContactId set), so "Sajad paid" can be recorded before Sajad joins.
3. **Balance & settlement layer** (missing from v1.0): per-person balance computation from unpaid shares, expense/transaction list, mark-share-paid / settle-up actions, and a fixed remainder rule for equal splits (remainder Tomans distributed +1 to the first participants in list order).

## 5. Next Steps
1. Initialize React + TS + Vite project with telegram-ui (Tailwind optional).
2. Core layout: Header, Balance Card, Transaction List.
3. API client service injecting initData auth header.
4. Add Expense Modal: Step 1 Amount/Title/Quick Chips; Step 2 Contact Selection (incl. Recent); Step 3 Inline Contact Creation; Step 4 Split logic (Equal -> Custom toggle).
5. Connect frontend forms to backend endpoints.
