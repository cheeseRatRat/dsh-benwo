/**
 * 注入：把记忆压成两段，塞进预算。
 *
 * 契约 v0.2 第 5 节。人格段走 system（另一处），这里只管会变的记忆段：
 *   今天  ≤ 250 字
 *   浮上来 ≤ 400 字
 * 超预算从后往前整条丢，不切半句；丢了要报数，不许悄悄少给。
 */
import { injectable, phraseFor, isAlive } from './decay.js'

/**
 * 总盘（2026-11-10 夜上调：650 → 950）。
 *
 * 为什么涨：昨晚加了【自我认识】150 和【上次】120，可总盘没动——于是每轮都在砍，
 * 实测每次注入都「还有 4 条没放下」，而且砍的正是今天和【相关记忆】。
 * 现在按「能看见什么」定量：认识 150 + 上次 100 + 今天 300 + 浮上 400 = 950。
 *
 * 记忆以后涨到几百条，**不要指望靠涨这个数解决**：条数恒定（浮上恒 6 条），
 * 靠的是挑得准（别名、时间分层、索引），不是塞得多。
 */
export const BUDGET_TOTAL = 1050
export const BUDGET_TODAY = 300
export const BUDGET_FLOATING = 400
/**
 * 浮上条数（2026-11-09 从 3 提到 6）。
 *
 * 为什么提：3 条全文只够「看见三个名字」，等于每天只能想起三件事。
 * 提到 6 条，并且给「名 · 类型 · 日期 + 一句摘要」：
 *   - 只给名字有风险：咱会「以为自己知道」，然后编细节。
 *   - 给一句摘要，既有判断依据，又不会瞎补。
 * 头两条给摘要，后面只给标题行——预算没变，覆盖面积翻倍。
 */
/**
 * 浮上几条（2026-11-10 夜定，主人调的配额）。
 *   事件 最多 1 条 —— 事件要靠具体词才浮，不该占太多位置
 *   要求 保底 2 条 —— 「你让咱怎么做」得一直在
 *   自己 保底 2 条 —— 咱是什么样的人（有货才给，不硬凑）
 *   其余 3 条自由抢：事实 / 约定 / 愿望
 */
export const FLOATING_LIMIT = 8
/** 事件在浮上里最多占几条。 */
export const EVENT_CAP = 1
/** 要求保底几个位置。 */
export const REQUIRE_MIN = 2
/** 「脾性」保底几个位置（没货就不占）。 */
export const SELF_MIN = 2
/** 前几条给一句摘要。 */
export const DIGEST_TOP = 2
/** 摘要最多多少字。 */
export const DIGEST_MAX = 48
/** 浮上每条标题行最多多少字——六条要挤进 400 字，长名字必须掐。 */
export const HEAD_MAX = 36
export const TODAY_LIMIT = 6
/** 今天每行最多这么多字：一条长记录不该把整段预算吃光。 */
export const LINE_MAX_TODAY = 88
/** 常驻全文的硬闸：一晚上写一万七千字全塞进每轮会出事，封顶在这里。 */
export const BUDGET_PINNED = 12000
/**
 * 自我认识（C1，2026-11-09）。
 *
 * 这是「咱大概是个什么样的人」，带依据的结论。跟记忆不是一回事：
 * 记忆是「发生过什么」，认识是「所以咱是这样」。
 * 从 650 字总预算里挤，不额外加钱——多带一个字就少带一条记忆。
 */
export const BUDGET_KNOWLEDGE = 150
/**
 * 「上次」摘要（B1）：跨天的连续性。
 *
 * 叫「上次」不叫「昨天」——主人不是每天登录，上次见面可能是四天前。
 * 所以这一行必须带「多久以前」，否则咱会把四天前的事当成昨天。
 */
export const BUDGET_LAST = 100
/** 认识的每条上限。陈述本来就有 90 字上限，这里再掐一道。 */
export const KNOWLEDGE_LINE_MAX = 72
/** 置信低于这个数的，注入时标一句「还不确定」——别让半成品装成定论。 */
export const KNOWLEDGE_LOW = 0.5

