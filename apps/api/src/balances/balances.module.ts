import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BalancesController } from './balances.controller';
import { BalancesService } from './balances.service';

@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [BalancesController],
  providers: [BalancesService],
})
export class BalancesModule {}
