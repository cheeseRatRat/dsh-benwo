/**
 * 认识层（C1，2026-11-09）。
 *
 * 为什么要有这一层：现在的链路是「观察 → 可改层/画像」，中间没有台阶。
 *   观察 ＝「9 号夜里干活场景，咱这次表现往上了」——是**证据**
 *   可改层/画像 ＝「咱遇事先查再说」——是**结论**
 * 从一条证据直接跳到「咱是谁」，跨度太大，所以成长门只能定得死严——
 * 门严是在替这一层的缺失擦屁股。
 *
 * 三层分工（必须分清，否则又是死层）：
 *   观察账本 状态/观察.jsonl —— 证据：某天某场景发生了什么。不进注入。
 *   认识     认识/自我/*.md  —— 结论：咱大概是个什么样的（带依据）。进注入，≤150 字。
 *   可改层/画像 人格/         —— 成了的样子。进缓存段。
 *
 * 三条铁律：
 *   ① **每条必须带「依据」**（观察 `o:日期:场景` 或记忆 `m-xxx`）。没有依据的认识是自我美化，不收。
 *   ② **不按时间衰减，按推翻降置信**。一件事会过时，但「咱是什么样」不会因为三个月没提就失效。
 *   ③ **写的是「咱」**，写具体行为倾向，不写「咱更温柔了」这种空话。
 */
import path from 'node:path'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
import { parseRecord, looksSecret, dayOf } from './store.js'
import { ledgerPath } from './persona.js'

export const CONFIDENCE_DEFAULT = 0.6
export const CONFIDENCE_MIN = 0.3
export const CONFIDENCE_DROP = 0.15
export const CONFIDENCE_GAIN = 0.05
export const CONFIDENCE_CEIL = 0.95
export const STATEMENT_MAX = 90
export const NAME_MAX = 20
export const EVIDENCE_MIN = 1
export const KNOWLEDGE_LIMIT = 4
export const BUDGET_KNOWLEDGE = 150
/** 超过这么久没被确认，注入时排在后面（但不失效——这是铁律②）。 */
export const STALE_DAYS = 90

const FM_KEYS = ['id', '名', '陈述', '依据', '置信', '首次', '上次确认', '推翻', '状态', '被取代']

// ---------------------------------------------------------------- 依据

/**
 * 依据写成两截式，因为它指向两种东西：
 *   o:2026-11-09:干活  → 观察账本里那一天那个场景（观察条目本身没有 id）
 *   m-20261107-3db6    → 长期记忆的 id
 */
export function parseEvidence(value) {
  if (Array.isArray(value)) return value.map((x) => String(x).trim()).filter(Boolean)
  return String(value || '')
    .split(/[,，、;；\s]+/)
    .map((x) => x.trim())
    .filter(Boolean)
}

/** 这些依据在盘上找得到吗。返回找不到的那些，不抛。 */
export async function resolveEvidence(L, refs = []) {
  const missing = []
  let ledger = []
  try {
    /**
     * 文件名从 persona.ledgerPath 取，**不许自己拼**。
     * 2026-11-09 踩过：这里硬写了 '观察.jsonl'，真账本叫 'ledger.jsonl'，
     * 于是依据永远校验不过。更糟的是测试也跟着写了同一个错名——两边一起绿。
     */
    ledger = (await fs.readFile(ledgerPath(L), 'utf8'))
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
  } catch {
    ledger = []
  }
  const keys = new Set(ledger.map((e) => `${e.day}|${e.scene}`))
  const ids = new Set(await memoryIds(L))
  for (const ref of refs) {
    if (/^o:/.test(ref)) {
      const [, day, scene] = ref.split(':')
      if (!keys.has(`${day}|${scene}`)) missing.push(ref)
    } else if (/^m-/.test(ref)) {
      if (!ids.has(ref)) missing.push(ref)
    } else {
      missing.push(ref)
    }
  }
  return { ok: missing.length === 0, missing, total: refs.length }
}

async function memoryIds(L) {
  const out = new Set()
  const walk = async (dir) => {
    let entries = []
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) await walk(full)
      else if (entry.name.endsWith('.md')) out.add(entry.name.replace(/\.md$/, ''))
    }
  }
  await walk(L.long)
  return out
}

