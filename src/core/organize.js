/**
 * 整理：攒够分量才动。契约 v0.2 第 8 节。
 *
 * 触发看「未巩固条目的重要度累加 ≥ 25」，不看条数、不看时间。
 * 一天最多两次——要求模型反复元反思自己，正是人格漂移的高发场景。
 * 反思产出必须带证据编号：以后翻到「她最近变得更好说话了」，
 * 能顺着编号点回原话，而不是一句无凭无据的自我评价。
 */
import { tokenize, tokenSet, jaccard, DUP_JACCARD } from './recall.js'
import { isAlive } from './decay.js'

export const ORGANIZE_THRESHOLD = 25
export const ORGANIZE_MAX_PER_DAY = 2
export const REFLECT_TOP = 3

/** 还没整理过的条目。有「整理」日期就算整理过。 */
export function pending(records = []) {
  return records.filter((r) => isAlive(r) && !r['整理'])
}

/** 未巩固的重要度加起来够不够开工。 */
export function organizeWeight(records = []) {
  return pending(records).reduce((sum, r) => sum + (Number(r['重要度']) || 3), 0)
}

export function shouldOrganize(records = [], doneToday = 0) {
  if (doneToday >= ORGANIZE_MAX_PER_DAY) {
    return { ok: false, reason: `今天已经整理 ${doneToday} 次，到上限了`, weight: 0 }
  }
  const weight = organizeWeight(records)
  if (weight < ORGANIZE_THRESHOLD) {
    return { ok: false, reason: `还差 ${ORGANIZE_THRESHOLD - weight} 分才攒够`, weight }
  }
  return { ok: true, reason: '', weight }
}

/**
 * 合并重复：Jaccard > 0.8 的算同一条。
 * 留证据多、强度高的那条；其余标「被取代」，正文一个字不改。
 */
export function mergeDuplicates(records = []) {
  const active = records.filter((r) => isAlive(r))
  const sets = new Map(active.map((r) => [r.id, tokenSet(`${r['名'] || ''} ${r.body || ''}`)]))
  const survivorOf = new Map()
  const replaced = []

  for (let i = 0; i < active.length; i += 1) {
    const a = active[i]
    if (survivorOf.has(a.id)) continue
    const group = [a]
    for (let j = i + 1; j < active.length; j += 1) {
      const b = active[j]
      if (survivorOf.has(b.id)) continue
      if (jaccard(sets.get(a.id), sets.get(b.id)) > DUP_JACCARD) group.push(b)
    }
    if (group.length < 2) continue
    group.sort(
      (x, y) =>
        (Number(y['证据']) || 0) - (Number(x['证据']) || 0) ||
        (Number(y['强度']) || 0) - (Number(x['强度']) || 0),
    )
    const survivor = group[0]
    for (const other of group.slice(1)) {
      survivorOf.set(other.id, survivor.id)
      replaced.push({ id: other.id, by: survivor.id, '名': other['名'] })
    }
  }
  return { survivorOf, replaced }
}

/** 把合并结果落到记录上：别的被标「被取代」。 */
export function applyMerges(records = [], survivorOf = new Map(), now = new Date()) {
  const stamp = new Date(now).toISOString()
  return records.map((record) => {
    const by = survivorOf.get(record.id)
    if (!by) return record
    return { ...record, '状态': '被取代', '被取代': by, '整理': stamp }
  })
}

/**
 * 写一条反思。带证据编号，带绝对日期。
 * 格式故意死板：以后机器和人一起读，不靠猜。
 */
export function buildReflection(records = [], now = new Date()) {
  const batch = pending(records)
    .slice()
    .sort((a, b) => (Number(b['重要度']) || 0) - (Number(a['重要度']) || 0))
    .slice(0, REFLECT_TOP)
  if (batch.length === 0) return { text: '', evidence: [] }
  const day = new Date(now).toISOString().slice(0, 10)
  const names = batch.map((r) => r['名'] || '（无名）')
  const ids = batch.map((r) => r.id)
  const line = batch
    .map((r) => `- ${r['名'] || '（无名）'}（重要度 ${r['重要度'] || 3}，证据 ${r['证据'] || 0}）`)
    .join('\n')
  const text = [
    `## ${day} 整理`,
    '',
    `这一批攒了 ${pending(records).length} 条没收拾，最重的是：${names.join('、')}。`,
    '',
    line,
    '',
    `证据：${ids.join('、')}`,
    '',
  ].join('\n')
  return { text, evidence: ids }
}

/** 整理完把这些条目标成「整理过」。 */
export function markOrganized(records = [], ids = [], now = new Date()) {
  const stamp = new Date(now).toISOString()
  const wanted = new Set(ids)
  return records.map((r) => (wanted.has(r.id) ? { ...r, '整理': stamp } : r))
}

export { tokenize }
