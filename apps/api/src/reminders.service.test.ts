import { describe, expect, it } from "vitest";
import {
  localDateAndTime,
  normalizeReminderTimes,
} from "./reminders.service.js";

describe("recordatorios", () => {
  it("normaliza, ordena y elimina horarios duplicados", () => {
    expect(normalizeReminderTimes(["20:00", "08:30", "20:00"])).toEqual([
      "08:30",
      "20:00",
    ]);
  });

  it("calcula fecha y minuto en America/Bogota", () => {
    expect(
      localDateAndTime(new Date("2026-07-20T01:15:00Z"), "America/Bogota"),
    ).toEqual({ date: "2026-07-19", time: "20:15" });
  });
});
