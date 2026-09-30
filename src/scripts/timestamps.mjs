const minute = 60_000;
const hour = 60 * minute;

// Use elapsed time for recent messages and local calendar dates for older ones.
export function relativeTimestamp(value, now = new Date(), locale = undefined) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const elapsed = Math.max(0, now.getTime() - date.getTime());
  if (elapsed < minute) return 'Just now';
  if (elapsed < hour) return `${Math.floor(elapsed / minute)}m ago`;
  if (elapsed < 24 * hour) return `${Math.floor(elapsed / hour)}h ago`;

  // UTC calendar ordinals avoid treating a DST day as exactly 24 hours.
  const calendarDay = d => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.round((calendarDay(now) - calendarDay(date)) / (24 * hour));
  if (days === 1) return 'Yesterday';
  if (days >= 2 && days <= 7) return date.toLocaleDateString(locale, { weekday: 'long' });
  return date.toLocaleDateString(locale, {
    month: 'short', day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
  });
}
