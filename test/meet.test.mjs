/**
 * 见面（2026-11-10 夜）。
 *
 * 病：以前核只知道「上次是哪天」，不知道见过几面——
 * 「7 天没聊」和「7 天里天天聊」在它眼里一模一样。
 * 主人原话：「今天我上线，小蓝还以为是昨天哩。」
 *
 * 一条一天算一面；turns 记同一天说了几轮，不另外算面。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { meetStats } from '../src/core/store.js'

let passed = 0
let failed = 0
const check = (name, fn) => {
  try {
    fn()
    passed += 1
  } catch (error) {
    failed += 1
    console.error('FAIL', name, '—', error.message)
  }
}

const NOW = new Date('2026-11-10T22:00:00+08:00')

check('今天第一次见面 → 第 1 面', () => {
  const m = meetStats({ '2026-11-10': 3 }, '2026-11-10', NOW)
  assert.equal(m.total, 1)
  assert.equal(m.rank, 1)
  assert.equal(m.turnsToday, 3)
})

check('累计几天就是第几面（今天在中间也算对）', () => {
  const m = meetStats(
    { '2026-11-01': 2, '2026-11-05': 1, '2026-11-10': 4 },
    '2026-11-10',
    NOW,
  )
  assert.equal(m.total, 3)
  assert.equal(m.rank, 3, '11-10 是第三个见过的日子')
})

check('今天还没记账 → 算下一面（不假装已经见过）', () => {
  const m = meetStats({ '2026-11-08': 1, '2026-11-09': 2 }, '2026-11-10', NOW)
  assert.equal(m.total, 2)
  assert.equal(m.rank, 3)
  assert.equal(m.turnsToday, 0)
})

check('近 7 天只看最近 7 天（含今天）', () => {
  const m = meetStats(
    { '2026-10-20': 1, '2026-11-04': 1, '2026-11-09': 1, '2026-11-10': 1 },
    '2026-11-10',
    NOW,
    7,
  )
  assert.equal(m.total, 4, '总共见过 4 天')
  assert.equal(m.recent, 3, '近 7 天是 11-04 / 11-09 / 11-10')
})

check('空账不炸', () => {
  const m = meetStats({}, '2026-11-10', NOW)
  assert.equal(m.total, 0)
  assert.equal(m.rank, 1)
  assert.equal(m.recent, 0)
})

check('源码守卫：每轮真的记一面（在场才记）', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const src = fs.readFileSync(path.resolve(here, '..', 'index.js'), 'utf8')
  assert.ok(src.includes('noteMeet('), '没接上 noteMeet')
  assert.ok(/if \(state\.active && L && L\.state\)/.test(src), '该只在场才记见面')
  assert.ok(src.includes('meetStats('), '注入里没用上见面统计')
})

console.log(`见面记账 ${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
