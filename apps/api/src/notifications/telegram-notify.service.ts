import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

/** The Mini App URL the bot's menu button already points to. */
const APP_URL = 'https://bedebestoon.onrender.com';

/**
 * Best-effort Telegram DMs from the bot (@bedebestoonrobot) about events
 * that concern a user: an expense recorded with them, a share settled or
 * re-opened, netting, a deletion.
 *
 * Deliberately fire-and-forget: every failure (no token, unknown user,
 * Telegram outage, user never opened the bot chat) is logged and
 * swallowed — a notification must never fail or slow the API request
 * that triggered it. The BOT_TOKEN is the same one the auth guard uses
 * for initData validation; the backend made no Telegram calls before
 * this service existed.
 */
@Injectable()
export class TelegramNotifyService {
  private readonly logger = new Logger(TelegramNotifyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Registered user's display name for message texts. Never throws. */
  async nameOf(userId: string): Promise<string> {
    try {
      const u = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true, lastName: true },
      });
      if (!u) return 'کاربر بده‌بستون';
      return [u.firstName, u.lastName].filter(Boolean).join(' ');
    } catch {
      return 'کاربر بده‌بستون';
    }
  }

  /** Send one DM to a registered user (by internal id). Never throws. */
  async notifyUser(userId: string, text: string): Promise<void> {
    try {
      const token = this.config.get<string>('BOT_TOKEN');
      if (!token) return;
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { telegramId: true },
      });
      if (!user) return;
      await this.sendMessage(token, Number(user.telegramId), text);
    } catch (err) {
      this.logger.warn(
        `notification to user ${userId} failed: ${(err as Error).message}`,
      );
    }
  }

  private async sendMessage(
    token: string,
    chatId: number,
    text: string,
  ): Promise<void> {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const post = (body: Record<string, unknown>) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

    // Preferred form: message + a button that opens the Mini App.
    let res = await post({
      chat_id: chatId,
      text,
      reply_markup: {
        inline_keyboard: [
          [{ text: 'باز کردن بده‌بستون', web_app: { url: APP_URL } }],
        ],
      },
    });
    if (!res.ok) {
      // A markup problem must not eat the message — retry plain.
      this.logger.warn(
        `sendMessage with button failed (HTTP ${res.status}); retrying plain`,
      );
      res = await post({ chat_id: chatId, text });
    }
    if (!res.ok) {
      this.logger.warn(`sendMessage failed (HTTP ${res.status})`);
    }
  }
}
