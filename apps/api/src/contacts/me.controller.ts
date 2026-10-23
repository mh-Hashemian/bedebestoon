import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { TelegramAuthGuard } from '../auth/telegram-auth.guard';
import { PhoneLinkService } from './phone-link.service';
import { SharePhoneDto } from './dto/share-phone.dto';

/** Public shape of the authenticated user (telegramId as string — JSON has no BigInt). */
export interface MeResponse {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  phone: string | null;
}

export function toMeResponse(user: User): MeResponse {
  return {
    id: user.id,
    telegramId: user.telegramId.toString(),
    username: user.username ?? null,
    firstName: user.firstName,
    lastName: user.lastName ?? null,
    phone: user.phone ?? null,
  };
}

@Controller('me')
@UseGuards(TelegramAuthGuard)
export class MeController {
  constructor(private readonly phoneLink: PhoneLinkService) {}

  /** The authenticated user's profile — incl. whether a phone is linked yet. */
  @Get()
  me(@CurrentUser() user: User) {
    return toMeResponse(user);
  }

  /**
   * Records the current user's shared phone number and links every virtual
   * contact that was created with that number (Addendum v1.1).
   *
   * Production note: the number must originate from Telegram's verified
   * contact-share (bot update where contact.user_id == sender id), so a
   * client can never claim someone else's number. Wiring the bot webhook
   * that feeds this service is a Phase 3 item.
   */
  @Post('phone')
  sharePhone(@CurrentUser() user: User, @Body() dto: SharePhoneDto) {
    return this.phoneLink.linkContactsByPhone(user.id, dto.phone);
  }
}
