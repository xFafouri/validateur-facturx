import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { raw } from 'express';
import { AppModule } from './app.module';

/** Mirrors the limit in `ReceptionController`; a Factur-X PDF is normally well under a megabyte. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Received invoices arrive as raw bytes - a PDF or an XML - and the default JSON parser would
  // reject them. Scoped to the one route rather than applied globally, so every other endpoint
  // keeps the strict JSON parsing and DTO validation the rest of the API relies on.
  //
  // The limit is enforced here as well as in the controller: by the time a handler runs, an
  // oversized body has already been read into memory, which is the thing worth preventing.
  app.use('/invoices/reception', raw({ type: () => true, limit: MAX_UPLOAD_BYTES }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      // Reject unknown fields outright rather than ignoring them: this API will accept invoice
      // data, where a silently-dropped field is a silently-wrong legal document.
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableShutdownHooks();

  // `API_PORT` first, because in this monorepo both apps read the same root `.env` and a bare
  // `PORT` there belongs to the web app - without this the API silently binds the web app's port
  // and one of them loses. `PORT` is still honoured for a container, where each app has its own
  // environment and `PORT` is the convention.
  const port = Number(process.env.API_PORT ?? process.env.PORT ?? 3001);
  await app.listen(port);
  new Logger('bootstrap').log(`API listening on :${port}`);
}

void bootstrap();
