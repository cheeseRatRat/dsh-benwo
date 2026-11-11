/**
 * 人格三段。契约 v0.2 第 9 节。
 *
 * 底子只读；可改层只有四段；改一次要攒够独立证据、走 Beta 后验、幅度受限、留痕可回滚。
 *
 * 三条硬规矩：
 *   1. 同一轮里的冲击不算证据（一句「你确定吗」能让模型平均 46% 翻答案）
 *   2. 同一天、同一场景只算一条；跨 ≥3 天、≥3 个场景才算独立
 *   3. 只在会话边界结算，代码里没有任何地方会自己调 applyEdit
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { withLock, looksSecret } from './store.js'
import { isAlive } from './decay.js'

export const EDITABLE_SECTIONS = ['语气', '称呼习惯', '偏好表达', '自述风格']
export const LEDGER_FILE = 'ledger.jsonl'
export const PRIOR = { alpha: 1, beta: 1 }
// 2026-11-08 放宽（主人说「时间不长，转瞬即逝」）：
// 跨 3 天 → 2 天；场景 3 → 2；幅度 15% → 20%；先验 Beta(2,2) → Beta(1,1)。
// 实测（.tmp/check-beta.mjs）：Beta(1,1) 下 2 条下界 0.368 / 3 条 0.473 / 4 条 0.549，
// 所以下界门槛从 0.5 放到 0.45 —— 「三条」才真的过得去，两条还是过不去。
// 主人当场明说的那条按两条算（weight=2），两天两景 + 一条明说就能到 3。
// 底子、反向证据停手、.bak、留痕、一次一句——这些一条没动。
export const MIN_DAYS = 2
export const MIN_SCENES = 2
export const MEAN_MIN = 0.7
export const LOWER_MIN = 0.45
export const AMPLITUDE_MAX = 0.2
export const MAX_SENTENCES = 1
/**
 * 统计窗口（2026-11-09 改）。
 *
 * 以前 Beta 后验吃「全部历史」：两个月前的一次失手会永久压着，攒多少正面都翻不了身。
 * 现在只算最近 90 天的观察——账本不删，旧的不再进统计。
 * 跟「咱记不住很久以前的一顿饭」同一个道理。
 */
export const STATS_WINDOW_DAYS = 90
/** 反向否决只看最近这么多条观察（按次数，不按日历）。 */
export const RECENT_WINDOW = 10
/**
 * 咱的「一天」从凌晨 4 点算起。
 *
 * 主人是夜猫子，常在深夜/凌晨连轴聊。跨午夜的一次见面如果按 00:00 切，
 * 会被算成「两天」——`MIN_DAYS ≥ 2` 就白送了，门会假过。
 * 所以观察账本的 day 用这个函数，不用日历日。
 */
export const DAY_CUTOFF_HOUR = 4

export function ledgerDayOf(now = new Date()) {
  const d = new Date(now)
  if (d.getHours() < DAY_CUTOFF_HOUR) d.setDate(d.getDate() - 1)
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 画像的门（跟可改层分开了，2026-11-09）。 */
export const PORTRAIT_MIN_KNOWLEDGE = 4
export const PORTRAIT_MIN_DAYS = 42

// ---------------------------------------------------------------- 文本

export function parseSections(text) {
  const lines = String(text || '').split(/\r?\n/)
  const head = []
  const sections = []
  let current = null
  for (const line of lines) {
    const match = /^##\s+(.+?)\s*$/.exec(line)
    if (match) {
      current = { title: match[1], body: [] }
      sections.push(current)
    } else if (current) {
      current.body.push(line)
    } else {
      head.push(line)
    }
  }
  return {
    head: head.join('\n'),
    sections: sections.map((s) => ({ title: s.title, body: s.body.join('\n').trim() })),
  }
}

export function renderSections(parsed) {
  const out = [parsed.head.trimEnd()]
  for (const section of parsed.sections) {
    out.push('', `## ${section.title}`, '', section.body.trim())
  }
  out.push('')
  return out.join('\n')
}

export function editableValues(parsed) {
  const values = {}
  for (const section of parsed.sections) {
    if (EDITABLE_SECTIONS.includes(section.title)) values[section.title] = section.body
  }
  return values
}

export async function readEditableText(L) {
  return fs.readFile(L.editable, 'utf8').catch(() => '')
}

export async function readEditable(L) {
  return editableValues(parseSections(await readEditableText(L)))
}

// ---------------------------------------------------------------- Beta 后验

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
]

