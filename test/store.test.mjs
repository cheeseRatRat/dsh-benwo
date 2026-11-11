import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import {
  layout,
  initCore,
  ensureCore,
  readState,
  writeState,
  serializeRecord,
  parseRecord,
  writeRecord,
  readAllRecords,
  appendToday,
  readToday,
  withLock,
  newId,
  looksSecret,
  dayOf,
  CORE_MISSING,
} from '../src/core/store.js'

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

const root = path.join(os.tmpdir(), 'benwo-test-' + process.pid + '-' + Date.now())
const L = layout(root)

const sample = (over = {}) => ({
  id: 'm-20261107-abcd',
  '类型': '约定',
  '强度': 72,
  '首次': '2026-11-07',
  '上次': '2026-11-07',
  '提起': 3,
  '证据': 2,
  '来源': ['day:2026-11-07#1430', 'day:2026-11-05#0910'],
  '状态': 'active',
  body: '主人让咱别为钱畏手畏脚，该干的活别缩水。',
  ...over,
})

await check('没初始化就启动，必须拒绝', async () => {
  await assert.rejects(() => ensureCore(root), (error) => {
    assert.equal(error.code, CORE_MISSING)
    assert.ok(error.message.includes('拒绝启动'))
    return true
  })
})

await check('initCore 建出三个必需文件', async () => {
  await initCore(root)
  for (const file of [L.foundation, L.editable, L.state]) {
    await fs.access(file)
  }
})

await check('initCore 之后能启动', async () => {
  const got = await ensureCore(root)
  assert.equal(got.root, root)
})

await check('initCore 不覆盖已有的底子', async () => {
  await fs.writeFile(L.foundation, '# 我自己写的底子\n', 'utf8')
  await initCore(root)
  assert.equal((await fs.readFile(L.foundation, 'utf8')).trim(), '# 我自己写的底子')
})

await check('状态能存能读', async () => {
  const state = { schema: 1, lastSettle: '2026-11-07T00:00:00.000Z', pending: false, degraded: false }
  await writeState(L, state)
  const back = await readState(L)
  assert.equal(back.lastSettle, state.lastSettle)
  assert.equal(back.schema, 1)
})

await check('状态版本不符要报错', async () => {
  await fs.writeFile(L.state, JSON.stringify({ schema: 99 }), 'utf8')
  await assert.rejects(() => readState(L), (error) => error.code === 'SCHEMA_MISMATCH')
  await writeState(L, { schema: 1, lastSettle: '2026-11-07T00:00:00.000Z', pending: false, degraded: false })
})

await check('记录序列化再解析，字段不丢', async () => {
  const record = sample()
  const text = serializeRecord(record)
  const { meta, body } = parseRecord(text)
  assert.equal(meta.id, record.id)
  assert.equal(meta['类型'], '约定')
  assert.equal(meta['强度'], 72)
  assert.equal(meta['提起'], 3)
  assert.deepEqual(meta['来源'], record['来源'])
  assert.equal(body, record.body)
})

await check('没有 front matter 要报错，不猜', async () => {
  assert.throws(() => parseRecord('就是一段普通文字'), (error) => error.code === 'BAD_RECORD')
})

await check('写进去能读回来，路径按类型分目录', async () => {
  const file = await writeRecord(L, sample())
  assert.ok(file.includes('约定'), file)
  assert.ok(file.endsWith('m-20261107-abcd.md'), file)
  await fs.access(file)
})

await check('多类型一起读得全', async () => {
  await writeRecord(L, sample({ id: 'm-20261107-0002', '类型': '偏好', body: '喜欢大白饭。' }))
  await writeRecord(L, sample({ id: 'm-20261107-0003', '类型': '事件', body: '把核的骨架搭起来了。' }))
  const { records, broken } = await readAllRecords(L)
  assert.equal(broken.length, 0, '不该有坏文件')
  assert.equal(records.length, 3)
  const kinds = records.map((r) => r['类型']).sort()
  assert.deepEqual(kinds, ['事件', '偏好', '约定'])
})

await check('坏文件不拖垮整次读取', async () => {
  await fs.mkdir(path.join(L.long, '事实'), { recursive: true })
  await fs.writeFile(path.join(L.long, '事实', 'broken.md'), '没有头部的文件', 'utf8')
  const { records, broken } = await readAllRecords(L)
  assert.equal(records.length, 3, '好的三条还在')
  assert.equal(broken.length, 1, '坏的被单独列出来')
})

await check('今天写两笔就是两行', async () => {
  const day = new Date('2026-11-07T14:30:00')
  await appendToday(L, { text: '第一件事', source: '网页' }, day)
  await appendToday(L, { text: '第二件事', source: 'QQ' }, new Date('2026-11-07T15:02:00'))
  const lines = await readToday(L, '2026-11-07')
  assert.equal(lines.length, 2)
  assert.ok(lines[0].includes('14:30'))
  assert.ok(lines[0].includes('第一件事'))
  assert.ok(lines[1].includes('QQ'))
})

await check('没写的日期读出来是空数组，不是报错', async () => {
  assert.deepEqual(await readToday(L, '2000-01-01'), [])
})

await check('并发写今天，一行都不丢', async () => {
  const day = new Date('2026-11-08T09:00:00')
  await Promise.all(
    Array.from({ length: 20 }, (_, i) => appendToday(L, { text: `并发第 ${i} 笔`, source: '测试' }, day)),
  )
  const lines = await readToday(L, '2026-11-08')
  assert.equal(lines.length, 20, `实际只有 ${lines.length} 行`)
})

await check('withLock 真的排队', async () => {
  let running = 0
  let peak = 0
  const task = () => withLock('probe', async () => {
    running += 1
    peak = Math.max(peak, running)
    await new Promise((r) => setTimeout(r, 5))
    running -= 1
  })
  await Promise.all(Array.from({ length: 6 }, task))
  assert.equal(peak, 1, '同一把锁上不该有两个同时在跑')
})

await check('一个任务炸了，后面的照样跑', async () => {
  await withLock('probe', async () => { throw new Error('故意的') }).catch(() => {})
  const ok = await withLock('probe', async () => '好')
  assert.equal(ok, '好')
})

await check('id 形状固定', () => {
  const id = newId(new Date('2026-11-07T00:00:00'))
  assert.match(id, /^m-20261107-[0-9a-f]{4}$/)
})

await check('密钥认得出来', () => {
  assert.equal(looksSecret('sk-abcdefghijklmnopqrstuvwx'), true)
  assert.equal(looksSecret('ghp_' + 'a'.repeat(30)), true)
  assert.equal(looksSecret('主人说喜欢大白饭'), false)
  assert.equal(looksSecret('这段代码里没有密钥，只是一句注释'), false)
})

await check('dayOf 不补零错位', () => {
  assert.equal(dayOf(new Date('2026-01-02T03:04:05')), '2026-01-02')
})

await fs.rm(root, { recursive: true, force: true })
console.log(`\n磁盘层测试：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
