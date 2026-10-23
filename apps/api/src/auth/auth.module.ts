import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { TelegramAuthGuard } from './telegram-auth.guard';

@Module({
  imports: [UsersModule],
  providers: [TelegramAuthGuard],
  // Re-export UsersModule: modules that apply TelegramAuthGuard via
  // @UseGuards get a guard instance resolved in their own context, so
  // they need UsersService visible — exporting the guard alone is not
  // enough (runtime UnknownDependenciesException, found 2026-10-21).
  exports: [TelegramAuthGuard, UsersModule],
})
export class AuthModule {}
