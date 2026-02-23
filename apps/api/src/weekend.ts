export function getWeekendKey(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date");
  }

  const utcDay = date.getUTCDay();
  const daysUntilSaturday = (6 - utcDay + 7) % 7;
  const saturday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + daysUntilSaturday));

  return saturday.toISOString().slice(0, 10);
}
