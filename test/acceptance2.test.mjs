/**
 * 期 2 验收：召回和整理。
 * 契约 v0.2 第 7、8 节。跟期 1 一样，验的是行为，不是「没报错」。
 */
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { layout, initCore, writeRecord, readAllRecords, newId } from '../src/core/store.js'
import { recall, REL_MIN } from '../src/core/recall.js'
import {
  shouldOrganize,
  organizeWeight,
  mergeDuplicates,
  applyMerges,
  buildReflection,
  markOrganized,
  ORGANIZE_THRESHOLD,
  ORGANIZE_MAX_PER_DAY,
} from '../src/core/organize.js'

let passed = 0
let failed = 0
const check = async (name, fn) => {
  try {
    await fn()
    passed += 1
    console.log('  ✓ ' + name)
  } catch (error) {
    failed += 1
    console.error('  ✗ ' + name + ' — ' + error.message)
  }
}

const root = path.join(os.tmpdir(), 'benwo-accept2-' + process.pid + '-' + Date.now())
const L = layout(root)
await initCore(root)

const put = (over = {}) => {
  const record = {
    id: newId(),
    '名': '修根不打补丁',
    '类型': '约定',
    '强度': 60,
    '重要度': 4,
    '首次': '2026-11-07',
    '上次': '2026-11-07',
    '提起': 1,
    '证据': 2,
    '整理': '',
    '来源': ['网页'],
    '状态': 'active',
    '被取代': '',
    body: '问题从根上修，别只打补丁。\n\n为什么值得记：以后想省事打补丁的时候先看见这条。',
    ...over,
  }
  return writeRecord(L, record).then(() => record)
}

console.log('\n期 2 验收：')

await check('① 问「修根那事」能捞出来', async () => {
  await put()
  await put({ '名': '喜欢大白饭', '类型': '偏好', body: '主人喜欢大白饭。\n\n为什么值得记：点菜时用得上。', '重要度': 3 })
  const { records } = await readAllRecords(L)
  const out = recall({ records, query: '上次说的修根是啥来着' })
  assert.ok(out.length >= 1, '一条都没捞到')
  assert.equal(out[0].record['名'], '修根不打补丁')
})

await check('② 问没提过的事，不冒充命中（给弱候选并标 weak）', async () => {
  const { records } = await readAllRecords(L)
  const out = recall({ records, query: '明天股票怎么走' })
  // 2026-11-09 契约变更：以前这里是「空着」，现在给最多两条弱候选，
  // 但**必须标 weak**，由调用方在注入里明说「不确定」。
  // 空着会让模型以为「根本不知道有这回事」，那是另一种撒谎。
  assert.ok(out.every((hit) => hit.weak === true), '没过线的必须标 weak')
  assert.ok(out.every((hit) => hit.rel < REL_MIN), '弱候选不该过相关度门槛')
})

await check('③ 攒够 25 才整理', async () => {
  const low = Array.from({ length: 3 }, () => ({ id: 'x', '重要度': 3, '状态': 'active', '整理': '' }))
  assert.equal(shouldOrganize(low).ok, false)
  const full = Array.from({ length: 5 }, () => ({ id: 'y', '重要度': 5, '状态': 'active', '整理': '' }))
  assert.equal(shouldOrganize(full).ok, true)
  assert.equal(organizeWeight(full), ORGANIZE_THRESHOLD)
})

await check('④ 一天最多两次', async () => {
  const full = Array.from({ length: 5 }, () => ({ id: 'y', '重要度': 5, '状态': 'active', '整理': '' }))
  assert.equal(shouldOrganize(full, ORGANIZE_MAX_PER_DAY).ok, false)
})

await check('⑤ 反思带证据编号和绝对日期', async () => {
  const batch = [
    { id: 'm-aaa', '名': '修根', '重要度': 5, '证据': 2, '状态': 'active', '整理': '', body: 'x' },
    { id: 'm-bbb', '名': '大白饭', '重要度': 4, '证据': 1, '状态': 'active', '整理': '', body: 'y' },
  ]
  const { text, evidence } = buildReflection(batch, new Date('2026-11-07T13:00:00Z'))
  assert.ok(text.includes('2026-11-07'), text)
  assert.ok(text.includes('m-aaa') && text.includes('m-bbb'))
  assert.deepEqual(evidence, ['m-aaa', 'm-bbb'])
})

await check('⑥ 几乎一样的合成一条，旧的标被取代、正文不改', async () => {
  const a = { id: 'm-dup-a', '名': '修根不打补丁', '重要度': 4, '证据': 2, '强度': 60, '状态': 'active', '整理': '', '被取代': '', body: '问题从根上修，别只打补丁。\n\n为什么值得记：测试。' }
  const b = { id: 'm-dup-b', '名': '修根不打补丁', '重要度': 4, '证据': 1, '强度': 50, '状态': 'active', '整理': '', '被取代': '', body: '问题从根上修，别只打补丁。\n\n为什么值得记：测试。' }
  const { survivorOf, replaced } = mergeDuplicates([a, b])
  assert.equal(replaced.length, 1)
  const after = applyMerges([a, b], survivorOf)
  const dead = after.find((r) => r.id === 'm-dup-b')
  assert.equal(dead['状态'], '被取代')
  assert.equal(dead.body, b.body, '正文一个字都不许动')
})

await check('⑦ 整理完权重归零，不会原地打转', async () => {
  const batch = Array.from({ length: 5 }, (_, i) => ({
    id: 'm' + i,
    '名': '东西' + i,
    '重要度': 5,
    '证据': 1,
    '状态': 'active',
    '整理': '',
    '被取代': '',
    body: `第 ${i} 件不同的事，内容要不一样才算数。\n\n为什么值得记：测试。`,
  }))
  const { evidence } = buildReflection(batch, new Date('2026-11-07T13:00:00Z'))
  assert.equal(evidence.length, 3, '一次最多反思三条，别一次吞掉一锅')
  const after = markOrganized(batch, evidence)
  assert.ok(organizeWeight(after) < ORGANIZE_THRESHOLD, '整理完该降下来')
})

await fs.rm(root, { recursive: true, force: true })
console.log(`\n期 2 验收：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