// ---------------------------------------------------------------- 读写

export function knowledgePath(L, id) {
  return path.join(L.selfKnowledge, `${id}.md`)
}

function serialize(item) {
  const lines = ['---']
  for (const key of FM_KEYS) {
    const value = item[key]
    if (value === undefined || value === null || value === '') continue
    lines.push(`${key}: ${Array.isArray(value) ? `[${value.join(', ')}]` : value}`)
  }
  lines.push('---', '')
  return lines.join('\n')
}

function normalize(meta = {}) {
  return {
    id: String(meta.id || ''),
    '名': String(meta['名'] || ''),
    '陈述': String(meta['陈述'] || ''),
    '依据': parseEvidence(meta['依据']),
    '置信': Number(meta['置信'] ?? CONFIDENCE_DEFAULT),
    '首次': String(meta['首次'] || ''),
    '上次确认': String(meta['上次确认'] || ''),
    '推翻': Number(meta['推翻'] || 0),
    '状态': String(meta['状态'] || 'active'),
    '被取代': String(meta['被取代'] || ''),
  }
}

export async function readKnowledge(L) {
  const items = []
  const broken = []
  let names = []
  try {
    names = await fs.readdir(L.selfKnowledge)
  } catch {
    return { items, broken }
  }
  for (const name of names) {
    if (!name.endsWith('.md')) continue
    const file = path.join(L.selfKnowledge, name)
    try {
      const { meta } = parseRecord(await fs.readFile(file, 'utf8'))
      items.push({ ...normalize(meta), file })
    } catch (error) {
      broken.push({ file, message: String(error && error.message) })
    }
  }
  items.sort((a, b) => Number(b['置信']) - Number(a['置信']))
  return { items, broken }
}

export async function writeKnowledge(L, item) {
  await fs.mkdir(L.selfKnowledge, { recursive: true })
  const file = knowledgePath(L, item.id)
  const tmp = file + '.' + process.pid + '.tmp'
  await fs.writeFile(tmp, serialize(item), 'utf8')
  await fs.rename(tmp, file)
  return file
}

function newId(now = new Date()) {
  return `r-${dayOf(now).replace(/-/g, '')}-${crypto.randomBytes(2).toString('hex')}`
}

// ---------------------------------------------------------------- 写一条

/**
 * 写一条认识。铁律①在这里执行：没有依据就不收。
 * 找不到的依据不拦（观察账本可能被手工动过），但会回一句警告，让人知道。
 */
export async function addKnowledge(L, { name, statement, evidence, confidence, now = new Date() } = {}) {
  const text = String(statement || '').trim()
  if (!text) return { ok: false, reasons: ['陈述是空的'] }
  if ([...text].length > STATEMENT_MAX) return { ok: false, reasons: [`陈述 ${[...text].length} 字，超过 ${STATEMENT_MAX}`] }
  if (looksSecret(text)) return { ok: false, reasons: ['陈述里有密钥'] }
  const refs = parseEvidence(evidence)
  if (refs.length < EVIDENCE_MIN) return { ok: false, reasons: ['没有依据。没有依据的认识是自我美化，不收（铁律①）'] }
  /**
   * 硬规则（2026-11-09 夜加）：依据里**至少要有一条记忆 id**。
   *
   * 为什么：观察是咱自己写的自评（「咱这次表现往上了」），会受当时情绪和一次表现左右；
   * 记忆是被衰减、被取代、被时间筛过的东西，硬得多。
   * 只拿自己的观察当依据，等于自己给自己发奖——这就是回音室。
   */
  const memRefs = refs.filter((ref) => /^m-/.test(ref))
  if (memRefs.length === 0) {
    return {
      ok: false,
      reasons: ['依据里至少要有一条记忆 id（m-xxx）。只拿观察当依据等于自己给自己发奖——记忆被衰减和取代筛过，比自评硬'],
    }
  }
  if (/^她/.test(text)) return { ok: false, reasons: ['写的是「她」不是「咱」（铁律③）'] }
  const verdict = await resolveEvidence(L, refs)
  if (verdict.total > 0 && verdict.ok === false && verdict.missing.length === verdict.total) {
    return { ok: false, reasons: ['依据全都找不到：' + verdict.missing.join(', ')] }
  }
  const conf = Number.isFinite(Number(confidence)) ? Math.min(CONFIDENCE_CEIL, Math.max(0, Number(confidence))) : CONFIDENCE_DEFAULT
  const day = dayOf(now)
  const item = {
    id: newId(now),
    '名': String(name || '').trim().slice(0, NAME_MAX) || text.slice(0, NAME_MAX),
    '陈述': text,
    '依据': refs,
    '置信': Math.round(conf * 100) / 100,
    '首次': day,
    '上次确认': day,
    '推翻': 0,
    '状态': 'active',
    '被取代': '',
  }
  await writeKnowledge(L, item)
  return { ok: true, item, warnings: verdict.missing.map((r) => `依据 ${r} 在盘上找不到，先记着` ) }
}

