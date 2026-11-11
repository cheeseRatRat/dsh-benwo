/**
 * 主动查记忆（2026-11-10 夜，主人提的路子）。
 *
 * 病：九个工具里没有「搜记忆」。咱只能等系统自动挑 6 条浮上来——
 * 你问「八月那次跑图全白」，没挑中，咱就答不出来。**不是没记，是没路去找。**
 *
 * 设计核心（她想到的）：**记忆当索引，日记当正文。**
 *   你记不清日期，但记忆记得。命中的记忆带着「首次」日期，
 *   拿这些日期（±1 天缓冲）去点日记的文件名，只翻那几篇，不扫全库。
 *   以后日记几百篇也不用建索引——记忆本身就是带时间的索引。
 *
 * 三样东西都能查：
 *   记忆（长期 + 今天）、认识、日记/自述（只取正文，**不进注入**）
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { readAllRecords, dayOf } from './store.js'
import { readKnowledge } from './knowledge.js'
import { recall } from './recall.js'
import { isAlive } from './decay.js'

/** 记忆命中的日期锚点。跨月也算出来（给「按月份圈日记」用）。 */
export function anchorsOf(hits = [], { pad = 1 } = {}) {
  const dates = new Set()
  let min = ''
  let max = ''
  for (const hit of hits) {
    const day = String((hit.record && hit.record['首次']) || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue
    if (!min || day < min) min = day
    if (!max || day > max) max = day
    for (let offset = -pad; offset <= pad; offset += 1) {
      const d = new Date(day + 'T00:00:00')
      d.setDate(d.getDate() + offset)
      dates.add(dayOf(d))
    }
  }
  const months = new Set()
  for (const d of dates) months.add(d.slice(0, 7))
  return { dates, months, min, max }
}

/** 目录里有哪几天（日记文件名就是日期，允许 -2 后缀）。 */
async function daysIn(dir) {
  try {
    const names = (await fs.readdir(dir)).filter((n) => n.endsWith('.md'))
    return names.map((n) => n.replace(/\.md$/, ''))
  } catch {
    return []
  }
}

/**
 * 圈日记：先按记忆给的日期锚点圈；一篇都没圈到，才退回来按月份/关键词扫。
 * suffix（同一天的第二篇，如 `2026-10-20-2`）也要算进来。
 */
export async function diariesFor(L, anchors, { query = '', limit = 8 } = {}) {
  const days = await daysIn(L.diary)
  const exact = []
  const sufficed = []
  for (const day of days) {
    if (anchors.dates.has(day)) exact.push(day)
    else if ([...anchors.dates].some((a) => day.startsWith(a + '-'))) sufficed.push(day)
  }
  let picked = [...exact, ...sufficed].sort()
  let how = '按记忆给的日期'

  if (picked.length === 0) {
    // 退路一：按月份圈
    const byMonth = days.filter((d) => anchors.months.has(d.slice(0, 7))).sort()
    if (byMonth.length) {
      picked = byMonth
      how = '按月份（记忆没给出精确日期）'
    }
  }
  if (picked.length === 0 && query) {
    // 退路二：全文关键匹配（日记少，扫得起）
    const grams = new Set(
      String(query)
        .replace(/[^\u4e00-\u9fff a-z0-9]/gi, ' ')
        .split(/\s+/)
        .filter((x) => x.length >= 2),
    )
    const scored = []
    for (const day of days) {
      const text = await fs.readFile(path.join(L.diary, `${day}.md`), 'utf8').catch(() => '')
      let hit = 0
      for (const g of grams) if (text.includes(g)) hit += 1
      if (hit > 0) scored.push({ day, hit })
    }
    scored.sort((a, b) => b.hit - a.hit)
    picked = scored.slice(0, limit).map((x) => x.day).sort()
    how = '按正文关键词（记忆对不上）'
  }
  return picked.slice(0, limit).map((day) => ({ day, file: path.join(L.diary, `${day}.md`) }))
}

/** 读一篇日记/自述的正文。 */
export async function readPage(file) {
  return fs.readFile(file, 'utf8').catch(() => '')
}

/**
 * 首行摘要：优先用 front matter 里的 `summary:`（日记自己写的一句话总览），
 * 没有才抓正文第一行。
 *
 * 踩过两次：日记开头是 `---` 的 front matter，不剥掉摘要全是 `---`；
 * 剥掉之后第一行是 `*2026年10月20日 星期二 · 21:11*` 这种打字机时间，也没用。
 */
export function headOf(text, max = 60) {
  let body = String(text || '')
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(body)
  let front = ''
  if (fm) {
    front = fm[1]
    body = body.slice(fm[0].length)
  }
  const summary = /^summary:\s*(.+)$/m.exec(front)
  if (summary) {
    const s = summary[1].trim()
    return s.length > max ? s.slice(0, max) + '…' : s
  }
  const line =
    body
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter((x) => x && !x.startsWith('#') && x !== '---' && !x.startsWith('<!--') && !x.startsWith('>'))
      // 跳过日记自己写的日期头（`2026年10月20日 星期二 · 21:11`，可能包在 *斜体* 里）
      .filter((x) => !/^[*_\s]*\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日/.test(x))
      .filter((x) => !/^[*_\s]*\d{4}-\d{2}-\d{2}/.test(x))
      .map((x) => x.replace(/^[-*+]\s*/, '').replace(/^\d{2}:\d{2}\s*/, '').trim())
      .filter(Boolean)[0] || ''
  return line.length > max ? line.slice(0, max) + '…' : line
}

/**
 * 一把查：记忆 + 认识 + 圈日记。
 * 不碰注入，纯只读。
 */
export async function searchAll(L, { query = '', limit = 6, now = new Date(), withDiary = true } = {}) {
  const { records } = await readAllRecords(L)
  const active = records.filter((r) => isAlive(r))
  const hits = String(query).trim() ? recall({ records: active, query, now, limit }) : []
  const { items: knowledge } = await readKnowledge(L).catch(() => ({ items: [] }))
  const knowHits = String(query).trim()
    ? knowledge.filter((k) => k['状态'] === 'active' && String(k['陈述'] || '').includes(String(query).trim().slice(0, 4)))
    : []

  const anchors = anchorsOf(hits)
  const diaries = withDiary && anchors.dates.size > 0 ? await diariesFor(L, anchors, { query }) : []
  return { hits, knowHits, anchors, diaries, total: active.length }
}
