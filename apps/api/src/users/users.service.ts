import { Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramInitDataUser } from '../auth/telegram-init-data.util';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Find the user for a validated Telegram identity, creating the account on
   * first open (silent onboarding — no signup form, per HANDOVER §2).
   */
  async upsertFromTelegram(tg: TelegramInitDataUser): Promise<User> {
    const telegramId = BigInt(tg.id);
    return this.prisma.user.upsert({
      where: { telegramId },
      update: {
        firstName: tg.first_name,
        lastName: tg.last_name ?? null,
        username: tg.username ?? null,
      },
      create: {
        telegramId,
        firstName: tg.first_name,
        lastName: tg.last_name ?? null,
        username: tg.username ?? null,
      },
    });
  }
}
