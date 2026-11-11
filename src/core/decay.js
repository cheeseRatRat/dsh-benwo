/**
 * 结算：淡，但不删。
 *
 * 契约 v0.2 第 6 节。全部是纯函数，传入 now 和记录就能算完。
 * 半衰期 = 14 × 重要度（天）：重要度 1 半个月淡，5 两个多月才淡。
 * 这是有界乘子——半衰期差两倍，一年后强度能差二十倍，无界乘子会把噪声放大。
 */
export const NEW_STRENGTH = 40
export const NEW_IMPORTANCE = 3
export const FLOOR = 3
export const CAP = 95
export const DAY_MS = 86400000
export const HALF_LIFE_PER_IMPORTANCE = 14

export const INJECT_MIN = 12
export const IMPORTANT_EXCEPTION = { importance: 5, min: 6 }

export const TIERS = [
  { name: '清晰', min: 45 },
  { name: '清楚', min: 25 },
  { name: '模糊', min: 12 },
  { name: '只剩印象', min: 6 },
  { name: '沉底', min: 0 },
]

export function clamp(value, lo = 0, hi = 100) {
  if (!Number.isFinite(value)) return lo
  return Math.min(hi, Math.max(lo, value))
}

export function clampImportance(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return NEW_IMPORTANCE
  return Math.min(5, Math.max(1, Math.round(n)))
}

/** 重要度 1 → 14 天，5 → 70 天。 */
export function halfLifeDays(importance) {
  return HALF_LIFE_PER_IMPORTANCE * clampImportance(importance)
}

/** s ← max(3, s · 2^(−Δt / H)) */
export function settleStrength(strength, days, importance) {
  const base = Number.isFinite(Number(strength)) ? Number(strength) : NEW_STRENGTH
  const elapsed = Math.max(0, Number(days) || 0)
  if (elapsed === 0) return clamp(base, FLOOR, CAP)
  const h = halfLifeDays(importance)
  return clamp(Math.max(FLOOR, base * Math.pow(2, -elapsed / h)), FLOOR, CAP)
}

/** 被提起：s ← min(95, s + (100−s)·(0.25 + 0.05·min(证据,5))) */
export function reinforce(strength, evidence) {
  const base = Number.isFinite(Number(strength)) ? Number(strength) : NEW_STRENGTH
  const boost = 0.25 + 0.05 * Math.min(Math.max(0, Number(evidence) || 0), 5)
  return Math.min(CAP, base + (100 - base) * boost)
}

export function clarityOf(strength) {
  const s = Number(strength)
  for (const tier of TIERS) {
    if (s >= tier.min) return tier.name
  }
  return '沉底'
}

