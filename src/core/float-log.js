/**
 * 浮上的账本。契约补充：别让同三条一直转。
 *
 * 每轮 refresh 记一次浮过谁。上一轮浮过的，这轮先歇着——
 * 只在「没有问句、按强度挑」的时候生效；有问句走召回，该答的必须答上，
 * 怀旧式的轮换不能拦正事。
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { withLock } from './store.js'

export const FLOAT_FILE = '浮上.json'
export const KEEP_ROUNDS = 4

export function floatPath(L) {
  return path.join(L.status, FLOAT_FILE)
}

export async function readFloatLog(L) {
  let raw = ''
  try {
    raw = await fs.readFile(floatPath(L), 'utf8')
  } catch {
    return { seq: 0, recent: new Map(), counts: new Map() }
  }
  let data = {}
  try {
    data = JSON.parse(raw)
  } catch {
    return { seq: 0, recent: new Map(), counts: new Map() }
  }
  const seq = Number(data['序号'] ?? 0)
  const recent = new Map()
  for (const item of Array.isArray(data['近轮']) ? data['近轮'] : []) {
    if (item && item.id) recent.set(String(item.id), Number(item['序'] ?? 0))
  }
  // 带过几次（B3）。老账本没有这一栏，读成空表就是「都没带过」。
  const counts = new Map()
  const rawCounts = data['带过'] && typeof data['带过'] === 'object' ? data['带过'] : {}
  for (const [id, n] of Object.entries(rawCounts)) {
    const value = Number(n)
    if (Number.isFinite(value) && value > 0) counts.set(String(id), value)
  }
  return { seq: Number.isFinite(seq) ? seq : 0, recent, counts }
}

/** 上一轮浮过的那些 id。 */
export function cooldownOf(log) {
  const out = new Set()
  if (!log || !(log.recent instanceof Map)) return out
  for (const [id, seq] of log.recent) {
    if (seq >= log.seq - 1) out.add(id)
  }
  return out
}

/**
 * 带过 ≥N 次的那批（B3）。
 *
 * 病：冷却只记「上一轮浮过谁」，于是同一批记忆隔一轮又整段上来，
 * 摘要每次都重复一遍，白占预算。
 * 治：带够 TIRED_AFTER 次之后，注入时**只给标题行、不给摘要**——
 * 摘要只在「淡了、需要补上下文」的时候才值那个价钱。
 * 召回（有问句）不算在内：那是真问到了，该给的全给。
 */
export const TIRED_AFTER = 2

export function tiredOf(log, threshold = TIRED_AFTER) {
  const out = new Set()
  if (!log || !(log.counts instanceof Map)) return out
  for (const [id, n] of log.counts) {
    if (n >= threshold) out.add(id)
  }
  return out
}

export async function noteFloated(L, ids = []) {
  const list = ids.filter(Boolean).map(String)
  if (list.length === 0) return { seq: 0, recent: new Map(), counts: new Map() }
  return withLock('float', async () => {
    const log = await readFloatLog(L)
    const seq = log.seq + 1
    const recent = new Map(log.recent)
    for (const id of list) recent.set(id, seq)
    const kept = [...recent.entries()].filter(([, s]) => s > seq - KEEP_ROUNDS)
    // 带过计数：只记最近 KEEP_ROUNDS 轮里还在动的那批，别无限长。
    const counts = new Map()
    for (const [id] of kept) counts.set(id, (log.counts.get(id) || 0) + (list.includes(id) ? 1 : 0))
    const payload = {
      '序号': seq,
      '近轮': kept.map(([id, s]) => ({ id, '序': s })),
      '带过': Object.fromEntries([...counts.entries()].filter(([, n]) => n > 0)),
    }
    await fs.mkdir(L.status, { recursive: true })
    await fs.writeFile(floatPath(L), JSON.stringify(payload, null, 2) + '\n', 'utf8')
    return { seq, recent: new Map(kept), counts }
  })
}
