/**
 * 召回：无向量也够用。契约 v0.2 第 7 节。
 *
 * 中文按 2-gram 算字面相关（IDF 全库现算）。rel 是门槛，不是唯一标准——
 * 一个字全对得上但强度低的事，排不过一个字半对上但很重要的事。
 */
import { parseTime } from './decay.js'
import { guessArea } from './area.js'
import { isFloatable } from './decay.js'

export const REL_MIN = 0.15
export const DUP_JACCARD = 0.8
export const LINK_BONUS = 0.05
export const LINK_MAX = 2
/** 上一轮刚浮过的，分数打这个折（不是删，是排后面）。 */
export const DEMOTE = 0.7
/** 同领域加的分。给得小：领域是「往哪边偏」，不是「只准看这边」。 */
export const AREA_BOOST = 0.06
/**
 * 时间分层（2026-11-09 夜，主人的想法）。
 *
 * 病：以前检索完全不看时间，`强度` 让十月的旧事永远压十一月的——
 * 问「昨天那个 bug」，会翻出十月的三次小鲸鱼。同一个词，老的总赢。
 *
 * 做法：先搜近 30 天；这层里**找到真命中就停**；没有才扩到 90 天；再没有才搜全部。
 * 问句里明说了时间（「昨天」「上个月」「去年」）就直接从那层起搜，不从 30 天试起。
 * 层里再用 `越近略占优` 微调——不是碾压，是让「最近的」和「最相关的」都照顾到。
 */
export const LAYERS = [
  { days: 30, label: '近 30 天' },
  { days: 90, label: '近 90 天' },
  { days: Infinity, label: '全部' },
]
/** 层内的近期加成。给得小：强度已经算过一次时间，这里只是补一刀。 */
export const RECENCY_WEIGHT = 0.08

const HINT_RULES = [
  { re: /今天|刚刚|刚才|这一会儿/, days: 1 },
  { re: /昨天|昨晚/, days: 2 },
  { re: /前天/, days: 3 },
  { re: /前几天|这两天|这几天|上周|周末/, days: 10 },
  { re: /上个月|上月/, days: 60 },
  { re: /前两个月|上上个月/, days: 120 },
  { re: /去年/, days: 400 },
]

/** 中文/阿拉伯数字的月份。 */
const MONTH_NUM = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 }

/**
 * 问句里点名了月份（「八月」「8 月」）→ 从那个月一号算到今天多少天。
 * 这个比「上个月」更准：说八月，就该把八月那整层放进来。
 */
export function monthHintDays(query, now = new Date()) {
  const m = /(十二|十一|\d{1,2}|一|二|三|四|五|六|七|八|九|十)月/.exec(String(query || ''))
  if (!m) return 0
  const raw = m[1]
  const month = MONTH_NUM[raw] !== undefined ? MONTH_NUM[raw] : Number(raw)
  if (!Number.isFinite(month) || month < 1 || month > 12) return 0
  const cur = new Date(now)
  let year = cur.getFullYear()
  // 说「八月」而现在十一月 → 指的是今年八月；说「十二月」而现在一月 → 指去年十二月
  if (month > cur.getMonth() + 1) year -= 1
  const target = new Date(year, month - 1, 1)
  const days = (cur.getTime() - target.getTime()) / 86400000
  return Math.max(1, Math.ceil(days))
}

/** 问句里明说的时间跨度（天）。0 = 没说，按默认分层从最近开始。 */
export function hintDays(query, now = new Date()) {
  const text = String(query || '')
  const byMonth = monthHintDays(text, now)
  if (byMonth > 0) return byMonth
  for (const rule of HINT_RULES) if (rule.re.test(text)) return rule.days
  return 0
}

function ageDaysOf(record, now) {
  const t = parseTime(record && record['首次'])
  if (!Number.isFinite(t)) return 0
  return Math.max(0, (new Date(now).getTime() - t) / 86400000)
}
/** 字面全对不上时，最多给这么几条「弱候选」，并且要标明不确定。 */
export const FALLBACK_LIMIT = 2

const CJK = /[\u4e00-\u9fff]/

/** 中文切 2-gram，英文数字按词。标点全丢。 */
/**
 * 虚词碎片（2026-11-11）。
 *
 * 病：问「QQ 插件什么时候做」，检索把「什么时候」切成「什么」「么时」「时候」，
 * 结果每条正文里有「时候」的记录都算命中，把真答案压到第三。
 * 问「钱的事怎么办」也一样——「怎么办」抢走了分。
 *
 * 这些碎片不携带信息，扣掉它。**只扣疑问/虚词**，不扣实词：
 * 「我们 / 你们」这种是内容（有记忆挂这个别名），一个都不许进这张表。
 */
const STOP_FRAGMENTS = new Set([
  '什么', '怎么', '时候', '为什', '么办', '怎样', '如何', '是不', '不是',
  '这个', '那个', '一下', '就是', '可以', '要不', '有没', '没有', '还是',
  '出来', '起来', '一件', '一次', '的事', '的事',
])

