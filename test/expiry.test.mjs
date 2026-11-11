/**
 * B2「有效到」+ 时间解析统一（2026-11-09 夜）。
 *
 * 治两件事：
 *   ① 「重要度 5 永久占名额」：半衰期 70 天，40 掉到 6 要 190 天，这期间一直挤在浮上名单里。
 *      加 `有效到` 之后，到期不再主动晃——但不删、能被召回、面板可见（跟「沉底」同一个哲学）。
 *   ② `首次` 存日期、`上次` 存完整 ISO，跨时区比较差 8 小时，会算出「上次早于首次」这种假异常。
 */
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { layout, writeRecord, readAllRecords } from '../src/core/store.js'
import { injectable, expired, daysBetween, parseTime, dayText } from '../src/core/decay.js'

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

const rec = (over = {}) => ({
  id: 'm-20261109-0001',
  '名': '测试',
  '类型': '约定',
  '强度': 60,
  '重要度': 5,
  '首次': '2026-11-09T00:00:00.000Z',
  '上次': '2026-11-09T00:00:00.000Z',
  '提起': 0,
  '证据': 1,
  '来源': ['网页'],
  '状态': 'active',
  '被取代': '',
  '有效到': '',
  body: '看见了什么：测试。\n\n为什么值得记：测试。',
  ...over,
})

const now = new Date('2026-11-10T12:00:00+08:00')

await check('纯日期按本地零点算，不按 UTC', () => {
  // 以前 new Date('2026-11-09') 是 UTC 零点＝本地 08:00，跟完整 ISO 一比就差 8 小时
  assert.equal(parseTime('2026-11-09'), new Date('2026-11-09T00:00:00').getTime())
  assert.ok(daysBetween('2026-11-09', '2026-11-09T03:03:00+08:00') >= 0, '不该出现「上次早于首次」')
  const half = daysBetween('2026-11-09T00:00:00+08:00', '2026-11-09T12:00:00+08:00')
  assert.ok(Math.abs(half - 0.5) < 0.01, `半天该是 0.5 天，实际 ${half}`)
})

await check('dayText 给本地日期', () => {
  assert.equal(dayText(new Date('2026-11-10T00:30:00+08:00')), '2026-11-10')
})

await check('到期的不进注入', () => {
  assert.equal(expired(rec({ '有效到': '2026-11-01' }), now), true)
  assert.equal(injectable(rec({ '有效到': '2026-11-01' }), now), false)
})

await check('没填有效到的当作长期有效', () => {
  assert.equal(expired(rec(), now), false)
  assert.equal(injectable(rec(), now), true)
})

await check('还没到期的照常进注入', () => {
  assert.equal(expired(rec({ '有效到': '2026-12-01' }), now), false)
  assert.equal(injectable(rec({ '有效到': '2026-12-01' }), now), true)
})

await check('到期当天还算有效，第二天才不算', () => {
  const r = rec({ '有效到': '2026-11-10' })
  assert.equal(injectable(r, new Date('2026-11-10T23:59:00+08:00')), true)
  assert.equal(injectable(r, new Date('2026-11-11T00:01:00+08:00')), false)
})

await check('到期的照样能被召回（只不主动晃，不是删）', async () => {
  const { recall } = await import('../src/core/recall.js')
  const hits = recall({ records: [rec({ '有效到': '2026-11-01', '名': '旧约定', body: '旧约定\n\n为什么值得记：测试。' })], query: '旧约定', now })
  assert.ok(hits.some((h) => h.record.id === 'm-20261109-0001'), '召回不看有效到')
})

await check('filter 不许把索引当 now 传（那样到期永远失效）', () => {
  const list = [rec({ '有效到': '2026-11-01', '强度': 90 })]
  // 正确写法：包一层
  assert.equal(list.filter((r) => injectable(r, now)).length, 0)
  // 错误写法会把 0 当 now → dayText(0) = 1970，判断永远不生效
  assert.equal(list.filter(injectable).length, 1, '这就是为什么源码里必须包一层箭头函数')
})

// ---- FM_KEYS 是白名单，漏加就静默丢数据。存→读往返必须验。
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'benwo-expiry-'))
const L = layout(tmp)
await fsp.mkdir(L.long, { recursive: true })

await check('存→读往返：有效到不许被白名单吃掉', async () => {
  await writeRecord(L, rec({ '有效到': '2026-12-31' }))
  const { records } = await readAllRecords(L)
  assert.equal(records.length, 1)
  assert.equal(records[0]['有效到'], '2026-12-31', '白名单漏了字段 → 静默丢数据')
})

await check('空值读回来是空串，不变成 undefined', async () => {
  // 老文件里 `被取代: ` 本来就是空行写法，保持一致：空值照样写、照样读回空串。
  await writeRecord(L, rec({ id: 'm-20261109-0002', '有效到': '' }))
  const { records } = await readAllRecords(L)
  const found = records.find((r) => r.id === 'm-20261109-0002')
  assert.ok(found, '没读回来')
  assert.equal(found['有效到'], '', '空值也要有字段，别变 undefined')
})

await fsp.rm(tmp, { recursive: true, force: true })

console.log(`有效到期 ${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
