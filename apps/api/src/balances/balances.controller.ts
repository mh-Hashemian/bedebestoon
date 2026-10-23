import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { TelegramAuthGuard } from '../auth/telegram-auth.guard';
import { BalancesService } from './balances.service';

@Controller()
@UseGuards(TelegramAuthGuard)
export class BalancesController {
  constructor(private readonly balances: BalancesService) {}

  /** Per-counterparty net balances (positive = they owe you). */
  @Get('balances')
  getBalances(@CurrentUser() user: User) {
    return this.balances.getBalances(user.id);
  }

  /** Mark a share as settled/paid. */
  @Post('shares/:id/settle')
  settle(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) shareId: string,
  ) {
    return this.balances.settleShare(user.id, shareId);
  }
}
