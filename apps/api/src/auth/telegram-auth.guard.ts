import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { validateInitData } from './telegram-init-data.util';

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  user?: User;
}

/**
 * Validates the Telegram initData sent in the Authorization header
 * ("Authorization: <raw initData>", an optional "tma " prefix is stripped),
 * then upserts the Telegram user and attaches it as `request.user`.
 */
@Injectable()
export class TelegramAuthGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly users: UsersService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AuthenticatedRequest>();

    const header = request.headers['authorization'];
    const raw = Array.isArray(header) ? header[0] : header;
    if (!raw) {
      throw new UnauthorizedException('Missing Authorization header');
    }
    const initData = raw.startsWith('tma ') ? raw.slice(4) : raw;

    const botToken = this.config.get<string>('BOT_TOKEN');
    if (!botToken) {
      throw new InternalServerErrorException('BOT_TOKEN is not configured');
    }

    let user;
    try {
      const validated = validateInitData(initData, botToken);
      user = await this.users.upsertFromTelegram(validated.user);
    } catch (err) {
      if (err instanceof InternalServerErrorException) throw err;
      throw new UnauthorizedException(
        `Invalid Telegram initData: ${(err as Error).message}`,
      );
    }

    request.user = user;
    return true;
  }
}
