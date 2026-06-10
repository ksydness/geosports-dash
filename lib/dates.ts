// The game rolls over at midnight Eastern — all date math uses America/New_York.

const ET_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' });

/** Today's date (YYYY-MM-DD) in Eastern time. */
export function todayET(): string {
  return ET_FORMAT.format(new Date());
}

/** Date (YYYY-MM-DD) in Eastern time, `days` days ago. */
export function etDateMinusDays(days: number): string {
  return ET_FORMAT.format(new Date(Date.now() - days * 86400000));
}
