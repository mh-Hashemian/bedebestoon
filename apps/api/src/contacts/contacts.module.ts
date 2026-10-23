import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { MeController } from './me.controller';
import { PhoneLinkService } from './phone-link.service';

@Module({
  imports: [AuthModule],
  controllers: [ContactsController, MeController],
  providers: [ContactsService, PhoneLinkService],
  exports: [PhoneLinkService],
})
export class ContactsModule {}
