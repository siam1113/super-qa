import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { NestExpressApplication } from '@nestjs/platform-express';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // Use Nest's own body-parser registration (not a raw app.use(json())) so it stays aware of
  // rawBody capture. A manual app.use(path, json()) here makes Nest's ExpressAdapter think a
  // JSON parser is already installed (it sniffs middleware by function name), so it skips
  // registering its global parser and every OTHER route silently gets an empty, unparsed body.
  app.useBodyParser('json', { limit: '4mb' });
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: process.env.WEB_ORIGIN || 'http://localhost:3000',
    credentials: true,
  });

  const port = process.env.PORT || 4000;
  await app.listen(port);
  console.log(`API running on http://localhost:${port}`);
}

bootstrap();
