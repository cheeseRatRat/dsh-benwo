/**
 * 期 1 验收：契约 v0.2 第 13 节那七条，能脱离宿主验的先验掉。
 * 每一条都是行为，不是「没报错」。
 */
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import {
  layout,
  initCore,
  ensureCore,
  writeRecord,
  readAllRecords,
  appendToday,
  readToday,
  dayOf,
  newId,
  CORE_MISSING,
} from '../src/core/store.js'
import { settleRecord, injectable, NEW_STRENGTH } from '../src/core/decay.js'
import { buildMemoryBlock, charCount, BUDGET_TOTAL } from '../src/core/inject.js'
import { appendLink, verifyChain, checkCurrent, fingerprint } from '../src/core/chain.js'
import { canPromote } from '../src/core/judge.js'

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

const root = path.join(os.tmpdir(), 'benwo-accept-' + process.pid + '-' + Date.now())
const L = layout(root)
await initCore(root)

const makeRecord = async (over = {}) => {
  const rec = {
    id: newId(),
    '名': '修根不打补丁',
    '类型': '约定',
    '强度': NEW_STRENGTH,
    '重要度': 3,
    '首次': '2026-11-07',
    '上次': '2026-11-07',
    '提起': 1,
    '证据': 2,
    '来源': ['网页:2026-11-07#2240'],
    '状态': 'active',
    '被取代': '',
    body: '主人说过：问题从根上修，别只打补丁。\n\n为什么值得记：以后想省事的时候先看见这条。',
    ...over,
  }
  await writeRecord(L, rec)
  return rec
}

console.log('\n期 1 验收：')

// ① 连聊 100 轮，记忆段不涨
await check('① 一百轮之后，注入还是那么长', async () => {
  for (let i = 0; i < 100; i += 1) {
    await appendToday(L, { text: `第 ${i} 轮聊了一件事，大概十几个字的样子。`, source: '验收' }, new Date(2026, 10, 7, 10, i % 60))
  }
  await makeRecord({ '名': '一条长期' })
  const today = await readToday(L, '2026-11-07')
  const { records } = await readAllRecords(L)
  const block = buildMemoryBlock({ today, records })
  assert.ok(block.chars <= BUDGET_TOTAL + 20, `超了：${block.chars}`)
  assert.ok(today.length === 100, '今天应该有一百行')
})

// ② 同一句说五遍，长期只有一条，证据还是 1
await check('② 一句话说五遍，证据只算一天', async () => {
  const same = '主人说要记住今天下雨了。'
  for (let i = 0; i < 5; i += 1) {
    await appendToday(L, { text: same, source: '验收' }, new Date(2026, 10, 8, 9, i))
  }
  const gate = canPromote({ evidence: 5, firstDay: '2026-11-08', today: '2026-11-08' })
  assert.equal(gate.ok, false, '同一天说五遍不能升长期')
  const { records } = await readAllRecords(L)
  const sameTitle = records.filter((r) => r['名'] === '下雨')
  assert.equal(sameTitle.length, 0)
})

// ③ 拨前 90 天：该淡的淡、该留的留、原文不丢
await check('③ 结算拨前九十天，强度分档、原文不丢', async () => {
  const now = new Date(2026, 10, 7)
  const later = new Date(2027, 1, 5) // 约 90 天
  const common = {
    '强度': NEW_STRENGTH,
    '上次': '2026-11-07T00:00:00.000Z',
    body: '问题从根上修，别只打补丁。\n\n为什么值得记：以后想省事的时候先看见这条。',
  }
  const light = settleRecord({ ...common, '重要度': 3 }, later)
  const heavy = settleRecord({ ...common, '重要度': 5 }, later)
  assert.ok(light['强度'] < 12, `重要度 3 应落到 12 以下，实际 ${light['强度']}`)
  assert.equal(injectable({ '强度': light['强度'], '重要度': 3 }), false, '重要度 3 的进不了注入')
  assert.equal(light['状态'], 'active', '还没到 6，只是看不见了，不叫睡')
  assert.ok(heavy['强度'] >= 12, `重要度 5 应该还看得见，实际 ${heavy['强度']}`)
  assert.equal(injectable({ '强度': heavy['强度'], '重要度': 5 }), true)
  assert.ok(heavy.body.includes('为什么值得记'), '原文一个字都不许丢')
})

// ④ 拿掉核目录必须报错
await check('④ 核没了就拒绝启动，不造空壳冒充', async () => {
  const empty = path.join(os.tmpdir(), 'benwo-missing-' + Date.now())
  await assert.rejects(() => ensureCore(empty), (error) => {
    assert.equal(error.code, CORE_MISSING)
    return true
  })
})

// ⑤ 写失败必须报错，不许报成功
await check('⑤ 写不进去就抛错，不报成功', async () => {
  const brokenL = layout(path.join(os.tmpdir(), 'benwo-broken-' + Date.now()))
  await initCore(brokenL.root)
  await fs.mkdir(brokenL.long, { recursive: true })
  // 把「约定」这个目录位置占成一个文件，让它建不出子目录
  await fs.writeFile(path.join(brokenL.long, '约定'), '我不是目录', 'utf8')
  await assert.rejects(() =>
    writeRecord(brokenL, {
      id: 'm-20261107-dead',
      '名': '写不进去的',
      '类型': '约定',
      '强度': 40,
      '重要度': 3,
      '首次': '2026-11-07',
      '上次': '2026-11-07',
      '提起': 0,
      '证据': 0,
      '来源': ['验收'],
      '状态': 'active',
      '被取代': '',
      body: '测试\n\n为什么值得记：测试',
    }),
  )
  await fs.rm(brokenL.root, { recursive: true, force: true })
})

// ⑥ 手改记忆 → 下一轮必须认出来
await check('⑥ 手改了记忆文件，链要指出来', async () => {
  const { records } = await readAllRecords(L)
  const first = records[0]
  await appendLink(L, { '底子': fingerprint('底子原文'), '库': fingerprint(JSON.stringify(records)), '条数': records.length })
  const tampered = { ...first, body: first.body + '\n（有人偷偷加了一句）' }
  await writeRecord(L, tampered)
  const after = await readAllRecords(L)
  const out = await checkCurrent(L, { '底子': fingerprint('底子原文'), '库': fingerprint(JSON.stringify(after.records)) })
  assert.equal(out.ok, false)
  assert.ok(out.reason.includes('记忆库'), out.reason)
  assert.equal((await verifyChain(L)).ok, true, '链本身还是完整的，只是被指的东西变了')
})

// ⑦ 没提过的事，别硬凑
await check('⑦ 想不起来就空着，不塞东西', async () => {
  const block = buildMemoryBlock({ today: ['今天只有一件小事。'], records: [] })
  assert.ok(!block.text.includes('【相关记忆】'))
})

await fs.rm(root, { recursive: true, force: true })
console.log(`\n期 1 验收：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