export function logGamma(z) {
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z)
  const x = z - 1
  let a = LANCZOS[0]
  const t = x + 7.5
  for (let i = 1; i < 9; i += 1) a += LANCZOS[i] / (x + i)
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
}

function betacf(x, a, b) {
  const TINY = 1e-30
  const MAX = 200
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < TINY) d = TINY
  d = 1 / d
  let h = d
  for (let m = 1; m <= MAX; m += 1) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < TINY) d = TINY
    c = 1 + aa / c
    if (Math.abs(c) < TINY) c = TINY
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < TINY) d = TINY
    c = 1 + aa / c
    if (Math.abs(c) < TINY) c = TINY
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-12) break
  }
  return h
}

/** 正则化不完全 beta：Beta(a,b) 的 CDF。 */
export function betaCdf(x, a, b) {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  )
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(x, a, b)) / a
  return 1 - (bt * betacf(1 - x, b, a)) / b
}

/** 分位数：二分反解 CDF。够用，不追求解析。 */
export function betaQuantile(p, a, b) {
  const target = Math.min(0.999999, Math.max(0.000001, p))
  let lo = 0
  let hi = 1
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2
    if (betaCdf(mid, a, b) < target) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export function betaStats(alpha, beta) {
  const a = Math.max(0.001, alpha)
  const b = Math.max(0.001, beta)
  return {
    alpha: a,
    beta: b,
    mean: a / (a + b),
    lower95: betaQuantile(0.05, a, b),
    upper95: betaQuantile(0.95, a, b),
  }
}

// ---------------------------------------------------------------- 账本

export function ledgerPath(L) {
  return path.join(L.status, LEDGER_FILE)
}

export async function readLedger(L) {
  let raw = ''
  try {
    raw = await fs.readFile(ledgerPath(L), 'utf8')
  } catch {
    return []
  }
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

function turnOf(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * 每轮只追加一行，O(1)，不算。
 *
 * ⚠️ 自查 2026-11-09：以前这里**没接 weight**，于是调用方传进来的
 * `weight: mine ? 2 : 1`（主人当场明说按两条算）全被丢掉，
 * summarize 里 `weightOf` 永远拿到 undefined → 一律按 1 条算。
 * 也就是说「她的话比咱的观察硬」这条规则从来没生效过。
 */
export async function appendObservation(L, { day, scene, hash, direction, note, turn, weight }, now = new Date()) {
  if (!['up', 'down'].includes(direction)) throw new Error('direction 只能是 up / down')
  return withLock('ledger', async () => {
    await fs.mkdir(L.status, { recursive: true })
    const entry = {
      at: new Date(now).toISOString(),
      day: String(day || ledgerDayOf(now)),
      scene: String(scene || '默认'),
      hash: String(hash || ''),
      direction,
      note: String(note || ''),
      weight: Number(weight) === 2 ? 2 : 1,
      turn: turnOf(turn),
    }
    await fs.appendFile(ledgerPath(L), JSON.stringify(entry) + '\n', 'utf8')
    return entry
  })
}

/**
 * 独立性：同一轮只算一条，同一天同一场景同一句话也只算一条。
 *
 * 「同一轮」这条最要紧：被一句「你确定吗」挑战时，模型平均 46% 直接翻答案。
 * 一轮里的冲击是噪声，不是成长。所以当前这一轮的观察一律先不算。
 */
export function summarize(entries = [], now = new Date(), options = {}) {
  const currentTurn = turnOf(options.currentTurn)
  const byKey = new Map()
  for (const entry of entries) {
    if (!entry || !entry.direction) continue
    const turn = turnOf(entry.turn)
    if (currentTurn !== null && turn === currentTurn) continue
    const key = turn !== null ? `t:${turn}` : `${entry.day}|${entry.scene}|${entry.hash}`
    byKey.set(key, entry)
  }
  const unique = [...byKey.values()]
  // 统计窗口：只算最近 STATS_WINDOW_DAYS 天的观察。账本不删，旧的不再进统计。
  const cutAt = new Date(now).getTime() - STATS_WINDOW_DAYS * 86400000
  const inWindow = unique.filter((e) => {
    const t = new Date(e.at).getTime()
    return Number.isFinite(t) ? t >= cutAt : true
  })
  const up = inWindow.filter((e) => e.direction === 'up')
  const down = inWindow.filter((e) => e.direction === 'down')
  // 主人当场明说的那条，按两条算（weight=2）：她的话本来就比咱的观察硬。
  const weightOf = (entry) => (Number(entry && entry.weight) === 2 ? 2 : 1)
  const upWeight = up.reduce((sum, entry) => sum + weightOf(entry), 0)
  const downWeight = down.reduce((sum, entry) => sum + weightOf(entry), 0)
  const stats = betaStats(PRIOR.alpha + upWeight, PRIOR.beta + downWeight)

  /**
   * 反向否决：按**次数**，不按日历（2026-11-09 改）。
   *
   * 以前是「近 14 天有 1 条反向 → 一票否决」。问题是主人不是每天登录，
   * 她 11.9 随口一句不满意，11.13 回来还压着；越少来，这条越像冤案。
   * 现在看最近 RECENT_WINDOW 条观察：反向真的压过正面才关门——
   * 那才是方向反了，而不只是有个瑕疵。
   */
  const recent = inWindow
    .slice()
    .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    .slice(-RECENT_WINDOW)
  const recentUpWeight = recent.filter((e) => e.direction === 'up').reduce((s, e) => s + weightOf(e), 0)
  const recentDownWeight = recent.filter((e) => e.direction === 'down').reduce((s, e) => s + weightOf(e), 0)

  return {
    up,
    down,
    upWeight,
    downWeight,
    upDays: new Set(up.map((e) => e.day)),
    upScenes: new Set(up.map((e) => e.scene)),
    /** @deprecated 用 recentDownWeight / recentUpWeight 判断；这个字段只是留个原始列表方便展示。 */
    recentDown: down,
    recent,
    recentUpWeight,
    recentDownWeight,
    windowDays: STATS_WINDOW_DAYS,
    ...stats,
  }
}

/** 现在能不能改。返回 { ok, reasons[], recommend }。 */
export function evaluate(entries = [], now = new Date(), options = {}) {
  const s = summarize(entries, now, { currentTurn: options.currentTurn })
  const reasons = []
  if (s.upDays.size < MIN_DAYS) reasons.push(`只跨了 ${s.upDays.size} 天，要 ≥${MIN_DAYS} 天`)
  if (s.upScenes.size < MIN_SCENES) reasons.push(`只出现在 ${s.upScenes.size} 个场景，要 ≥${MIN_SCENES} 个`)
  if (s.mean < MEAN_MIN) reasons.push(`后验均值 ${s.mean.toFixed(2)}，要到 ${MEAN_MIN}`)
  if (s.lower95 <= LOWER_MIN) reasons.push(`95% 下界 ${s.lower95.toFixed(2)}，要过 ${LOWER_MIN}`)
  // 反向否决按次数（最近 RECENT_WINDOW 条观察），不按日历。
  if (s.recentDownWeight > 0 && s.recentDownWeight >= s.recentUpWeight) {
    reasons.push(`最近 ${s.recent.length} 条观察里，反向 ${s.recentDownWeight} 条 ≥ 正面 ${s.recentUpWeight} 条`)
  }
  return {
    ok: reasons.length === 0,
    reasons,
    recommend: s.mean >= MEAN_MIN ? 'up' : 'down',
    stats: s,
  }
}

// ---------------------------------------------------------------- 幅度

export function levenshtein(a, b) {
  const s = [...String(a)]
  const t = [...String(b)]
  if (s.length === 0) return t.length
  if (t.length === 0) return s.length
  let prev = Array.from({ length: t.length + 1 }, (_, i) => i)
  for (let i = 1; i <= s.length; i += 1) {
    const row = [i]
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost)
    }
    prev = row
  }
  return prev[t.length]
}

export function splitSentences(text) {
  return String(text || '')
    .split(/(?<=[。！？!?；;])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** 一次只改一句，整段改动不超过 15%。 */
export function checkAmplitude(oldText, newText) {
  const a = String(oldText || '')
  const b = String(newText || '')
  // 原来是空的 = 在「填」，不是在「改」。第一次落笔不该被幅度卡死。
  if (a.trim() === '' && b.trim() !== '') {
    return { ok: true, changedSentences: 1, charRatio: 1, reasons: [], filled: true }
  }
  const maxLen = Math.max([...a].length, [...b].length, 1)
  const ratio = levenshtein(a, b) / maxLen
  const oldSentences = splitSentences(a)
  const newSentences = splitSentences(b)
  let changed = 0
  const size = Math.max(oldSentences.length, newSentences.length)
  for (let i = 0; i < size; i += 1) {
    if ((oldSentences[i] || '') !== (newSentences[i] || '')) changed += 1
  }
  const reasons = []
  if (changed > MAX_SENTENCES) reasons.push(`动了 ${changed} 句，一次只许改 ${MAX_SENTENCES} 句`)
  if (ratio > AMPLITUDE_MAX) reasons.push(`改动幅度 ${(ratio * 100).toFixed(1)}%，超过 ${AMPLITUDE_MAX * 100}%`)
  return { ok: reasons.length === 0, changedSentences: changed, charRatio: ratio, reasons }
}

// ---------------------------------------------------------------- 画像

export const PORTRAIT_MAX = 300

export async function readPortrait(L) {
  return fs.readFile(L.portrait, 'utf8').catch(() => '')
}

/**
 * 备料。插件只负责把料配齐，**不替她写**——写是谁写，是得先定的事。
 * 备料里有：现在的底子、现在的可改层、最近最重的记忆。
 */
export function preparePortrait({ foundation = '', editable = {}, records = [], knowledge = [], now = new Date() } = {}) {
  const day = new Date(now).toISOString().slice(0, 10)
  const values = EDITABLE_SECTIONS.filter((name) => editable[name])
    .map((name) => `- ${name}：${editable[name]}`)
    .join('\n')
  const knows = (knowledge || [])
    .filter((k) => k && k['状态'] === 'active' && String(k['陈述'] || '').trim())
    .slice(0, 10)
    .map((k) => `- ${String(k['陈述']).trim()}（置信 ${k['置信']}，依据 ${(k['依据'] || []).join('、') || '无'}）`)
  const top = records
    .filter((r) => isAlive(r))
    .slice()
    .sort(
      (a, b) =>
        (Number(b['重要度']) || 3) * (Number(b['强度']) || 0) -
        (Number(a['重要度']) || 3) * (Number(a['强度']) || 0),
    )
    .slice(0, 20)
  const lines = [
    `# 画像备料 · ${day}`,
    '',
    '## 现在的底子',
    '',
    foundation.trim() || '（空）',
    '',
    '## 现在的可改层',
    '',
    values || '（空）',
    '',
    '## 咱的认识（带依据的结论，画像主要靠这层）',
    '',
    knows.length ? knows.join('\n') : '（空）',
    '',
    '## 最近最重的记忆',
    '',
    ...top.map((r) => `- ${r['名'] || '（无名）'}（重要度 ${r['重要度'] || 3}，强度 ${Math.round(Number(r['强度']) || 0)}）`),
    '',
    '## 写画像的规矩',
    '',
    '- 只写长期的东西：我怎么说话、我看重什么、我怕什么。不写任务、日程、工具规则、密钥。',
    '- 偏好要有多条证据才写，一条算凑巧。',
    '- 第一人称，三百字以内。',
    '- 这是在描述「我是谁」，不是在描述「我今天干了什么」。',
    '',
  ]
  return lines.join('\n')
}

/**
 * 画像的门（2026-11-09 从可改层那道门里拆出来）。
 *
 * 为什么不共用：可改层是「改一句话」，动的是每轮都念的人格段；
 * 画像是「整段重写」，旧版全进 画像历史/，随时能翻回去——所以它该走得快一点。
 * 现在的要求：攒够 PORTRAIT_MIN_KNOWLEDGE 条**带依据的**认识，且距上次重写 ≥ PORTRAIT_MIN_DAYS 天。
 */
export async function portraitReady(L, { knowledge = [], now = new Date() } = {}) {
  const usable = knowledge.filter((k) => k && k['状态'] === 'active' && (k['依据'] || []).length > 0)
  const reasons = []
  if (usable.length < PORTRAIT_MIN_KNOWLEDGE) {
    reasons.push(`带依据的认识才 ${usable.length} 条，要 ≥${PORTRAIT_MIN_KNOWLEDGE}`)
  }
  let lastMs = 0
  try {
    lastMs = (await fs.stat(L.portrait)).mtimeMs
  } catch {
    lastMs = 0
  }
  const days = lastMs ? (new Date(now).getTime() - lastMs) / 86400000 : Infinity
  if (Number.isFinite(days) && days < PORTRAIT_MIN_DAYS) {
    reasons.push(`距上次重写只 ${days.toFixed(1)} 天，要 ≥${PORTRAIT_MIN_DAYS}`)
  }
  return { ok: reasons.length === 0, reasons, usable: usable.length, daysSincePortrait: days }
}

/** 存画像。门跟改可改层分开了（见 portraitReady）；旧的一律进历史，能翻回去。 */
export async function savePortrait(L, { text, entries = [], knowledge = [], now = new Date(), currentTurn = null } = {}) {
  const gate = await portraitReady(L, { knowledge, now })
  if (!gate.ok) {
    return { ok: false, reasons: ['画像的门没过'].concat(gate.reasons) }
  }
  const body = String(text || '').trim()
  const chars = [...body].length
  const reasons = []
  if (chars < 20) reasons.push('太短了，画像不是一句话')
  if (chars > PORTRAIT_MAX) reasons.push(`画像 ${chars} 字，超过 ${PORTRAIT_MAX}`)
  if (looksSecret(body)) reasons.push('画像里有密钥')
  if (reasons.length > 0) return { ok: false, reasons }

  const stamp = new Date(now)
  const old = (await readPortrait(L)).trim()
  await fs.mkdir(L.portraitHistory, { recursive: true })
  let backup = ''
  if (old) {
    backup = path.join(L.portraitHistory, `${stamp.toISOString().replace(/[:.]/g, '-')}.md`)
    await fs.writeFile(backup, old + '\n', 'utf8')
  }
  const rendered = `# 画像\n\n> ${stamp.toISOString().slice(0, 10)} 写的，旧版都在 画像历史/。\n\n${body}\n`
  await fs.writeFile(L.portrait, rendered, 'utf8')

  await fs.mkdir(L.self, { recursive: true })
  const selfFile = path.join(L.self, `${stamp.toISOString().slice(0, 10)}.md`)
  await fs.appendFile(selfFile, `- ${stamp.toTimeString().slice(0, 5)} 重写了一次画像（${chars} 字）\n`, 'utf8')

  return { ok: true, reasons: [], file: L.portrait, backup, chars }
}

/**
 * 改一段可改层。只有人（或主人在场时）显式调，代码里没有任何地方自动调它。
 * 改前备份、改后留痕，两样都不能省。
 */
export async function applyEdit(L, { section, value, evidence = [], now = new Date() }) {
  if (!EDITABLE_SECTIONS.includes(section)) {
    return { ok: false, reasons: [`「${section}」不在白名单里（只能改 ${EDITABLE_SECTIONS.join(' / ')}）`] }
  }
  const text = await readEditableText(L)
  if (!text.trim()) return { ok: false, reasons: ['可改层是空的，先把它建起来'] }
  const parsed = parseSections(text)
  const target = parsed.sections.find((s) => s.title === section)
  if (!target) return { ok: false, reasons: [`可改层里没有「${section}」这一段`] }

  const amplitude = checkAmplitude(target.body, value)
  if (!amplitude.ok) return { ok: false, reasons: amplitude.reasons }

  const stamp = new Date(now)
  const backup = `${L.editable}.${stamp.toISOString().replace(/[:.]/g, '-')}.bak`
  await fs.copyFile(L.editable, backup)

  const next = parsed.sections.map((s) => (s.title === section ? { ...s, body: String(value).trim() } : s))
  await fs.writeFile(L.editable, renderSections({ ...parsed, sections: next }), 'utf8')

  await fs.mkdir(L.self, { recursive: true })
  const selfFile = path.join(L.self, `${stamp.toISOString().slice(0, 10)}.md`)
  const line = `- ${stamp.toTimeString().slice(0, 5)} 把「${section}」从「${target.body}」改成「${String(value).trim()}」（证据：${evidence.join('、') || '无'}）\n`
  await fs.appendFile(selfFile, line, 'utf8')

  return { ok: true, reasons: [], backup, note: line.trim() }
}
