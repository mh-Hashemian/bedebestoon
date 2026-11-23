import {
  Body,
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
import { NetBalanceDto } from './dto/net-balance.dto';
import { SettlePlanDto } from './dto/settle-plan.dto';

@Controller()
@UseGuards(TelegramAuthGuard)
export class BalancesController {
  constructor(private readonly balances: BalancesService) {}

  /** Per-counterparty net balances (positive = they owe you). */
  @Get('balances')
  getBalances(@CurrentUser() user: User) {
    return this.balances.getBalances(user.id);
  }

  /**
   * «کم و وجه»: cross out the open shares between the user and one
   * counterparty that cancel each other, leaving only the net remainder.
   */
  @Post('balances/net')
  net(@CurrentUser() user: User, @Body() dto: NetBalanceDto) {
    return this.balances.netWithCounterparty(user.id, dto.partyKey);
  }

  /**
   * «تسویه گروهی»: the minimum-transaction plan for the user and the
   * selected counterparties — who pays whom, and how much, so every
   * party's net becomes zero. Read-only: it settles nothing by itself.
   */
  @Post('balances/settle-plan')
  settlePlan(@CurrentUser() user: User, @Body() dto: SettlePlanDto) {
    return this.balances.getSettlePlan(user.id, dto.partyKeys);
  }

  /** Mark a share as settled/paid. */
  @Post('shares/:id/settle')
  settle(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) shareId: string,
  ) {
    return this.balances.settleShare(user.id, shareId);
  }

  /** Undo a settlement (accidental taps happen). */
  @Post('shares/:id/unsettle')
  unsettle(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) shareId: string,
  ) {
    return this.balances.unsettleShare(user.id, shareId);
  }
}
