import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { BalancesModule } from './balances/balances.module';
import { ContactsModule } from './contacts/contacts.module';
import { ExpensesModule } from './expenses/expenses.module';
import { PrismaModule } from './prisma/prisma.module';
import { UsersModule } from './users/users.module';

// Frontend bundle location: apps/web/dist. From src (ts-node dev) __dirname is
// apps/api/src; from the build (node dist/main.js) it is apps/api/dist — going
// up three levels reaches the repo root in both cases.
const webDist = join(__dirname, '..', '..', '..', 'apps', 'web', 'dist');

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Serve the React frontend from the API itself (single-service deploy).
    // Only registered when the web bundle exists, so API-only dev/test runs
    // and fresh clones (before `npm run build`) keep working.
    ...(existsSync(webDist)
      ? [
          ServeStaticModule.forRoot({
            rootPath: webDist,
            serveStaticOptions: {
              // Telegram's webview caches index.html hard; without this a
              // redeploy keeps serving the old bundle on users' phones.
              // Hashed assets can cache forever, the entry page must not.
              setHeaders: (res, filePath) => {
                if (filePath.endsWith('index.html')) {
                  res.setHeader('Cache-Control', 'no-cache');
                }
              },
            },
          }),
        ]
      : []),
    PrismaModule,
    UsersModule,
    AuthModule,
    ContactsModule,
    ExpensesModule,
    BalancesModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