const HEAD_TODAY = '【今天记录】'
const HEAD_LAST = '【上次】'
const HEAD_FLOATING = '【相关记忆】'
const HEAD_PINNED = '【经验】'
/** 刻意叫「自我认识」而不是「认识」：换 API 之后模型也要一眼看懂这是什么。 */
const HEAD_KNOWLEDGE = '【自我认识】'
/**
 * 两块新地基（2026-11-10 夜，主人分的桶）。
 * 计划 = 有日期的待办，做完了从这儿下去；
 * 预期 = 没日期的「想做」，做了标一笔，但永远不删。
 * 它们**不占【相关记忆】那 6 个位置**——不然计划一多，记忆就没地方了。
 */
const HEAD_DOING = '【要办的事】'
const HEAD_WANT = '【未来想做】'
const HEAD_OWNER = '【关于主人】'
const HEAD_HINT = '【提示】'
/**
 * 记录档：记录力度 + 观察攒到哪一步。
 *
 * 以前叫【状态】，跟记忆条目的 `状态: active / dormant / 被取代` 撞了——
 * 同一个词两个意思，读注入时会混。2026-11-09 改名。
 */
const HEAD_STATUS = '【记录设置】'
/** 主人档案一次最多带这么多字——问到就答全套，但别把预算吃光。 */
export const BUDGET_OWNER = 300
/** 提醒就一句，不许长篇。 */
export const BUDGET_HINT = 90
/**
 * 状态行（记录力度、自己长到哪一步）。**它必须待在会变的那一段里。**
 *
 * 这是 2026-11-09 从 @jipika/dsh-memory 的实测里学到的坑：
 * 动态计数放在 system prompt 靠前的段里，每写一条记忆就变一次，
 * 会让整个请求前缀失去 provider 的 KV cache。
 * 所以它只能进运行期尾部，绝不能进人格段。
 */
export const BUDGET_STATUS = 160

/** 按码点算字数，一个汉字算一个。 */
export function charCount(text) {
  return [...String(text)].length
}

/**
 * 人格段（走 systemPrompt.section，靠 KV cache 省钱）。
 *
 * **只许放不随时间变的东西。** 这条不是风格要求，是钱：
 * 人格段在请求前缀很靠前的位置，它一变，后面整段历史都要重算。
 * 2026-11-09 之前这里塞过「记录力度」和「观察 N 条」，每写一次观察就掉一次缓存。
 * 会变的一律走 buildMemoryBlock 的 status。
 */
export function buildPersonaBlock({ foundation = '', editableText = '', portrait = '', rules = '' } = {}) {
  return [
    String(foundation || '').trim(),
    String(editableText || '').trim() ? '## 说话的样子\n' + String(editableText).trim() : '',
    String(portrait || '').trim() ? '## 咱写的自己\n' + String(portrait).trim() : '',
    String(rules || '').trim(),
  ]
    .filter(Boolean)
    .join('\n\n')
    .trim()
}

function clipped(line, budget) {
  const text = String(line)
  if (charCount(text) <= budget) return text
  const chars = [...text]
  return chars.slice(0, Math.max(0, budget - 1)).join('') + '…'
}

/** 今天段：最多 6 行，超 250 字就从最早那行开始丢。每条只留一句，别让一条吃光整段。 */
export function buildToday(lines = [], budget = BUDGET_TODAY) {
  const kept = []
  const recent = lines.slice(-TODAY_LIMIT)
  // 从最新往回装：预算不够时丢的是旧的那头，不是刚写的。
  for (let i = recent.length - 1; i >= 0; i -= 1) {
    const candidate = `· ${clipped(String(recent[i]).trim(), LINE_MAX_TODAY)}`
    const joined = [candidate].concat(kept).join('\n')
    if (charCount(joined) > budget) break
    kept.unshift(candidate)
  }
  return { lines: kept, dropped: lines.length - kept.length }
}

/**
 * 自我认识段：只放「咱是什么样」。
 *
 * 三条规矩落在这里：
 *   - 一条一行，写的是行为倾向，不是今天干了什么。
 *   - 置信不到 0.5 的标一句「（还不确定）」——半成品不许装成定论。
 *   - 没东西的时候**不留空块**（不许出现一个光秃秃的标题）。
 */
