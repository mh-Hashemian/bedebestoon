import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  /**
   * Public health check (no Telegram auth). Lives at /health — NOT at / —
   * because / serves the frontend's index.html in the single-service deploy.
   */
  @Get('health')
  health(): { name: string; status: string } {
    return { name: 'telegram-expense-app api', status: 'ok' };
  }
}
