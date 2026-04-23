/**
 * 本机日历与 UTC 的「以东经分钟数」偏移（与 `Date#getTimezoneOffset()` 符号相反）。
 * 例如东八区为 480；美东标准时约为 -300。用于与后端按同一时区换算提交展示日期与活动分桶。
 */
export function getClientCalendarOffsetEastMinutes(): number {
  return -new Date().getTimezoneOffset()
}
