/** "http://localhost:3000/a8Xk2" -> "localhost:3000/a8Xk2" */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '');
}

export function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

/** ISO timestamp -> "2026-10-23" (UTC, matching the server's daily buckets). */
export function formatDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : 'never';
}

/** ISO timestamp -> "19:36:02" in the viewer's local time. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour12: false });
}

export function percent(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}
