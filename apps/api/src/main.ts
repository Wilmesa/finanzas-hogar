import "reflect-metadata";
import { Logger, ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import fastifyCookie from "@fastify/cookie";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true, trustProxy: true }),
  );
  await app.register(fastifyCookie);
  app.enableCors({
    origin:
      process.env.APP_ORIGIN ??
      process.env.APP_BASE_URL ??
      "http://localhost:5173",
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000), "0.0.0.0");
  Logger.log("API disponible en http://localhost:3000");
}

void bootstrap();
