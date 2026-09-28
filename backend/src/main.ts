import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

/**
 * ANWAR KPIFlow API bootstrap.
 * Security headers, CORS, cookie parsing, validation and graceful shutdown
 * per NFR-SEC-01 and NFR-ERR-01.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
    bodyParser: true,
  });

  const prefix = process.env.API_PREFIX ?? 'api/v1';

  // Security headers (NFR-SEC-01). CSP is served by the front-end host; the API
  // additionally forbids framing and MIME sniffing.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      frameguard: { action: 'deny' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: process.env.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true, preload: true } : false,
    }),
  );
  app.use(compression());
  app.use(cookieParser());

  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'If-Match', 'Idempotency-Key', 'X-Correlation-Id', 'X-Ops-Token'],
    exposedHeaders: ['X-Correlation-Id', 'Content-Disposition'],
    maxAge: 3600,
  });

  app.setGlobalPrefix(prefix);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      stopAtFirstError: false,
    }),
  );

  app.enableShutdownHooks();
  void VersioningType;

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port, '0.0.0.0');

  logger.log(`ANWAR KPIFlow API listening on http://localhost:${port}/${prefix}`);
  logger.log(`Health probe: http://localhost:${port}/${prefix}/health`);
  logger.log(`Environment: ${process.env.NODE_ENV ?? 'development'} · Timezone: ${process.env.TIMEZONE ?? 'Asia/Dhaka'}`);
}

bootstrap().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error:', error);
  process.exit(1);
});
