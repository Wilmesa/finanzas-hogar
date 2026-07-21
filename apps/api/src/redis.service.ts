import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { createClient } from "redis";

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client = createClient({
    url: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",
  });

  constructor() {
    this.client.on("error", (error) =>
      this.logger.error("Redis no disponible", error),
    );
  }

  async onModuleInit() {
    if (!this.client.isOpen) await this.client.connect();
  }

  async onModuleDestroy() {
    if (this.client.isOpen) await this.client.quit();
  }
}
