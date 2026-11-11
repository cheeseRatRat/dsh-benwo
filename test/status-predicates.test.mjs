/**
 * 「还活着」和「还能拿出来用」是两个判断（2026-11-11 统一）。
 *
 * 以前这条逻辑散在 11 个地方、5 种写法：
 *   !== '被取代' ×9 · ['被取代','已完成','作罢'] ×2 · DONE_STATUS ×1 · 含「已内化」的 ×1
 * 结果出过一个真 bug：`已内化` 的原记录在矛盾检测里被排除，注入里却照浮——
 * 内化了还占位置。
 *
 * 现在：
 *   isAlive      = 没被取代（存档层面活着；面板、整理、共同经历用）
 *   isFloatable  = 没被取代 / 没完成 / 没作罢 / 没内化（注入、召回、矛盾检测用）
 */
import assert from 'node:assert/strict'
import { isAlive, isFloatable, injectable, DEAD_STATUS, DONE_STATUS } from '../src/core/decay.js'

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

const rec = (状态, extra = {}) => ({
  id: 'x',
  '名': 'x',
  '类型': '要求',
  '强度': 80,
  '重要度': 4,
  '状态': 状态,
  '首次': '2026-11-01',
  '有效到': '',
  ...extra,
  body: 'x\n\n为什么值得记：测试。\n',
})

check('两个名单：死的只有「被取代」，不能浮的多三种', () => {
  assert.deepEqual([...DEAD_STATUS], ['被取代'])
  for (const s of ['被取代', '已完成', '作罢', '已内化']) assert.ok(DONE_STATUS.has(s), s + ' 该在 DONE_STATUS')
})

check('active：活着且能浮', () => {
  assert.equal(isAlive(rec('active')), true)
  assert.equal(isFloatable(rec('active')), true)
})

check('已内化：存档还活着，但不再浮（这就是那个 bug 的锁）', () => {
  const r = rec('已内化')
  assert.equal(isAlive(r), true, '内化不等于消失，面板还该看得见')
  assert.equal(isFloatable(r), false, '内化了还浮 = 白占位置')
  assert.equal(injectable(r), false, '注入层也不该收它')
})

check('已完成 / 作罢：能翻、不能浮', () => {
  for (const s of ['已完成', '作罢']) {
    assert.equal(isAlive(rec(s)), true)
    assert.equal(isFloatable(rec(s)), false)
  }
})

check('被取代：两个都不是', () => {
  assert.equal(isAlive(rec('被取代')), false)
  assert.equal(isFloatable(rec('被取代')), false)
})

check('预期「做了」还能浮——那是好事，留着', () => {
  assert.equal(isFloatable(rec('做了')), true)
})

check('空记录不炸', () => {
  assert.equal(isAlive(null), false)
  assert.equal(isFloatable(undefined), false)
})

console.log(`状态判断 ${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
