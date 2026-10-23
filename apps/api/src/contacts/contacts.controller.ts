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
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';

@Controller('contacts')
@UseGuards(TelegramAuthGuard)
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  /** Also used for inline creation inside "Select Participants". */
  @Post()
  create(@CurrentUser() user: User, @Body() dto: CreateContactDto) {
    return this.contacts.createContact(user.id, dto);
  }

  @Get()
  list(@CurrentUser() user: User) {
    return this.contacts.listContacts(user.id);
  }

  /** Top contacts by expense-share usage — powers the "Recent" section. */
  @Get('recent')
  recent(@CurrentUser() user: User) {
    return this.contacts.listRecentContacts(user.id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentUser() user: User, @Param('id') id: string) {
    return this.contacts.removeContact(user.id, id);
  }
}
