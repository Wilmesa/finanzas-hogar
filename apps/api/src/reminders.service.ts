import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import webpush from "web-push";
import { z } from "zod";
import type { Actor } from "./auth.js";
import { PrismaService } from "./prisma.service.js";

const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const preferenceSchema = z.object({
  enabled: z.boolean(),
  timezone: z.string().min(1).max(80),
  times: z.array(z.string().regex(timePattern)).min(1).max(96),
});
const subscriptionSchema = z.object({
  endpoint: z.string().url().max(4096),
  keys: z.object({
    p256dh: z.string().min(16).max(512),
    auth: z.string().min(8).max(256),
  }),
});

export function normalizeReminderTimes(times: string[]) {
  return [...new Set(times)].sort();
}

export function localDateAndTime(now: Date, timezone: string) {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
  } catch {
    throw new BadRequestException("La zona horaria no es válida");
  }
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    time: `${value("hour")}:${value("minute")}`,
  };
}

@Injectable()
export class RemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RemindersService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const publicKey = process.env.VAPID_PUBLIC_KEY;
    const privateKey = process.env.VAPID_PRIVATE_KEY;
    const origin = process.env.APP_ORIGIN;
    if (!publicKey || !privateKey || !origin) {
      this.logger.warn(
        "Web Push desactivado: falta configuración VAPID u APP_ORIGIN",
      );
      return;
    }
    webpush.setVapidDetails(
      `mailto:admin@${new URL(origin).hostname}`,
      publicKey,
      privateKey,
    );
    void this.processSafely();
    this.timer = setInterval(() => void this.processSafely(), 30_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async processSafely() {
    try {
      await this.processDue();
    } catch (cause) {
      this.logger.error(
        "Falló el ciclo de recordatorios Web Push",
        cause instanceof Error ? cause.stack : String(cause),
      );
    }
  }

  publicKey() {
    if (!process.env.VAPID_PUBLIC_KEY)
      throw new BadRequestException("Web Push no está configurado");
    return { publicKey: process.env.VAPID_PUBLIC_KEY };
  }

  async preference(actor: Actor) {
    return (
      (await this.prisma.reminderPreference.findUnique({
        where: { memberId: actor.memberId },
      })) ?? {
        memberId: actor.memberId,
        householdId: actor.householdId,
        enabled: false,
        timezone: "America/Bogota",
        times: ["20:00"],
      }
    );
  }

  async updatePreference(body: unknown, actor: Actor) {
    const parsed = preferenceSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(
        parsed.error.issues.map((issue) => issue.message).join(", "),
      );
    localDateAndTime(new Date(), parsed.data.timezone);
    const times = normalizeReminderTimes(parsed.data.times);
    return this.prisma.reminderPreference.upsert({
      where: { memberId: actor.memberId },
      create: {
        ...parsed.data,
        times,
        memberId: actor.memberId,
        householdId: actor.householdId,
      },
      update: { ...parsed.data, times },
    });
  }

  async subscribe(body: unknown, actor: Actor, userAgent?: string) {
    const parsed = subscriptionSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException("Suscripción Web Push inválida");
    const existing = await this.prisma.pushSubscription.findUnique({
      where: { endpoint: parsed.data.endpoint },
    });
    if (existing && existing.memberId !== actor.memberId)
      throw new ForbiddenException("La suscripción pertenece a otra sesión");
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: parsed.data.endpoint },
      create: {
        householdId: actor.householdId,
        memberId: actor.memberId,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        userAgent: userAgent?.slice(0, 500) ?? null,
      },
      update: {
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        userAgent: userAgent?.slice(0, 500) ?? null,
      },
    });
    return { subscribed: true };
  }

  async unsubscribe(endpoint: string, actor: Actor) {
    await this.prisma.pushSubscription.deleteMany({
      where: {
        endpoint,
        memberId: actor.memberId,
        householdId: actor.householdId,
      },
    });
    return { removed: true };
  }

  async processDue(now = new Date()) {
    if (this.running || !process.env.VAPID_PUBLIC_KEY)
      return { processed: 0, sent: 0 };
    this.running = true;
    let processed = 0;
    let sent = 0;
    try {
      const preferences = await this.prisma.reminderPreference.findMany({
        where: { enabled: true },
        include: { member: { select: { pushSubscriptions: true } } },
      });
      for (const preference of preferences) {
        const local = localDateAndTime(now, preference.timezone);
        const times = Array.isArray(preference.times)
          ? preference.times.filter(
              (value): value is string => typeof value === "string",
            )
          : [];
        if (
          !times.includes(local.time) ||
          preference.member.pushSubscriptions.length === 0
        )
          continue;
        const localDate = new Date(`${local.date}T00:00:00Z`);
        const checkedIn = await this.prisma.dailyCheckIn.findUnique({
          where: {
            memberId_localDate: { memberId: preference.memberId, localDate },
          },
          select: { id: true },
        });
        if (checkedIn) continue;
        try {
          await this.prisma.reminderDelivery.create({
            data: {
              householdId: preference.householdId,
              memberId: preference.memberId,
              localDate,
              scheduledTime: local.time,
              status: "processing",
            },
          });
        } catch (cause) {
          if (
            cause instanceof Prisma.PrismaClientKnownRequestError &&
            cause.code === "P2002"
          )
            continue;
          throw cause;
        }
        processed += 1;
        let delivered = 0;
        for (const subscription of preference.member.pushSubscriptions) {
          try {
            await webpush.sendNotification(
              {
                endpoint: subscription.endpoint,
                keys: { p256dh: subscription.p256dh, auth: subscription.auth },
              },
              JSON.stringify({
                title: "Nuestro Dinero",
                body: "¿Ya registraste los movimientos de hoy?",
                url: "/transactions?action=new",
                tag: `daily-expenses-${local.date}-${local.time}`,
              }),
              { TTL: 3600, urgency: "normal" },
            );
            delivered += 1;
          } catch (cause) {
            const statusCode =
              typeof cause === "object" && cause && "statusCode" in cause
                ? Number(cause.statusCode)
                : 0;
            if (statusCode === 404 || statusCode === 410) {
              await this.prisma.pushSubscription.delete({
                where: { id: subscription.id },
              });
            } else {
              this.logger.warn(
                `Falló una entrega Web Push (${statusCode || "sin código"})`,
              );
            }
          }
        }
        await this.prisma.reminderDelivery.update({
          where: {
            memberId_localDate_scheduledTime: {
              memberId: preference.memberId,
              localDate,
              scheduledTime: local.time,
            },
          },
          data: {
            status: delivered > 0 ? "sent" : "failed",
            sentAt: delivered > 0 ? new Date() : null,
            errorCode: delivered > 0 ? null : "no_active_subscription",
          },
        });
        if (delivered > 0) sent += 1;
      }
      return { processed, sent };
    } finally {
      this.running = false;
    }
  }
}
