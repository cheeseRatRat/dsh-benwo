/**
 * 写入前的硬闸。契约 v0.2 第 4 节。
 *
 * 「该不该记」归模型判断；「能不能写进去」归这里。模型热情起来一天写三十条，
 * 淡的机制追都追不上——所以闸必须长在代码里，不长在提示词里。
 */
import { KINDS, looksSecret } from './store.js'
import { clampImportance, NEW_IMPORTANCE, parseTime, isAlive } from './decay.js'
import { tokenSet } from './recall.js'

export const WHY_MARKER = '为什么值得记：'
export const NAME_MAX = 20
export const DAILY_WRITE_LIMIT = 12
/**
 * 删掉「记录力度」之后固定的今日上限（2026-11-10 夜）。
 * 取原来「大」档的 24——主人一直用大，别悄悄砍半。
 * 基础常量 DAILY_WRITE_LIMIT（12）留着：它是「中」档，测试也认它。
 */
export const TODAY_LIMIT = 24
export const LONG_PER_TURN = 1
export const EVIDENCE_MIN = 2
export const EVIDENCE_SPAN_DAYS = 2

/**
 * 记录力度：只影响「一天记多少、催不催自述」，不动证据门槛。
 * 证据门槛是防滥长的，放宽力度不等于放宽质量。
 */
/** 这个力度下今天最多写几条。 */
/** 这个力度下，自述隔多少天该提一句（0 = 不催）。 */
/** 正文里必须有「为什么值得记：」。没有这一行的条目是残条。 */
export function splitWhy(body) {
  const text = String(body || '')
  const at = text.indexOf(WHY_MARKER)
  if (at < 0) return { detail: text.trim(), why: '' }
  return {
    detail: text.slice(0, at).trim(),
    why: text.slice(at + WHY_MARKER.length).trim(),
  }
}

export function composeBody(detail, why) {
  return `${String(detail || '').trim()}\n\n${WHY_MARKER}${String(why || '').trim()}`
}

/** 重要度在写入时定一次。借 Smallville：写入时打分，不在召回时现算。 */
export function importanceFor({ text = '', kind = '事件', corrected = false } = {}) {
  let m = NEW_IMPORTANCE
  if (/记住|永远|以后都|一直|别再/.test(text)) m += 1
  if (kind === '约定' || /底线|称呼|答应过/.test(text)) m += 1
  if (corrected) m += 1
  if (kind === '事件' && !corrected) m -= 1
  return clampImportance(m)
}

/**
 * 草稿 → 记录。过了才算能写，不过就把原因全列出来。
 * draft: { id?, 名, 类型, 重要度?, 来源[], body(含 why), 首次?, corrected? }
 */
export function validateDraft(draft, now = new Date()) {
  const errors = []
  const body = String(draft.body || '').trim()
  const name = String(draft['名'] || '').trim()
  const kind = String(draft['类型'] || '').trim()
  const sources = Array.isArray(draft['来源']) ? draft['来源'].filter(Boolean) : []

  if (!name) errors.push('缺「名」——淡到底时只剩它活着')
  if (name.length > NAME_MAX) errors.push(`「名」超过 ${NAME_MAX} 字`)
  if (!KINDS.includes(kind)) errors.push(`「类型」只能是 ${KINDS.join(' / ')}`)
  if (sources.length === 0) errors.push('没有来源的条目一律拒')
  if (looksSecret(body)) errors.push('正文里有密钥，拒绝落盘')

  const { detail, why } = splitWhy(body)
  if (detail.length < 4) errors.push('正文太短，说清看见了什么')
  if (!why) errors.push(`缺「${WHY_MARKER}」——以后的咱凭什么用它`)

  if (errors.length > 0) return { ok: false, errors }

  const iso = new Date(now).toISOString()
  return {
    ok: true,
    errors: [],
    record: {
      id: String(draft.id || ''),
      '名': name,
      /** 别名：只参与检索、不进注入。写「同一个意思的说法」，不是「相关的词」。 */
      '别名': Array.isArray(draft['别名'])
        ? draft['别名'].map((x) => String(x).trim()).filter(Boolean)
        : draft['别名']
          ? [String(draft['别名']).trim()]
          : [],
      '类型': kind,
      '强度': Number.isFinite(Number(draft['强度'])) ? Number(draft['强度']) : 40,
      '重要度': clampImportance(draft['重要度'] ?? importanceFor({ text: detail + why, kind, corrected: draft.corrected })),
      '首次': iso,
      '上次': iso,
      '提起': 0,
      '证据': 0,
      '来源': sources,
      '状态': 'active',
      '被取代': '',
      /** 有效到（B2）：到期就不主动晃，但不删、能被召回。空 = 长期有效。 */
      '有效到': String(draft['有效到'] || ''),
      body: composeBody(detail, why),
      detail,
      why,
    },
  }
}

/**
 * 明说或确实发生的：一次就够，看分量。
 * 事件做完了就做完了，等「第二次提起」等于永远等不到——这是设计漏洞，2026-11-08 改。
 */
export const DIRECT_KINDS = ['事实', '约定', '愿望', '要求', '事件', '计划', '预期']
/**
 * 从表现里读出来的：一次可能是心情，要独立复现。
 * 2026-11-10：原来的「偏好」「感受」合并成「脾性」——两个桶都装「咱的倾向」，分开没意义。
 * 2026-11-10 再改：叫「自己」跟「自己长」那套机制撞名，改叫「脾性」。
 */