export function tokenize(text) {
  const s = String(text || '').toLowerCase()
  const tokens = []
  for (const word of s.match(/[a-z0-9]+/g) || []) tokens.push(word)
  for (const run of (s.match(/[\u4e00-\u9fff]+/g) || [])) {
    if (run.length === 1) tokens.push(run)
    for (let i = 0; i + 2 <= run.length; i += 1) {
      const gram = run.slice(i, i + 2)
      if (STOP_FRAGMENTS.has(gram)) continue
      tokens.push(gram)
    }
  }
  return tokens
}

export function tokenSet(text) {
  return new Set(tokenize(text))
}

export function jaccard(a, b) {
  const A = a instanceof Set ? a : new Set(a)
  const B = b instanceof Set ? b : new Set(b)
  if (A.size === 0 && B.size === 0) return 1
  let inter = 0
  for (const x of A) if (B.has(x)) inter += 1
  return inter / (A.size + B.size - inter)
}

/**
 * 一条记忆能被检索到的文本：名 + 别名 + 正文。
 *
 * 别名（2026-11-09 夜）是「同一个意思的别的说法」——只在这层起作用，
 * 不进注入、不占预算。没有别名就是空串，老记录行为完全不变。
 */
function docText(record) {
  const aliases = Array.isArray(record['别名']) ? record['别名'].join(' ') : String(record['别名'] || '')
  return `${record['名'] || ''} ${aliases} ${record.body || ''}`
}

/** 建一次索引：文档词频 + 全库 df。 */
export function buildIndex(records = []) {
  const docs = records.map((record) => {
    const tokens = tokenize(docText(record))
    const aliasTokens = tokenize(Array.isArray(record['别名']) ? record['别名'].join(' ') : String(record['别名'] || ''))
    const tf = new Map()
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1)
    return { record, tokens, tf, set: new Set(tokens), aliasSet: new Set(aliasTokens) }
  })
  const df = new Map()
  for (const doc of docs) {
    for (const t of doc.set) df.set(t, (df.get(t) || 0) + 1)
  }
  const N = docs.length || 1
  const idf = new Map()
  for (const [t, d] of df) idf.set(t, Math.log((N + 1) / (d + 1)) + 1)
  return { docs, idf, N }
}

/**
 * 查询和一条记忆的相关度：**查询被覆盖了多少**，不是余弦。
 *
 * 一开始用的是 tf-idf 余弦，测出来短句子根本过不了门槛——一句六七个 2-gram
 * 的提问、文档几十个 2-gram，只命中一个词时余弦只有 0.04，看着像"完全无关"，
 * 其实"修根"这两个字明明对上了。改成按 idf 加权的覆盖率：命中几个字算几个字。
 */
/**
 * 排序权重（2026-11-09 夜调整，主人点头的 A 案）。
 *
 * 原来 `0.5 rel + 0.3 强度 + 0.2 重要度`——问题：**高强度老事件光靠强就赢**。
 * 实测「搬家的规矩」：一条 rel=0.337 的准记忆，被两条 rel=0.637 但强度 89 的老事件压到第 7。
 * 收窄成 `0.65 + 0.2 + 0.15`：问什么，就该先看什么。
 */
export const W_REL = 0.65
export const W_STRENGTH = 0.2
export const W_IMPORTANCE = 0.15

/**
 * 词面覆盖率要打的折扣（2026-11-09 夜）。
 *
 * 病：只对上 **1 个**「全库有人写过的词」时，rel 算出来是 1.000——
 * 实测「备份那块怎么弄」有 19 条并列 1.000，检索退化成「谁最强谁上」，跟问句无关了。
 * 治：已知词少于 2 个时按比例减信。**不是把陌生词拿来稀释**（那是老问题），是「只对一个词，别那么自信」。
 */
export const KNOWN_FULL_CREDIT = 2

/**
 * 别名命中的加权（2026-11-09 夜）。
 *
 * 实测「搬家的规矩」：一条 rel=0.337 的准记忆（只有别名对上「搬家」），
 * 被两条 rel=0.637 的老事件（正文里真有「搬家」和「规矩」）压到第 7。
 * 光调权重救不了——差距在 rel 本身。
 *
 * 道理：**别名命中是「换个说法问」，正文命中可能只是「碰巧同一个词」。**
 * 所以别名上命中的词，一票顶一点五票。只在分子上加，不超过 1。
 */
export const ALIAS_BOOST = 1.5

export function relevance(queryTokens, doc, idf) {
  if (!doc || !doc.set || doc.set.size === 0) return 0
  const grams = new Set(queryTokens)
  if (grams.size === 0) return 0
  let total = 0
  let hit = 0
  let known = 0
  for (const t of grams) {
    // 全库没人写过的词不可能对上，也不该拿来稀释分数——
    // 不然「上次说的修根是啥来着」里八个陌生 2-gram 会把「修根」这一击冲没。
    if (!idf.has(t)) continue
    known += 1
    const w = idf.get(t)
    total += w
    if (doc.set.has(t)) {
      const boost = doc.aliasSet && doc.aliasSet.has(t) ? ALIAS_BOOST : 1
      hit += w * boost
    }
  }
  if (known === 0 || total === 0) return 0
  const confidence = Math.min(1, known / KNOWN_FULL_CREDIT)
  return Math.min(1, (hit / total) * confidence)
}