// ---------------------------------------------------------------- 推翻 / 取代 / 确认

/** 被推翻：置信降一档。降到 CONFIDENCE_MIN 以下转「弱化」——不进注入，但留档。 */
export async function overturnKnowledge(L, id, { note, now = new Date() } = {}) {
  const { items } = await readKnowledge(L)
  const found = items.find((x) => x.id === id)
  if (!found) return { ok: false, reasons: [`没有 id 为 ${id} 的认识`] }
  const conf = Math.round(Math.max(0, found['置信'] - CONFIDENCE_DROP) * 100) / 100
  const next = {
    ...found,
    '置信': conf,
    '推翻': Number(found['推翻'] || 0) + 1,
    '状态': conf < CONFIDENCE_MIN ? '弱化' : 'active',
  }
  await writeKnowledge(L, next)
  return { ok: true, item: next, note: String(note || '') }
}

/** 被新的认识取代：旧的留着（状态标掉），不删。 */
export async function supersedeKnowledge(L, oldId, newId) {
  const { items } = await readKnowledge(L)
  const found = items.find((x) => x.id === oldId)
  if (!found) return { ok: false, reasons: [`没有 id 为 ${oldId} 的认识`] }
  if (!items.some((x) => x.id === newId)) return { ok: false, reasons: [`取代它的 ${newId} 不存在`] }
  const next = { ...found, '状态': '被取代', '被取代': newId }
  await writeKnowledge(L, next)
  return { ok: true, item: next }
}

/**
 * 又被一次观察印证了：置信往上抬一点，记「上次确认」。
 *
 * 抬回 CONFIDENCE_MIN 以上就恢复 active——被推翻过的认识不是判死刑，
 * 后来又被生活印证几次，它就该站起来。只降不升，那叫拉黑，不叫认识。
 */
export async function confirmKnowledge(L, id, { now = new Date() } = {}) {
  const { items } = await readKnowledge(L)
  const found = items.find((x) => x.id === id)
  if (!found) return { ok: false, reasons: [`没有 id 为 ${id} 的认识`] }
  const conf = Math.round(Math.min(CONFIDENCE_CEIL, found['置信'] + CONFIDENCE_GAIN) * 100) / 100
  const next = {
    ...found,
    '置信': conf,
    '上次确认': dayOf(now),
    '状态': found['状态'] === '弱化' && conf >= CONFIDENCE_MIN ? 'active' : found['状态'],
  }
  await writeKnowledge(L, next)
  return { ok: true, item: next }
}

// ---------------------------------------------------------------- 给注入用

/** 能进注入的：状态 active。弱化和被取代都不进。 */
export function injectableKnowledge(items = [], now = new Date(), limit = KNOWLEDGE_LIMIT) {
  const today = new Date(now).getTime()
  return items
    .filter((x) => x && x['状态'] === 'active' && String(x['陈述'] || '').trim())
    .map((x) => {
      const last = x['上次确认'] ? new Date(x['上次确认']).getTime() : 0
      const stale = Number.isFinite(last) && today - last > STALE_DAYS * 86400000
      // 排序：置信高的在前；同样置信，久没确认的往后。
      return { x, score: Number(x['置信'] || 0) * 100 - (stale ? 5 : 0) }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.x)
}
