import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { User } from '@prisma/client';
import { CurrentUser } from '../auth/current-user.decorator';
import { TelegramAuthGuard } from '../auth/telegram-auth.guard';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { ExpensesService } from './expenses.service';

@Controller('expenses')
@UseGuards(TelegramAuthGuard)
export class ExpensesController {
  constructor(private readonly expenses: ExpensesService) {}

  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateExpenseDto) {
    return this.expenses.createExpense(user, dto);
  }

  @Get()
  list(@CurrentUser() user: User) {
    return this.expenses.listExpenses(user.id);
  }
}
