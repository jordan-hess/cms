export function formatDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

const BUSINESS_TIMEZONE = 'Africa/Johannesburg'

/** Returns "today" as a local Date, resolved in the business's own timezone
 *  regardless of what timezone the Node process itself is running in. */
export function getBusinessToday(): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
  const [y, m, d] = parts.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** ISO day-of-week: 1=Mon … 7=Sun */
export function getIsoDayOfWeek(date: Date): number {
  const day = date.getDay()   // 0=Sun
  return day === 0 ? 7 : day
}

/** Returns the Monday of the ISO week containing `date` */
export function getISOWeekStart(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const day = d.getDay()   // 0=Sun
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  return d
}

/** Returns 7 dates Mon–Sun for the week containing `date` */
export function getWeekDays(date: Date): Date[] {
  const monday = getISOWeekStart(date)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

/**
 * Returns all dates that appear in a monthly calendar grid (6 rows × 7 cols).
 * Includes leading/trailing days from adjacent months to fill the grid.
 */
export function getMonthGridDays(year: number, month: number): Date[] {
  const firstOfMonth = new Date(year, month, 1)

  const gridStart = getISOWeekStart(firstOfMonth)

  // Always produce exactly 6 rows (42 days) so the grid height is stable
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    return d
  })
}

/** ±3-month date range for prefetching roster data */
export function getRosterFetchRange(year: number, month: number): { from: string; to: string } {
  const from = new Date(year, month - 3, 1)
  const to = new Date(year, month + 4, 0)
  return { from: formatDateKey(from), to: formatDateKey(to) }
}

export function formatShiftTime(time: string): string {
  // time is 'HH:MM:SS' from Postgres
  const [h, m] = time.split(':')
  const hour = parseInt(h, 10)
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${m} ${suffix}`
}

export function isSameMonth(date: Date, year: number, month: number): boolean {
  return date.getFullYear() === year && date.getMonth() === month
}

export function isToday(date: Date): boolean {
  const today = new Date()
  return formatDateKey(date) === formatDateKey(today)
}
