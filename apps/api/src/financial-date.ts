export function financialDate(date: Date, timezone = "America/Bogota"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (kind: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === kind)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function financialMonthStart(
  now: Date,
  timezone = "America/Bogota",
): Date {
  const month = financialDate(now, timezone).slice(0, 7);
  const target = Date.parse(`${month}-01T00:00:00Z`);
  let guess = target;
  for (let iteration = 0; iteration < 4; iteration++) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(guess));
    const n = (kind: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((p) => p.type === kind)!.value);
    const displayed = Date.UTC(
      n("year"),
      n("month") - 1,
      n("day"),
      n("hour"),
      n("minute"),
      n("second"),
    );
    const adjustment = target - displayed;
    guess += adjustment;
    if (!adjustment) break;
  }
  return new Date(guess);
}