/** 本地日期文本，YYYY-MM-DD。 */
export function dayText(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/**
 * 到期了没有（B2）。
 *
 * 治「重要度 5 永久占名额」：半衰期 70 天，从 40 掉到 6 要 190 天，
 * 这期间它一直挤在浮上的名单里。有了 `有效到`，到期就不主动晃——
 * **但不删、能被召回、面板可见**，跟「沉底」同一个哲学。
 */
export function expired(record, now = new Date()) {
  const until = String((record && record['有效到']) || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return false
  return until < dayText(now)
}

/** 能不能进注入：s ≥ 12，或重要度 5 且 s ≥ 6；并且没到期。 */
/**
 * 「还活着」和「还能拿出来用」是两件事（2026-11-11 统一）。
 *
 * 以前这两个判断散在 11 处、写法有 5 种，还出过一次真 bug：
 * `已内化` 的原记录在矛盾检测里被排除了，注入里却照浮——内化了还占位置。
 */
/** 存档层面还活着：没被取代。面板、整理、共同经历用这个。 */
export const DEAD_STATUS = new Set(['被取代'])
export const isAlive = (record) => Boolean(record) && !DEAD_STATUS.has(String(record['状态'] || ''))

/**
 * 还能拿出来用：没被取代、没做完、没作废、已内化的原记录也不再浮。
 * 注入和召回用这个。预期「做了」的不算——那是好事，留着。
 */
export const DONE_STATUS = new Set(['被取代', '已完成', '作罢', '已内化'])
export const isFloatable = (record) => Boolean(record) && !DONE_STATUS.has(String(record['状态'] || ''))

export function injectable(record, now = new Date()) {
  if (!isFloatable(record)) return false
  if (expired(record, now)) return false
  const s = Number(record['强度'])
  const m = Number(record['重要度'])
  if (!Number.isFinite(s)) return false
  if (s >= INJECT_MIN) return true
  return m >= IMPORTANT_EXCEPTION.importance && s >= IMPORTANT_EXCEPTION.min
}

/**
 * 解析时间。纯日期（`2026-11-09`）按**本地**零点算，不按 UTC。
 *
 * 以前直接用 `new Date('2026-11-09')`——JS 把纯日期当成 UTC 零点，
 * 于是在 UTC+8 就变成「当天 08:00」。跟 `上次`（完整 ISO）一比就差 8 小时，
 * 会算出「上次早于首次」这种假异常（自查 2026-11-09 踩过）。
 */
export function parseTime(value) {
  const text = String(value || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return new Date(text + 'T00:00:00').getTime()
  return new Date(text).getTime()
}

export function daysBetween(from, to) {
  const a = parseTime(from)
  const b = parseTime(to)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0
  return Math.max(0, (b - a) / DAY_MS)
}

/** 结算一条。返回新对象，不改入参；永不删，最坏是 dormant。 */
export function settleRecord(record, now = new Date()) {
  const lastAt = record['上次'] || record['首次']
  const days = daysBetween(lastAt, now)
  const next = settleStrength(record['强度'], days, record['重要度'])
  /**
   * 「被取代」是人给它判的，不是算出来的（自查，2026-11-09）。
   *
   * 以前这里无条件重算成 active/dormant，于是每轮惰性结算都把「被取代」冲掉：
   * 视图里那条又活过来，召回和注入照收；按一下「结算一下」更狠——永久写没，真复活。
   * 强度照算、照淡，但人判过的状态不许被算回去。
   */
  const status =
    record['状态'] === '被取代'
      ? '被取代'
      : next < IMPORTANT_EXCEPTION.min
        ? 'dormant'
        : 'active'
  return {
    ...record,
    '强度': Math.round(next * 10) / 10,
    '状态': status,
    '上次': new Date(now).toISOString(),
    _days: days,
    _changed: Math.abs(next - Number(record['强度'])) > 0.05 || status !== record['状态'],
  }
}

/** 全量结算。ids 只结算点名的（召回后顺手结算），不传就全结。 */
export function settleAll(records, now = new Date(), ids = null) {
  const wanted = ids ? new Set(ids) : null
  const next = []
  let touched = 0
  let dormant = 0
  for (const record of records) {
    if (wanted && !wanted.has(record.id)) {
      next.push(record)
      continue
    }
    const settled = settleRecord(record, now)
    if (settled._changed) touched += 1
    if (settled['状态'] === 'dormant') dormant += 1
    const { _days, _changed, ...clean } = settled
    next.push(clean)
  }
  return { records: next, touched, dormant, cooled: [] }
}

const NAME_MAX = { 清晰: 60, 清楚: 30, 模糊: 16, 只剩印象: 10 }

function firstLine(record) {
  /** 正文第一行常带「看见了什么：」这层壳（写记忆时自己加的标签），注入里不该露出它。 */
  return (
    String(record.body || '')
      .split(/\r?\n/)
      .map((line) => line.replace(/^[#>\-\s]+/, '').trim())
      .filter(Boolean)[0] || ''
  )
    .replace(/\s+/g, ' ')
    .replace(/^看见了什么[：:]\s*/, '')
}

/** 短名：优先「名」，没有就截正文。淡到后面只靠这一个名字活下来。 */
export function shortName(record, max = 10) {
  const given = String(record['名'] || '').trim()
  if (given) return given.length > max ? given.slice(0, max) + '…' : given
  const text = firstLine(record)
  if (text.length <= max) return text
  return text.slice(0, max).replace(/[，。、；：,.;:！？!?]$/, '') + '…'
}

/** 措辞。淡了先变虚，不从清单里消失。只剩印象只许写名字。 */
export function phraseFor(record) {
  const tier = clarityOf(record['强度'])
  const max = NAME_MAX[tier]
  if (!max) return ''
  if (tier === '清晰' || tier === '清楚') {
    const full = firstLine(record)
    return full.length > max ? full.slice(0, max) + '…' : full
  }
  const name = shortName(record, max)
  return tier === '模糊' ? `${name}（有点模糊）` : `${name}（只剩印象）`
}
