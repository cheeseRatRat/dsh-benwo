/**
 * 共同经历（C2，2026-11-09 夜）。
 *
 * 治什么：58 条事件是**平铺**的——每条都在，但没有「我们一起做过这几件大事」的脉络。
 * 这一层按月把「事件」类记忆排成一行一条，回答的是主人的第二个目标：
 *   **「咱知道我们一起做过什么」**。
 *
 * 三条硬规矩：
 *   ① **纯机械生成，不调模型**。排的是已有的名和日期，不产生任何新判断。
 *   ② **不进注入**（主人 2026-11-09 定：回顾性的东西平时不需要每轮带着）。
 *      只做「问得起来就能查」——懒生成：第一次读某个月时才写文件。
 *   ③ 只收 `事件`。约定是规矩、偏好是口味，它们不属于「做过什么」。
 */
import path from 'node:path'
import fs from 'node:fs/promises'
import { isAlive } from './decay.js'

export const JOURNEY_KIND = '事件'

/** 月份：YYYY-MM。取「首次」的前 7 位（老记录里是纯日期，新的可能是完整 ISO）。 */
export function monthOf(record) {
  const day = String((record && record['首次']) || '').trim()
  const m = /^(\d{4})-(\d{2})/.exec(day)
  return m ? `${m[1]}-${m[2]}` : ''
}

function dayOf(record) {
  const day = String((record && record['首次']) || '').trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(day)
  return m ? `${m[2]}.${m[3]}` : ''
}

/** 这个月有哪些天、哪些事。纯函数，不碰盘。 */
export function pickMonth(records = [], month) {
  return records
    .filter((r) => isAlive(r) && r['类型'] === JOURNEY_KIND && monthOf(r) === month)
    .map((r) => ({ id: r.id, day: dayOf(r), name: String(r['名'] || '').trim() || String(r.body || '').split(/\r?\n/)[0].slice(0, 20) }))
    .filter((x) => x.day && x.name)
    .sort((a, b) => (a.day + a.id).localeCompare(b.day + b.id))
}

/** 渲染成文件内容。一行一条，最简。 */
export function renderMonth(month, items = []) {
  const lines = [`# ${month} · 我们一起做过的事`, '']
  if (items.length === 0) {
    lines.push('（这个月没有记下「事件」类的记忆。）')
  } else {
    for (const item of items) lines.push(`- ${item.day} ${item.name}`)
  }
  lines.push('')
  return lines.join('\n')
}

export async function readMonthFile(L, month) {
  try {
    return await fs.readFile(path.join(L.journey, `${month}.md`), 'utf8')
  } catch {
    return ''
  }
}

/**
 * 取某个月。文件在就直接读；不在就**现场生成并写下来**（懒生成）。
 * 生成是幂等的：同样的记忆排出来一样，重复跑不会变。
 */
export async function readJourneyMonth(L, month, records = []) {
  const existing = await readMonthFile(L, month)
  if (existing.trim()) return { month, text: existing, items: pickMonth(records, month), generated: false }
  const items = pickMonth(records, month)
  const text = renderMonth(month, items)
  await fs.mkdir(L.journey, { recursive: true })
  await fs.writeFile(path.join(L.journey, `${month}.md`), text, 'utf8')
  return { month, text, items, generated: true }
}

/** 有哪些月份（从记忆里推，不从磁盘推——磁盘上可能一个都还没生成）。 */
export function monthsOf(records = []) {
  const set = new Set()
  for (const r of records) {
    if (!isAlive(r) || r['类型'] !== JOURNEY_KIND) continue
    const m = monthOf(r)
    if (m) set.add(m)
  }
  return [...set].sort()
}

/** 重新生成某个月（记忆变了之后用）。 */
export async function rebuildJourneyMonth(L, month, records = []) {
  const items = pickMonth(records, month)
  const text = renderMonth(month, items)
  await fs.mkdir(L.journey, { recursive: true })
  await fs.writeFile(path.join(L.journey, `${month}.md`), text, 'utf8')
  return { month, text, items }
}
