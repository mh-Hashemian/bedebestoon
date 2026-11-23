import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { TelegramAuthGuard } from '../auth/telegram-auth.guard';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { CreateGroupExpenseDto } from './dto/create-group-expense.dto';
import { ExpensesService } from './expenses.service';

@Controller('expenses')
@UseGuards(TelegramAuthGuard)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateExpenseDto) {
    return this.expenses.createExpense(user, dto);
  }

  /** Multi-payer group expense («چندپرداخت‌کننده»): one form, several payers. */
  @Post('group')
  createGroup(
    @CurrentUser() user: User,
    @Body() dto: CreateGroupExpenseDto,
  ) {
    return this.expenses.createGroupExpense(user, dto);
  }

  @Get()
  list(@CurrentUser() user: User) {
    return this.expenses.listExpenses(user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    return this.expenses.removeExpense(user.id, id);
  }
}
