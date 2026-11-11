/**
 * 共同经历（C2，2026-11-09 夜）。
 *
 * 治的是「58 条事件平铺，没有脉络」。按月把事件排成一行一条。
 * 三条硬规矩要锁住：
 *   ① 纯机械，不调模型
 *   ② **不进注入**（只做「问得起来就能查」）
 *   ③ 只收「事件」——约定是规矩、偏好是口味，不属于「做过什么」
 */
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { layout } from '../src/core/store.js'
import { pickMonth, renderMonth, readJourneyMonth, monthsOf, monthOf, rebuildJourneyMonth } from '../src/core/journey.js'

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

const ev = (id, day, name, kind = '事件', status = 'active') => ({
  id,
  '名': name,
  '类型': kind,
  '状态': status,
  '首次': day,
  body: name,
})

const RECORDS = [
  ev('m-a', '2026-10-20', '不忘的第一夜'),
  ev('m-b', '2026-10-21', '凌晨三点把小鲸鱼钉住'),
  ev('m-c', '2026-10-22T03:00:00.000Z', '不忘 0.1.6 外审三处'),
  ev('m-d', '2026-11-08', '核做成了：能跑能搬能备份'),
  ev('m-e', '2026-10-23', '一个约定', '约定'),
  ev('m-f', '2026-10-24', '一个偏好', '偏好'),
  ev('m-g', '2026-10-25', '被取代的老事', '事件', '被取代'),
]

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'benwo-journey-'))
const L = layout(tmp)
await fsp.mkdir(L.journey, { recursive: true })

await check('monthOf 能吃纯日期，也能吃完整 ISO', () => {
  assert.equal(monthOf({ '首次': '2026-10-20' }), '2026-10')
  assert.equal(monthOf({ '首次': '2026-10-22T03:00:00.000Z' }), '2026-10')
  assert.equal(monthOf({ '首次': '' }), '')
})

await check('只收事件：约定、偏好、被取代的都不进', () => {
  const items = pickMonth(RECORDS, '2026-10')
  const ids = items.map((x) => x.id)
  assert.ok(ids.includes('m-a'))
  assert.ok(ids.includes('m-c'), '完整 ISO 的也要进')
  assert.ok(!ids.includes('m-e'), '约定不该进「做过什么」')
  assert.ok(!ids.includes('m-f'), '偏好不该进')
  assert.ok(!ids.includes('m-g'), '被取代的不该进')
})

await check('按日期排好，一行一条，带「月.日」', () => {
  const items = pickMonth(RECORDS, '2026-10')
  const text = renderMonth('2026-10', items)
  assert.match(text, /^# 2026-10 · 我们一起做过的事/)
  assert.ok(text.includes('- 10.20 不忘的第一夜'), text)
  const i20 = text.indexOf('10.20')
  const i21 = text.indexOf('10.21')
  assert.ok(i20 < i21, '要按日期排')
  assert.equal(text.trim().split('\n').filter((l) => l.startsWith('- ')).length, 3)
})

await check('没有事件的月份不留白：写一句「没有」而不是空文件', () => {
  const text = renderMonth('2026-09', [])
  assert.match(text, /没有记下/)
})

await check('月份列表从记忆推，不从磁盘推', () => {
  assert.deepEqual(monthsOf(RECORDS), ['2026-10', '2026-11'])
})

await check('懒生成：第一次读就写文件，第二次读不重写', async () => {
  const first = await readJourneyMonth(L, '2026-10', RECORDS)
  assert.equal(first.generated, true)
  assert.ok(fs.existsSync(path.join(L.journey, '2026-10.md')))
  const second = await readJourneyMonth(L, '2026-10', RECORDS)
  assert.equal(second.generated, false, '已经有文件了就不该重写')
  assert.equal(second.text, first.text)
})

await check('记忆变了可以重建（幂等：同样的料排出来一样）', async () => {
  const more = RECORDS.concat([ev('m-h', '2026-10-30', '月底又出了一件事')])
  const rebuilt = await rebuildJourneyMonth(L, '2026-10', more)
  assert.equal(rebuilt.items.length, 4)
  const again = await rebuildJourneyMonth(L, '2026-10', more)
  assert.equal(again.text, rebuilt.text)
})

await check('**不进注入**：journey 不许出现在 buildMemoryBlock 里', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const injectSrc = fs.readFileSync(path.resolve(here, '..', 'src', 'core', 'inject.js'), 'utf8')
  assert.ok(!/journey/i.test(injectSrc), '注入层不该认识 journey——它只做「问起来就查」')
  const indexSrc = fs.readFileSync(path.resolve(here, '..', 'index.js'), 'utf8')
  const memStart = indexSrc.indexOf('buildMemoryBlock({')
  const memCall = indexSrc.slice(memStart, indexSrc.indexOf('\n    })', memStart) + 1)
  assert.ok(!/journey/i.test(memCall), '共同经历不许进记忆段')
})

await fsp.rm(tmp, { recursive: true, force: true })

console.log(`共同经历 ${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