export const INFERRED_KINDS = ['脾性']
/** 明说类要直接进长期，重要度得到这儿。 */
/**
 * 脾性 → 认识 的晋升门（2026-11-10 夜，主人定的「常驻七天」）。
 *
 * 一条脾性要满足两条才算长住：
 *   ① 首次距今 ≥ 7 天（活过一个星期，不是今天突然想到的）
 *   ② 期间被浮上来过 ≥ 2 次（真的反复露头，不是写完就忘）
 *
 * 为什么要这道门：脾性是咱自己判断的性格碎片，最容易自我美化。
 * 让它先活够、再被反复撞见，才有资格变成「认识」。
 */
export const TRAIT_MIN_DAYS = 7
export const TRAIT_MIN_MENTIONS = 2

export function promotableTraits(records = [], now = new Date()) {
  return (records || []).filter((r) => {
    if (!r || r['类型'] !== '脾性') return false
    if (String(r['状态'] || '') !== 'active') return false
    const first = parseTime(r['首次'])
    if (!Number.isFinite(first)) return false
    const days = (new Date(now).getTime() - first) / 86400000
    if (days < TRAIT_MIN_DAYS) return false
    return Number(r['提起'] || 0) >= TRAIT_MIN_MENTIONS
  })
}

export const DIRECT_IMPORTANCE_MIN = 3

/**
 * 写前复查（A3，2026-11-09）。
 *
 * 设计是被实测逼出来的，不是想出来的：
 *   真重复的那一对（ae56 / c9ef）Jaccard 只有 0.196、IDF 覆盖率 0.244；
 *   而不相干的两条（都含「主人」）Jaccard 能到 0.659、覆盖率 0.584。
 *
 * 结论：**字面相似度在这个语料上判不了重。** 不相干的比真重复还像，
 * 因为高频词（名字、称呼）主导了分数。
 *
 * 所以这里不设「自动判重阈值」，只做两件事：
 *   1. 排出一份「最像的几条」交给调用方——让咱自己看一眼决定（判断权在咱）。
 *   2. 只对**几乎逐字相同**（Jaccard ≥ 0.9）硬拦一次，那种确实是手滑。
 *
 * 真正解决重复靠的是：写的时候显式 `取代:`，以及整理时人工审候选对。
 */
export const DUP_BLOCK = 0.9
export const DUP_HINT_TOP = 3
export const DUP_HINT_MIN = 0.2

export function findSimilar(records = [], text = '', { limit = DUP_HINT_TOP } = {}) {
  const active = records.filter((r) => isAlive(r))
  if (active.length === 0) return []
  const set = tokenSet(text)
  if (set.size === 0) return []

  const hits = []
  for (const record of active) {
    const other = tokenSet(`${record['名'] || ''} ${record.body || ''}`)
    // 两个信号取最大：短句靠 Jaccard，长正文靠「小的那边被覆盖多少」。
    let inter = 0
    for (const t of set) if (other.has(t)) inter += 1
    const union = set.size + other.size - inter
    const jac = union === 0 ? 0 : inter / union
    const contained = inter / Math.max(1, Math.min(set.size, other.size))
    const score = Math.max(jac, contained * 0.9)
    if (score < DUP_HINT_MIN) continue
    hits.push({ record, score, same: jac >= DUP_BLOCK })
  }
  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, limit)
}

/**
 * 能不能升长期。分两路：
 *
 * - 事实 / 约定 / 事件：她亲口说的、或确实发生过的，**一次就能立**，门槛落在重要度上。
 * - 偏好 / 感受：从表现里读出来的，要独立提到 ≥2 次、且跨 ≥2 天。
 *   同一天提五次不叫证据，叫磨人。
 *
 * 不传 kind 时按老规矩走（当作推出来的那一类），保持向后兼容。
 */
export function canPromote({ evidence, firstDay, today, kind = '', importance = 0 }) {
  const e = Number(evidence) || 0
  const imp = Number(importance) || 0
  const k = String(kind || '')
  const direct = DIRECT_KINDS.includes(k)

  // 明说类：分量够，当场立。
  if (direct && imp >= DIRECT_IMPORTANCE_MIN) {
    return { ok: true, reason: '', direct: true }
  }
  // 推出来的那一类：一次不算数，先拦。
  if (!direct && e < EVIDENCE_MIN) {
    return {
      ok: false,
      reason: `证据只有 ${e} 条，还不够 ${EVIDENCE_MIN}——「${k || '这一类'}」是从表现里读出来的，一次不算数`,
    }
  }

  const a = new Date(`${firstDay}T00:00:00`).getTime()
  const b = new Date(`${today}T00:00:00`).getTime()
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { ok: false, reason: '日期读不出来' }
  const span = (b - a) / 86400000

  if (e < EVIDENCE_MIN) {
    return {
      ok: false,
      reason: `「${k}」这次分量不够（重要度 ${imp || '未评'}，要 ≥${DIRECT_IMPORTANCE_MIN}）；想靠复现也行，但要独立提过 ≥${EVIDENCE_MIN} 次`,
    }
  }
  if (span < EVIDENCE_SPAN_DAYS) return { ok: false, reason: `只隔了 ${span} 天，要跨 ${EVIDENCE_SPAN_DAYS} 天` }
  return { ok: true, reason: '', direct }
}
