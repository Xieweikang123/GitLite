/** 本地日历日 → YYYY-MM-DD（与 `<input type="date">` 的 value 一致） */
export function formatLocalYmd(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 解析 YYYY-MM-DD 为本地日期的 0 点（无效则 undefined） */
export function parseLocalYmd(s: string): Date | undefined {
  if (!s) return undefined
  const parts = s.split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return undefined
  const [y, m, d] = parts
  const dt = new Date(y, m - 1, d)
  if (Number.isNaN(dt.getTime())) return undefined
  return dt
}