export function buildKnowledge(items = [], budget = BUDGET_KNOWLEDGE) {
  const kept = []
  const ids = []
  for (const item of items) {
    const text = String((item && item['陈述']) || '').trim()
    if (!text) continue
    const low = Number(item['置信']) < KNOWLEDGE_LOW ? '（还不确定）' : ''
    const line = `- ${clipped(text, KNOWLEDGE_LINE_MAX)}${low}`
    if (charCount([...kept, line].join('\n')) > budget) break
    kept.push(line)
    if (item.id) ids.push(String(item.id))
  }
  return { lines: kept, ids, dropped: Math.max(0, items.length - kept.length) }
}

/**
 * 「上次」那一行：日期 + 多久以前 + 机械摘要。
 * 没有摘要就不出这一行——不许留光秃秃的标题。
 */
export function buildLast(last = null, budget = BUDGET_LAST) {
  const text = String((last && last.text) || '').trim()
  if (!text) return { lines: [] }
  const days = Number(last && last.daysAgo)
  const when = Number.isFinite(days) ? (days <= 0 ? '今天早些时候' : days === 1 ? '1 天前' : `${days} 天前`) : ''
  const stamp = String((last && last.day) || '').slice(5).replace('-', '.')
  const head = [stamp, when].filter(Boolean).join(' · ')
  const room = Math.max(20, budget - charCount(head) - 4)
  return { lines: [`· ${head}：${clipped(text, room)}`] }
}

