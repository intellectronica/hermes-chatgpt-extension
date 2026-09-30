export const DISPLAY_TIMEZONE = 'Europe/Zurich';

export function formatInstant(instant?: string, long = false): string {
  if (!instant) return 'Unknown';
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: DISPLAY_TIMEZONE,
    day: '2-digit', month: 'short', ...(long ? { year: 'numeric' } : {}),
    hour: '2-digit', minute: '2-digit',
  }).format(date);
}

export function safeMarkdownUrl(value: string): string {
  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) && !url.username && !url.password ? value : '';
  } catch {
    return '';
  }
}

export function statusLabel(status?: string): string {
  if (!status) return 'Unknown';
  return status.replace(/[_-]/g, ' ').replace(/^./, (letter) => letter.toUpperCase());
}
