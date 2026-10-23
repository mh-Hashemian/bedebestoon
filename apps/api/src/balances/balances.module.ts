import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BalancesController } from './balances.controller';
import { BalancesService } from './balances.service';

@Module({
  imports: [AuthModule],
  controllers: [BalancesController],
  providers: [BalancesService],
})
export class BalancesModule {}
