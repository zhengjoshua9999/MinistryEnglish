/** 后端存的是不带时区标记的 UTC 时间（Python 的 datetime.utcnow()），直接拿字符串
 * 给 `new Date()` 解析会被当成本地时间，显示出来的时间会偏移。补一个 Z 再解析。 */
export function formatDateTime(iso: string): string {
  const withZone = /[Zz]|[+-]\d\d:\d\d$/.test(iso) ? iso : `${iso}Z`
  const d = new Date(withZone)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