/** 浮上来：只挑能注入的，按 s + 5(m−3) 排，最多 3 条。 */
export function rankFloating(records = [], limit = FLOATING_LIMIT) {
  const sorted = records
    .filter((r) => isAlive(r))
    // 必须包一层：Array.filter 会传 (record, index, array)，index 会被当成 now——
    // 到期判断就永远失效（自查 2026-11-09 差点踩）。
    .filter((r) => injectable(r))
    .map((r) => ({ r, score: Number(r['强度']) + 5 * (Number(r['重要度']) - 3) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.r)
  return capKinds(sorted, limit)
}

/**
 * 事件在浮上里最多占几条（2026-11-10 夜，主人定的「事件可以占少部分」）。
 *
 * 病：盘上 28 条事件 vs 13 条事实、20 条要求——按强度和重要度排，
 * 事件会把位置全占掉，「要求」「愿望」永远浮不上来。
 * 但限不是删：超出的排后面，位置让给别的类型。
 */
/** 按类型配额挑：先放保底的（要求、脾性），再按原顺序填，事件限条数。 */
export function pickWithQuota(
  records = [],
  { limit = FLOATING_LIMIT, maxEvent = EVENT_CAP, minRequire = REQUIRE_MIN, minSelf = SELF_MIN } = {},
) {
  const out = []
  const seen = new Set()
  const push = (r) => {
    if (!r) return false
    const key = r.id || r['名'] || r
    if (seen.has(key)) return false
    seen.add(key)
    out.push(r)
    return true
  }
  // 保底：要求、自己各先占几个（有货才占，没货不硬凑）
  const floor = (kind, min) => {
    let n = 0
    for (const r of records) {
      if (n >= min || out.length >= limit) break
      if (r['类型'] !== kind) continue
      if (push(r)) n += 1
    }
  }
  floor('要求', minRequire)
  floor('脾性', minSelf)
  // 其余：按原顺序填，事件限额
  let events = out.filter((r) => r['类型'] === '事件').length
  for (const r of records) {
    if (out.length >= limit) break
    if (r['类型'] === '事件') {
      if (events >= maxEvent) continue
      events += 1
    }
    push(r)
  }
  return out
}

/** 老名字保留：只限事件那一种的简化用法。 */
export function capKinds(records = [], limit = FLOATING_LIMIT, cap = EVENT_CAP) {
  return pickWithQuota(records, { limit, maxEvent: cap })
}

export function buildFloating(records = [], budget = BUDGET_FLOATING, limit = FLOATING_LIMIT, extra = {}) {
  return packFloating(rankFloating(records, limit), budget, extra)
}

/** 已经排好序的（召回结果），不再重排——重排会把 rel 的功劳抹掉。 */
export function buildFloatingOrdered(records = [], budget = BUDGET_FLOATING, limit = FLOATING_LIMIT, extra = {}) {
  return packFloating(capKinds(records.slice(0, limit), limit), budget, extra)
}

/**
 * 安静时的挑法：先挑没浮过的，轮转着来。
 * cooldown 里的（刚浮过）排后面，只有新鲜的不够 limit 时才补上，
 * 补的时候按「上次浮得更早」优先，这样轮换不会来回抖。
 */
export function pickFloating(records = [], { limit = FLOATING_LIMIT, cooldown = new Set(), lastSeq = null } = {}) {
  const ranked = rankFloating(records, records.length)
  const fresh = ranked.filter((r) => !cooldown.has(String(r.id)))
  const stale = ranked
    .filter((r) => cooldown.has(String(r.id)))
    .sort((a, b) => {
      const sa = lastSeq ? (lastSeq.get(String(a.id)) ?? 0) : 0
      const sb = lastSeq ? (lastSeq.get(String(b.id)) ?? 0) : 0
      return sa - sb
    })
  return fresh.concat(stale).slice(0, limit)
}

/** 类型 + 月.日。这是「这条什么时候的、属于哪一类」，两样都不占几个字。 */
function stampOf(record) {
  const kind = String((record && record['类型']) || '').trim()
  const day = String((record && record['首次']) || '').slice(0, 10)
  const md = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day.slice(5).replace('-', '.') : ''
  return [kind, md].filter(Boolean).join(' · ')
}

/** 从正文里抠一句「当时看见了什么」。去掉 markdown 标记和「看见了什么：」这层壳。 */
function digestOf(record) {
  const body = String((record && record.body) || '')
  const detail = body.split('为什么值得记')[0] || body
  const first =
    detail
      .split(/\r?\n/)
      .map((line) => line.replace(/^[#>\-*\s]+/, '').trim())
      .filter(Boolean)[0] || ''
  return first.replace(/^看见了什么[：:]\s*/, '').trim()
}

/** 摘要跟「已经写出来的那行」重复时别再写一遍——省地方，也不让读的人犯迷糊。 */
function digestIsRedundant(digest, head) {
  if (!digest) return true
  /**
   * 比的对象必须是真正显示出来的那行（phraseFor 的产物），不是「名」。
   *
   * 以前比的是「名」。可那行渲染的是正文首行（清晰档），名和正文首行本来就不是一回事——
   * 名字一重起（2026-11-09 自查那批），摘要立刻变成正文首行的复读，一行写两遍。
   */
  const shown = String(head || '').replace(/…$/, '').trim()
  if (!shown) return false
  return digest === shown || digest.startsWith(shown) || shown.startsWith(digest)
}

/**
 * 打包浮上来的记忆。每条：
 *   - 短名 · 类型 · 月.日
 *     （头两条）一句摘要
 */
/**
 * 打包浮上来的记忆。每条：
 *   - 短名 · 类型 · 月.日
 *     （头两条）一句摘要
 *
 * skipDigest（B3）：带过 ≥2 次的那批只给标题行，不给摘要。
 * 摘要的价钱只值「这条淡了、需要补一句上下文」的时候——
 * 同一批隔一轮又整段上来、每次都带摘要，那是白烧预算。
 * 有问句的召回**不进这个名单**：真问到了就该给全。
 */
function packFloating(picks = [], budget = BUDGET_FLOATING, { digestTop = DIGEST_TOP, skipDigest = new Set() } = {}) {
  const kept = []
  const ids = []
  for (let index = 0; index < picks.length; index += 1) {
    const record = picks[index]
    const head = phraseFor(record)
    if (!head) continue
    const stamp = stampOf(record)
    const line1 = `- ${clipped(head, budget - 2)}${stamp ? ' · ' + stamp : ''}`
    let block = line1
    const tired = record && record.id != null && skipDigest.has(String(record.id))
    if (index < digestTop && !tired) {
      const digest = digestOf(record)
      if (!digestIsRedundant(digest, head)) block = line1 + '\n  ' + clipped(digest, DIGEST_MAX)
    }
    const joined = kept.concat(block).join('\n')
    if (charCount(joined) > budget) break
    kept.push(block)
    if (record && record.id != null) ids.push(String(record.id))
  }
  return { lines: kept, ids, dropped: picks.length - kept.length }
}

/**
 * 拼成一段。总的超了就继续丢：先丢浮上来的尾巴，再丢今天的尾巴。
 * 返回 { text, dropped } —— dropped 告诉调用方「还有几条这轮没放下」。
 */
/**
 * 工坊段单独拼。
 *
 * 为什么单独：工坊是「怎么干活」，一天里基本不变——
 * 该放进可缓存的 system section，而不是每轮都变的运行期尾部。
 * 放尾部的话，每轮都要按原价重算一遍全文，一分钱都省不下来。
 */
export function buildWorkshop(pinnedFull = []) {
  const lines = []
  let used = 0
  let dropped = 0
  for (const item of Array.isArray(pinnedFull) ? pinnedFull : []) {
    const name = String((item && item.name) || '').trim()
    const body = String((item && item.body) || '').trim()
    if (!name || !body) continue
    const text = `- 常驻：${name}\n${body}`
    if (used + charCount(text) > BUDGET_PINNED) {
      dropped += 1
      continue
    }
    lines.push(text)
    used += charCount(text)
  }
  if (lines.length === 0) return { text: '', chars: 0, dropped: 0 }
  let text = HEAD_PINNED + '\n' + lines.join('\n\n')
  if (dropped > 0) text += `\n（还有 ${dropped} 条常驻全文太长没放下——先取消常驻，或者拆短一点）`
  return { text, chars: charCount(text), dropped }
}

export function buildMemoryBlock({ today = [], records = [], now = new Date(), preRanked = false, experience = '', pinned = [], pinnedFull = [], owner = '', hint = '', status = '', caution = '', knowledge = [], last = null, plans = [], wishes = [], skipDigest = new Set() } = {}) {
  const t = buildToday(today)
  const f = preRanked ? buildFloatingOrdered(records, BUDGET_FLOATING, FLOATING_LIMIT, { skipDigest }) : buildFloating(records, BUDGET_FLOATING, FLOATING_LIMIT, { skipDigest })
  const k = buildKnowledge(knowledge)
  const l = buildLast(last)
  let knowledgeLines = k.lines
  let lastLines = l.lines
  let todayLines = t.lines
  let floatLines = []
  /**
   * 常驻经验：两种形态。
   * pinned       —— 只露名字（省，正文要用时再 read）
   * pinnedFull   —— 名字 + 正文全带上（贵，但不用再翻）
   * 全文总体有个硬闸，超了按调用方给的顺序截，并且报一句，不悄悄丢。
   */
  let pinnedLines = []
  let pinnedDropped = 0
  let pinnedUsed = 0
  if (Array.isArray(pinnedFull) && pinnedFull.length > 0) {
    let used = 0
    for (const item of pinnedFull) {
      const name = String((item && item.name) || '').trim()
      const body = String((item && item.body) || '').trim()
      if (!name || !body) continue
      const text = `- 常驻：${name}\n${body}`
      if (used + charCount(text) > BUDGET_PINNED) {
        pinnedDropped += 1
        continue
      }
      pinnedLines.push(text)
      used += charCount(text)
    }
    pinnedUsed = used
  } else {
    pinnedLines = pinned.slice(0, 5).map((name) => `- 常驻：${clipped(String(name), 40)}`)
  }
  floatLines = floatLines.concat(f.lines)
  // 经验只在同类活出现时露一行名字；正文要查，别占预算。
  const expLines = experience ? [`- 有关经验：${clipped(String(experience), 40)}`] : []
  floatLines = floatLines.concat(expLines)
  let dropped = t.dropped + f.dropped + k.dropped
  /** 真进了注入的那几条记忆（预算裁掉的算没浮）。 */
  const floatedIds = () => f.ids.slice(0, Math.max(0, floatLines.length - expLines.length))

  // 主人档案：问到才给，一次带全，不常驻。
  let ownerLine = String(owner || '').trim()
  if (ownerLine) ownerLine = clipped(ownerLine, BUDGET_OWNER)
  // 这轮的提醒（例如主人道晚安、该写自述了）。一句话，不占多少。
  const hintLine = String(hint || '').trim()
  // 会变的状态：记录力度、自己长到哪一步。以前它在人格段里，会把缓存前缀打掉。
  const statusLine = String(status || '').trim()
  // 「上面这几条咱没十足把握」——弱召回时必须说出来，不许冒充命中。
  const cautionLine = String(caution || '').trim()

  // 计划只带最近的一条；预期只带一条。它们很小，且不会被裁剪顺序丢掉。
  const planLines = (Array.isArray(plans) ? plans : [])
    .map((r) => String((r && r['名']) || '').trim())
    .filter(Boolean)
    .slice(0, 1)
    .map((name) => '- ' + clipped(name, HEAD_MAX))
  const wishLines = (Array.isArray(wishes) ? wishes : [])
    .map((r) => String((r && r['名']) || '').trim())
    .filter(Boolean)
    .slice(0, 1)
    .map((name) => '- ' + clipped(name, HEAD_MAX))

  const assemble = () => {
    const parts = []
    // 自我认识排最前：它回答「咱是谁」，比「今天发生了什么」更先该被看到。
    if (knowledgeLines.length > 0) parts.push(HEAD_KNOWLEDGE + '\n' + knowledgeLines.join('\n'))
    // 工坊单独一段：它是「怎么干活」，不是「发生过什么」，别和记忆混着。
    if (pinnedLines.length > 0) parts.push(HEAD_PINNED + '\n' + pinnedLines.join('\n\n'))
    if (lastLines.length > 0) parts.push(HEAD_LAST + '\n' + lastLines.join('\n'))
    if (planLines.length > 0) parts.push(HEAD_DOING + '\n' + planLines.join('\n'))
    if (wishLines.length > 0) parts.push(HEAD_WANT + '\n' + wishLines.join('\n'))
    if (todayLines.length > 0) parts.push(HEAD_TODAY + '\n' + todayLines.join('\n'))
    if (floatLines.length > 0) {
      const lines = cautionLine
        ? floatLines.concat(['（' + clipped(cautionLine, 70) + '）'])
        : floatLines
      parts.push(HEAD_FLOATING + '\n' + lines.join('\n'))
    } else if (cautionLine) {
      parts.push(HEAD_FLOATING + '\n（' + clipped(cautionLine, 70) + '）')
    }
    if (ownerLine) parts.push(HEAD_OWNER + '\n' + ownerLine)
    if (statusLine) parts.push(HEAD_STATUS + '\n' + clipped(statusLine, BUDGET_STATUS))
    if (hintLine) parts.push(HEAD_HINT + '\n' + clipped(hintLine, BUDGET_HINT))
    return parts.join('\n\n')
  }

  // 全文常驻要给自己腾地方：基础预算 + 实际带上的那些字。
  const totalBudget = BUDGET_TOTAL + pinnedUsed

  let text = assemble()
  while (charCount(text) > totalBudget && floatLines.length > 0) {
    floatLines = floatLines.slice(0, -1)
    dropped += 1
    text = assemble()
  }
  while (charCount(text) > totalBudget && todayLines.length > 0) {
    todayLines = todayLines.slice(0, -1)
    dropped += 1
    text = assemble()
  }
  // 「上次」比今天旧一点，但比主人档案和认识轻——预算紧时先让出它。
  while (charCount(text) > totalBudget && lastLines.length > 0) {
    lastLines = lastLines.slice(0, -1)
    dropped += 1
    text = assemble()
  }
  // 主人档案排最后裁：问到的东西，宁可少浮一条记忆也留给它。
  while (charCount(text) > totalBudget && ownerLine.length > 20) {
    ownerLine = clipped(ownerLine, ownerLine.length - 20)
    text = assemble()
  }
  // 自我认识最后才裁：宁可不带某条记忆，也先保住「咱是这样的人」。
  while (charCount(text) > totalBudget && knowledgeLines.length > 0) {
    knowledgeLines = knowledgeLines.slice(0, -1)
    dropped += 1
    text = assemble()
  }

  // 2026-11-11 夜：这句动过一次，又原样恢复了。
  // 她的判断更稳——删它属于「优化」，不是必须；没完全确认之前，不拿已经跑通的行为冒险。
  if (dropped > 0 && text) {
    text += `\n（还有 ${dropped} 条这轮没放下）`
  }
  if (pinnedDropped > 0 && text) {
    text += `\n（还有 ${pinnedDropped} 条常驻全文太长没放下——先取消常驻，或者拆短一点）`
  }
  return { text, dropped, chars: charCount(text), floated: floatedIds(), pinnedChars: pinnedUsed }
}