/** 从正文里认出 [[名字]] 指向谁。 */
export function linksOf(record, byName) {
  const out = []
  const text = String(record.body || '')
  for (const match of text.matchAll(/\[\[([^\]]{1,40})\]\]/g)) {
    const target = byName.get(match[1].trim())
    if (target && target.id !== record.id) out.push(target)
  }
  return out
}

/** 按问句里的时间提示排出要搜的层。没说时间就从「近 30 天」开始。 */
function buildLayers(start = 0) {
  const base = start > 0 ? [{ days: start, label: `近 ${start} 天` }] : []
  return base.concat(LAYERS.filter((layer) => layer.days > start))
}

/**
 * 召回。返回 [{ record, rel, score, weak, layer }]。
 * query 为空就当没有线索：只有强度撑得住的老面孔才上来，不硬凑。
 *
 * 有问句时按时间分层：近 30 天 → 近 90 天 → 全部，**哪层先找到真命中就在哪层答**。
 * `layer` 告诉调用方是哪一层找到的。
 */
export function recall({ records = [], query = '', now = new Date(), limit = 3, cooldown = null, windows = null } = {}) {
  const active = records.filter((r) => isFloatable(r))
  const index = buildIndex(active)
  const byName = new Map(active.filter((r) => r['名']).map((r) => [r['名'], r]))
  const queryTokens = tokenize(query)
  const hasQuery = queryTokens.length > 0

  // 问句落在哪个领域，那个领域的记录抬一点（2026-11-10 夜，C）
  const queryArea = hasQuery ? guessArea(query) : ''
  const scored = index.docs.map((doc) => {
    const rel = hasQuery ? relevance(queryTokens, doc, index.idf) : 0
    const record = doc.record
    const s = Number(record['强度']) || 0
    const m = Number(record['重要度']) || 3
    // 层内近期加成：越近略占优。给得小——强度已经算过一次时间了。
    const recency = RECENCY_WEIGHT * Math.max(0, 1 - ageDaysOf(record, now) / 30)
    const areaHit = queryArea && record['领域'] === queryArea ? AREA_BOOST : 0
    const score0 = hasQuery
      ? W_REL * rel + W_STRENGTH * (s / 100) + W_IMPORTANCE * (m / 5) + recency + areaHit
      : 0.6 * (s / 100) + 0.4 * (m / 5)
    // 上一轮刚浮过的打个折：真相关的不受影响，勉强够线的让位给新面孔。
    const quieted = cooldown && cooldown.has(String(record.id))
    return { record, rel, score: quieted ? score0 * DEMOTE : score0, set: doc.set }
  })
  scored.sort((a, b) => b.score - a.score)

  /** 在一层里挑：rel 过线、去重、限量。 */
  const pickIn = (rows) => {
    const out = []
    for (const hit of rows) {
      if (out.length >= limit) break
      if (hasQuery && hit.rel < REL_MIN) continue
      if (out.some((p) => jaccard(p.set, hit.set) > DUP_JACCARD)) continue
      out.push(hit)
    }
    return out
  }

  let picked = []
  let layerLabel = '全部'
  let weak = false

  if (hasQuery) {
    const layers = windows || buildLayers(hintDays(query))
    for (const layer of layers) {
      const rows = scored.filter((hit) => ageDaysOf(hit.record, now) <= layer.days)
      const got = pickIn(rows)
      layerLabel = layer.label
      if (got.length > 0) {
        picked = got
        break
      }
    }

    /**
     * 兜底（A5，2026-11-09）。
     *
     * 以前字面全对不上时，这里返回空，注入里一声不响——用起来的感受就是
     * 「明明说过、你像根本不知道有这回事」。那不诚实：咱是找不回来，不是没有。
     * 现在给最像的两条，但**明确标 weak**：调用方要把「不一定对得上」说出来。
     */
    if (picked.length === 0 && scored.length > 0) {
      weak = true
      for (const hit of scored) {
        if (picked.length >= FALLBACK_LIMIT) break
        if (picked.some((p) => jaccard(p.set, hit.set) > DUP_JACCARD)) continue
        picked.push(hit)
      }
    }
  } else {
    picked = pickIn(scored)
  }

  // 一跳链接：只在还有位置、且关系够近时带一条。
  if (hasQuery && picked.length < limit) {
    const seen = new Set(picked.map((p) => p.record.id))
    for (const hit of picked.slice()) {
      for (const target of linksOf(hit.record, byName).slice(0, LINK_MAX)) {
        if (picked.length >= limit) break
        if (seen.has(target.id)) continue
        seen.add(target.id)
        const s = Number(target['强度']) || 0
        picked.push({
          record: target,
          rel: hit.rel,
          score: hit.score + LINK_BONUS,
          set: tokenSet(docText(target)),
        })
      }
    }
  }

  return picked.map(({ record, rel, score }) => ({ record, rel, score, weak, layer: layerLabel }))
}

export { CJK }
