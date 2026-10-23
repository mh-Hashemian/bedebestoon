import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { normalizeIranianPhone } from '../common/phone.util';

export interface PhoneLinkResult {
  phone: string;
  linkedContactIds: string[];
  linkedCount: number;
}

/**
 * Addendum v1.1 — phone-number matching for virtual contacts.
 *
 * When a real user U shares their phone number P (via Telegram's native
 * contact-share; the bot backend verifies contact.user_id == U.telegramId
 * before calling this), we:
 *   1. store P on U (unique — it's U's identity key),
 *   2. find EVERY still-unlinked Contact with phone P — regardless of owner,
 *      because many different people may have added "Ali" as their contact,
 *   3. point each of those contacts at U (linkedUserId = U).
 *
 * The contacts' existing ExpenseShares are deliberately NOT rewritten: they
 * stay attached to the contact, and the contact now resolves to U everywhere
 * (balances resolve contact -> linkedUser). Matching is NEVER done on name
 * alone.
 */
@Injectable()
export class PhoneLinkService {
  constructor(private readonly prisma: PrismaService) {}

  async linkContactsByPhone(
    userId: string,
    rawPhone: string,
  ): Promise<PhoneLinkResult> {
    const phone = normalizeIranianPhone(rawPhone);
    if (!phone) {
      throw new BadRequestException(
        'phone is not a valid Iranian mobile number',
      );
    }

    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { phone },
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'This phone number is already linked to another account',
        );
      }
      throw err;
    }

    const candidates = await this.prisma.contact.findMany({
      where: { phone, linkedUserId: null },
      select: { id: true },
    });
    const linkedContactIds = candidates.map((c) => c.id);

    if (linkedContactIds.length > 0) {
      await this.prisma.contact.updateMany({
        where: { id: { in: linkedContactIds } },
        data: { linkedUserId: userId },
      });
    }

    return {
      phone,
      linkedContactIds,
      linkedCount: linkedContactIds.length,
    };
  }
}
