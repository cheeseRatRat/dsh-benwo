/**
 * 计划 / 预期的状态机（2026-11-10 夜）。
 *
 * 规则（主人定的）：
 *   计划做完 → 状态「已完成」+ 完成日期；**完成满 30 天，结算时自动清掉**
 *   计划不做了 → 状态「作罢」（留着，翻得到「当时为什么没做」）
 *   预期做了 → 状态「做了」，**永不删**
 *   其余类型永不删，只能淡或被取代
 *
 * 已完成的、作罢的不再浮上来，但还在盘上。
 */
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { injectable, DONE_STATUS, settleRecord } from '../src/core/decay.js'
import { recall } from '../src/core/recall.js'
import { layout, writeRecord, readAllRecords } from '../src/core/store.js'

let passed = 0
let failed = 0
const check = async (name, fn) => {
  try {
    await fn()
    passed += 1
  } catch (error) {
    failed += 1
    console.error('FAIL', name, '—', error.message)
  }
}

const rec = (id, kind, status, extra = {}) => ({
  id,
  '名': id,
  '别名': [],
  '类型': kind,
  '强度': 80,
  '重要度': 4,
  '首次': '2026-11-01',
  '上次': '2026-11-01',
  '提起': 0,
  '证据': 1,
  '整理': '',
  '来源': ['测试'],
  '状态': status,
  '被取代': '',
  '有效到': '',
  '计划': '',
  '完成': '',
  ...extra,
  body: id + '\n\n为什么值得记：测试。\n',
})

const NOW = new Date('2026-11-10T12:00:00+08:00')

await check('三种状态记在名单里：被取代 / 已完成 / 作罢', () => {
  assert.ok(DONE_STATUS.has('被取代'))
  assert.ok(DONE_STATUS.has('已完成'))
  assert.ok(DONE_STATUS.has('作罢'))
  assert.ok(!DONE_STATUS.has('做了'), '「做了」不该被挡——那是愿望实现了')
})

await check('已完成的计划不再浮上来', () => {
  assert.equal(injectable(rec('p1', '计划', '已完成'), NOW), false)
})

await check('作罢的计划也不再浮', () => {
  assert.equal(injectable(rec('p2', '计划', '作罢'), NOW), false)
})

await check('预期做了的还留着（永不删）', () => {
  assert.equal(injectable(rec('x1', '预期', '做了'), NOW), true)
})

await check('正常状态照旧能浮', () => {
  assert.equal(injectable(rec('p3', '计划', 'active'), NOW), true)
})

await check('召回也不带已完成的 / 作罢的', () => {
  const records = [
    rec('a', '事件', 'active'),
    rec('b', '事件', '已完成'),
    rec('c', '事件', '作罢'),
  ]
  const hits = recall({ records, query: 'a b c', now: NOW, limit: 5 })
  const ids = hits.map((h) => h.record.id)
  assert.deepEqual(ids, ['a'], '只该剩正常状态那条：' + ids.join(','))
})

await check('盘上存得住「计划」「完成」两个字段', async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'benwo-plan-'))
  const L = layout(tmp)
  await fsp.mkdir(L.long, { recursive: true })
  const saved = rec('p9', '计划', '已完成', {
    '计划': '2026-11-13',
    '完成': '2026-11-13 · 电费交了',
  })
  await writeRecord(L, saved)
  const { records } = await readAllRecords(L)
  const back = records.find((r) => r.id === 'p9')
  assert.equal(back['计划'], '2026-11-13')
  assert.equal(back['完成'], '2026-11-13 · 电费交了')
  assert.equal(back['状态'], '已完成')
  await fsp.rm(tmp, { recursive: true, force: true })
})

await check('完成满 30 天的判据（date 差）', () => {
  const days = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000)
  assert.equal(days('2026-11-13', '2026-12-13'), 30, '满 30 天该清')
  assert.equal(days('2026-11-13', '2026-12-12'), 29, '29 天还不清')
})

/**
 * 2026-11-12 回归：结算把「已完成」冲回 active。
 *
 * 11-09 那次只保护了「被取代」，其余 DONE_STATUS 会被 settleRecord 重算回 active。
 * 真实现象：计划标完成后点「结算一下」，状态变回 active，【要办的事】继续挂着它。
 */
await check('结算不会把「已完成」冲回 active', () => {
  const done = rec('p4', '计划', '已完成', { '计划': '', '完成': '2026-11-12 · 交了' })
  const settled = settleRecord(done, new Date('2026-12-20T12:00:00+08:00'))
  assert.equal(settled['状态'], '已完成', '完成后结算，状态必须保留')
  assert.ok(Number(settled['强度']) < 80, '强度照常淡（不该被冻结）')
})

await check('结算也不会把「作罢 / 已内化」冲掉', () => {
  for (const st of ['作罢', '已内化']) {
    const settled = settleRecord(rec('r1', '要求', st), new Date('2026-12-20T12:00:00+08:00'))
    assert.equal(settled['状态'], st, st + ' 被结算改了')
  }
})

console.log(`计划与预期状态 ${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
