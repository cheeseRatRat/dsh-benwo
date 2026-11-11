/**
 * 经验层。契约 v0.2 第 14 节「期 4」。
 *
 * 跟记忆的分工，一句话：**记忆是「发生过什么」，绑人；经验是「怎么干活」，不绑人。**
 * 所以经验能拿给雪奈看，记忆不能。这也决定了它平时不进注入——只在同类活出现时露一行。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { withLock } from './store.js'
import { tokenize } from './recall.js'

export const EXP_MIN_SCORE = 0.35
export const EXP_LIMIT = 3
export const SOURCE_MAX = 5

const KEYS = ['名', '分类', '触发', '常驻', '用到', '最后用', '来源']

function coerce(value) {
  const v = String(value).trim()
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim()
    return inner ? inner.split(',').map((s) => s.trim()).filter(Boolean) : []
  }
  if (/^\d+$/.test(v)) return Number(v)
  return v
}

export function parseExperience(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!match) return null
  const meta = {}
  for (const line of match[1].split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at < 0) continue
    meta[line.slice(0, at).trim()] = coerce(line.slice(at + 1))
  }
  return { meta, body: text.slice(match[0].length).trim() }
}

export function renderExperience(exp) {
  const lines = ['---']
  for (const key of KEYS) {
    if (exp[key] === undefined || exp[key] === null) continue
    lines.push(`${key}: ${Array.isArray(exp[key]) ? `[${exp[key].join(', ')}]` : exp[key]}`)
  }
  lines.push('---', '', String(exp.body || '').trim(), '')
  return lines.join('\n')
}

/** 文件夹名和文件名都过滤掉 Windows 不认的字符，路径就穿不出去。 */
export function safeName(value, fallback = '未命名') {
  const cleaned = String(value || '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '-')
    .replace(/^\.+$/, '')
    .trim()
  return cleaned || fallback
}

export function experienceDir(L, category) {
  return path.join(L.exp, safeName(category, '未分类'))
}

export function experiencePath(L, category, name) {
  return path.join(experienceDir(L, category), `${safeName(name)}.md`)
}

export async function saveExperience(L, { 名, 分类 = '未分类', 触发 = [], body, 来源 = [] }, now = new Date()) {
  const name = safeName(名)
  const category = safeName(分类, '未分类')
  if (!String(body || '').trim()) return { ok: false, reasons: ['经验正文不能是空的'] }
  const file = experiencePath(L, category, name)
  await fs.mkdir(experienceDir(L, category), { recursive: true })

  let used = 0
  let lastUsed = ''
  let pinned = false
  const existing = await fs.readFile(file, 'utf8').catch(() => '')
  if (existing) {
    const parsed = parseExperience(existing)
    if (parsed) {
      used = Number(parsed.meta['用到']) || 0
      lastUsed = String(parsed.meta['最后用'] || '')
      pinned = String(parsed.meta['常驻'] || '') === 'true'
    }
  }
  const exp = {
    '名': name,
    '分类': category,
    '触发': (Array.isArray(触发) ? 触发 : [触发]).filter(Boolean).slice(0, 8),
    '常驻': pinned ? 'true' : 'false',
    '用到': used,
    '最后用': lastUsed,
    '来源': (Array.isArray(来源) ? 来源 : [来源]).filter(Boolean).slice(0, SOURCE_MAX),
    body: String(body).trim(),
  }
  await withLock('exp:' + file, () => fs.writeFile(file, renderExperience(exp), 'utf8'))
  return { ok: true, reasons: [], file, exp, fresh: !existing }
}

async function walk(dir, out) {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(full, out)
    else if (entry.name.endsWith('.md')) out.push(full)
  }
}

export async function readAllExperience(L) {
  const files = []
  await walk(L.exp, files)
  const list = []
  const broken = []
  for (const file of files) {
    try {
      const text = await fs.readFile(file, 'utf8')
      const parsed = parseExperience(text)
      if (!parsed) {
        broken.push({ file, message: '没有 front matter' })
        continue
      }
      const category = String(parsed.meta['分类'] || path.basename(path.dirname(file)))
      list.push({
        '名': String(parsed.meta['名'] || path.basename(file, '.md')),
        '分类': category,
        '触发': Array.isArray(parsed.meta['触发']) ? parsed.meta['触发'] : [],
        '常驻': String(parsed.meta['常驻'] || '') === 'true',
        '用到': Number(parsed.meta['用到']) || 0,
        '最后用': String(parsed.meta['最后用'] || ''),
        '来源': Array.isArray(parsed.meta['来源']) ? parsed.meta['来源'] : [],
        body: parsed.body,
        file,
      })
    } catch (error) {
      broken.push({ file, message: String(error && error.message) })
    }
  }
  return { list, broken }
}

/** 触发词整词出现在问句里算重，正文对上的算轻。 */
export function scoreExperience(exp, queryTokens, query = '') {
  const grams = new Set(queryTokens)
  if (grams.size === 0) return 0
  const raw = String(query || '').toLowerCase()
  const triggers = (exp['触发'] || []).map((t) => String(t).toLowerCase())
  // 整词命中：问句里原样出现了「对账」这种触发词。这比字面重合强得多——
  // 用户不会把关键词拆成 2-gram 说，但会原样说出来。
  const exact = triggers.some((t) => t.length >= 2 && raw.includes(t)) ? 1 : 0
  let triggerHit = 0
  for (const gram of grams) {
    if (triggers.some((t) => t.includes(gram) || gram.includes(t))) triggerHit += 1
  }
  const doc = new Set(tokenize(`${exp['名']} ${exp['触发'].join(' ')} ${exp.body}`))
  let bodyHit = 0
  for (const gram of grams) if (doc.has(gram)) bodyHit += 1
  const coverage = bodyHit / grams.size
  const triggerCoverage = triggerHit / grams.size
  return Math.min(1, 0.5 * exact + 0.3 * triggerCoverage + 0.2 * coverage)
}

export function findExperience(list = [], query = '', { limit = EXP_LIMIT, min = EXP_MIN_SCORE } = {}) {
  const tokens = tokenize(query)
  if (tokens.length === 0) return []
  return list
    .map((exp) => ({ exp, score: scoreExperience(exp, tokens, query) }))
    .filter((hit) => hit.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

/** 常驻 / 不常驻。常驻的每轮都会在注入里露一行名字。 */
export async function setPinned(exp, pinned) {
  if (!exp || !exp.file) return null
  const next = { ...exp, '常驻': pinned ? 'true' : 'false' }
  await withLock('exp:' + exp.file, () => fs.writeFile(exp.file, renderExperience(next), 'utf8'))
  return next
}

/** 用过一次就记一笔。这是「哪条经验真管用」的唯一证据。 */
export async function bumpExperience(exp, now = new Date()) {
  if (!exp || !exp.file) return null
  const next = {
    ...exp,
    '用到': (Number(exp['用到']) || 0) + 1,
    '最后用': new Date(now).toISOString(),
  }
  await withLock('exp:' + exp.file, () => fs.writeFile(exp.file, renderExperience(next), 'utf8'))
  return next
}
