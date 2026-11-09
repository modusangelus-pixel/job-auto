const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const two = (n: number): string => String(n).padStart(2, '0')

/** `5 Nov`, in local time. */
export function dayMonth(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

/** `5 Nov 2026`, in local time. */
export function dayMonthYear(iso: string): string {
  return `${dayMonth(iso)} ${new Date(iso).getFullYear()}`
}

/** `5 Nov 2026, 09:05`, in local time. */
export function dateTime(iso: string): string {
  const d = new Date(iso)
  return `${dayMonthYear(iso)}, ${two(d.getHours())}:${two(d.getMinutes())}`
}

/** `5 Nov 09:05`, in local time. */
export function dayMonthTime(iso: string): string {
  const d = new Date(iso)
  return `${dayMonth(iso)} ${two(d.getHours())}:${two(d.getMinutes())}`
}

/** Whole local calendar days from the date to today (never below 0). */
export function daysAgo(iso: string, now: Date = new Date()): number {
  const d = new Date(iso)
  const from = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  const to = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.max(0, Math.round((to - from) / 86_400_000))
}

/** `posted today`, `posted 1 day ago`, `posted <n> days ago`. */
export function postedText(iso: string, now: Date = new Date()): string {
  const n = daysAgo(iso, now)
  if (n === 0) return 'posted today'
  return n === 1 ? 'posted 1 day ago' : `posted ${n} days ago`
}
