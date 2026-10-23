import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Telegram ids are BigInt in the DB; make them JSON-serializable as strings
// as a safety net (services additionally select only public fields).
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON =
  function (this: bigint): string {
    return this.toString();
  };

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();
