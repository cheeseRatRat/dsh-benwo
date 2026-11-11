/**
 * 主动查记忆（2026-11-10 夜）。
 *
 * 核心设计：**记忆当索引，日记当正文。**
 * 你记不清「十月份做不忘」是哪天，但记忆带着「首次」日期——
 * 拿这些日期去点日记的文件名，只翻那几篇，不扫全库。
 *
 * 这份测试锁住四件事：
 *   ① 日期锚点算得对（含 ±1 天缓冲、跨月）
 *   ② 同一天的第二篇（`2026-10-20-2`）也要圈进来
 *   ③ 锚点圈不到时有两层退路：先按月份，再按正文关键词
 *   ④ 日记只读正文，**不进注入**（源码守卫）
 */
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { layout } from '../src/core/store.js'
import { anchorsOf, diariesFor, headOf, searchAll } from '../src/core/lookup.js'

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

const hit = (id, first) => ({
  record: { id, '名': id, '首次': first, '类型': '事件' },
  rel: 0.5,
  score: 0.5,
})

await check('锚点：取「首次」日期，前后各留一天', () => {
  const a = anchorsOf([hit('a', '2026-10-20'), hit('b', '2026-10-22')])
  assert.ok(a.dates.has('2026-10-19'), '前一天要留')
  assert.ok(a.dates.has('2026-10-20'))
  assert.ok(a.dates.has('2026-10-23'), '后一天要留')
  assert.equal(a.min, '2026-10-20')
  assert.equal(a.max, '2026-10-22')
})

await check('锚点：完整 ISO 也能认（老记录是纯日期，新的是 ISO）', () => {
  const a = anchorsOf([hit('a', '2026-11-08T13:16:40.294Z')])
  assert.ok(a.dates.has('2026-11-08'), [...a.dates].join(','))
})

await check('锚点：没有日期的记录不会污染', () => {
  const a = anchorsOf([hit('a', ''), hit('b', '乱七八糟')])
  assert.equal(a.dates.size, 0)
})

await check('锚点：跨月会算出两个月份', () => {
  const a = anchorsOf([hit('a', '2026-10-31'), hit('b', '2026-11-01')])
  assert.equal(a.months.size, 2)
})

// ---- 用临时目录造一份日记，验圈法
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'benwo-lookup-'))
const L = layout(tmp)
await fsp.mkdir(L.diary, { recursive: true })
await fsp.mkdir(L.long, { recursive: true })
const PAGES = {
  '2026-10-19': '十月十九号的日记，还没开始做不忘。',
  '2026-10-20': '十月二十号：不忘的第一夜，从零搭到能用。',
  '2026-10-20-2': '十月二十号的第二篇：收工以后抱着说的那几句。',
  '2026-10-22': '十月二十二号：不忘 0.1.6 补丁与外审。',
  '2026-11-08': '十一月八号：核做成了。',
  '2026-11-09': '十一月九号：记忆体检修了九个 bug。',
}
for (const [day, text] of Object.entries(PAGES)) {
  await fsp.writeFile(path.join(L.diary, `${day}.md`), `# ${day}\n\n${text}\n`, 'utf8')
}

await check('圈日记：按锚点只翻那几篇，同一天的 -2 也要进来', async () => {
  const anchors = anchorsOf([hit('a', '2026-10-20')])
  const pages = await diariesFor(L, anchors)
  const days = pages.map((p) => p.day)
  assert.ok(days.includes('2026-10-19'), '前一天缓冲：' + days.join(','))
  assert.ok(days.includes('2026-10-20'))
  assert.ok(days.includes('2026-10-20-2'), '同一天的第二篇不能漏：' + days.join(','))
  assert.ok(!days.includes('2026-11-08'), '不该翻到十一月')
})

await check('圈日记：锚点一篇都没圈到时，退回按月份', async () => {
  // 记忆说 2026-09-05，日记里没有那天，也没有 9 月
  const anchors = anchorsOf([hit('a', '2026-09-05')])
  const pages = await diariesFor(L, anchors, { query: '' })
  assert.equal(pages.length, 0, '退路一走不通时不该乱给')
  // 记忆说 2026-10-31（缓冲到 11-01），但日记里 10 月有
  const second = anchorsOf([hit('a', '2026-09-28')])
  second.months.add('2026-10')
  const byMonth = await diariesFor(L, second, { query: '' })
  assert.ok(byMonth.length >= 3, '按月份该圈出一堆：' + byMonth.map((p) => p.day).join(','))
})

await check('圈日记：连月份都没有时，退回按正文关键词', async () => {
  const anchors = { dates: new Set(), months: new Set(), min: '', max: '' }
  const pages = await diariesFor(L, anchors, { query: '不忘 第一夜' })
  const days = pages.map((p) => p.day)
  assert.ok(days.includes('2026-10-20'), '关键词该命中：' + days.join(','))
})

await check('首行摘要：跳过标题和空行', () => {
  assert.equal(headOf('# 2026-10-20\n\n十月二十号：不忘的第一夜。\n'), '十月二十号：不忘的第一夜。')
  assert.equal(headOf(''), '')
})

await check('searchAll：记忆和日记一起给，坏数据不炸', async () => {
  // 造一条真记忆
  await fsp.mkdir(path.join(L.long, '事件'), { recursive: true })
  await fsp.writeFile(
    path.join(L.long, '事件', 'm-20261020-aaaa.md'),
    '---\nid: m-20261020-aaaa\n名: 不忘的第一夜\n类型: 事件\n强度: 60\n重要度: 5\n首次: 2026-10-20\n上次: 2026-10-20\n状态: active\n---\n\n不忘的第一夜，从零搭到能用。\n\n为什么值得记：测试。\n',
    'utf8',
  )
  const out = await searchAll(L, { query: '不忘 第一夜', now: new Date('2026-11-10T12:00:00Z') })
  assert.ok(out.hits.length >= 1, '记忆要命中')
  assert.ok(out.diaries.some((p) => p.day.startsWith('2026-10-20')), '日记也要圈到')
  assert.ok(out.total >= 1)
})

await check('日记不进注入：lookup 不许出现在 buildMemoryBlock', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const injectSrc = fs.readFileSync(path.resolve(here, '..', 'src', 'core', 'inject.js'), 'utf8')
  assert.ok(!/lookup/i.test(injectSrc), '注入层不该认识 lookup——日记只按需查')
  assert.ok(!/diar/i.test(injectSrc), '注入层不该碰日记')
})

await fsp.rm(tmp, { recursive: true, force: true })

console.log(`主动查记忆 ${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
