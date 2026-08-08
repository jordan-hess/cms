/** The current coaching period, as the 1st of the current month ('YYYY-MM-DD'). */
export function getCurrentPeriodMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}
