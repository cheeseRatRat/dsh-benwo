/**
 * 「今天」层结构化（A4，2026-11-09）。
 *
 * 以前今天只有一行纯文本：类型、重要度、id 全丢。
 * 后果：不能召回、不能排序，升长期时还得把当时的判断重打一遍。
 *
 * 现在同一件事写两份：
 *   .md   —— 人读的流水，格式**一个字不改**（老文件照旧能读）
 *   .jsonl—— 机器读的结构
 *
 * 这个测试同时锁住两件事：结构化能读、老文件不会读不出来。
 */
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { layout, appendToday, readToday, readTodayEntries, readTodayWindow, readLastSession, summarizeToday, dayOf } from '../src/core/store.js'
import { buildLast, buildMemoryBlock } from '../src/core/inject.js'

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

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'benwo-today-'))
const L = layout(tmp)
await fs.mkdir(L.today, { recursive: true })
const now = new Date('2026-11-09T20:30:00+08:00')
const day = dayOf(now)

await check('结构化条目：类型/重要度/id 都存下来了', async () => {
  await appendToday(
    L,
    {
      id: 'm-test-1',
      name: '测试条目',
      kind: '约定',
      importance: 4,
      text: '看见了什么：这是一条测试。',
      source: '网页',
    },
    now,
  )
  const entries = await readTodayEntries(L, day)
  assert.equal(entries.length, 1)
  const entry = entries[0]
  assert.equal(entry.id, 'm-test-1')
  assert.equal(entry['类型'], '约定')
  assert.equal(entry['重要度'], 4)
  assert.equal(entry['名'], '测试条目')
  assert.match(entry.text, /测试/)
})

await check('.md 流水一个字没变（人还能直接读）', async () => {
  const lines = await readToday(L, day)
  assert.equal(lines.length, 1)
  assert.match(lines[0], /^\d{2}:\d{2} 看见了什么：这是一条测试。/)
  assert.match(lines[0], /〔网页〕$/)
})

await check('旁路是 jsonl，一行一条', async () => {
  await appendToday(L, { id: 'm-test-2', name: '第二条', kind: '事件', importance: 3, text: '看见了什么：第二条。', source: '网页' }, now)
  const raw = await fs.readFile(path.join(L.today, `${day}.jsonl`), 'utf8')
  const lines = raw.split('\n').filter(Boolean)
  assert.equal(lines.length, 2)
  for (const line of lines) JSON.parse(line) // 每行都得是合法 JSON
})

await check('老文件（只有 .md、没有 .jsonl）照样读得出来', async () => {
  const legacyDay = '2026-11-01'
  await fs.writeFile(
    path.join(L.today, `${legacyDay}.md`),
    `# ${legacyDay}\n\n- 22:48 主人定下：先把壳造好。　〔网页〕\n`,
    'utf8',
  )
  const entries = await readTodayEntries(L, legacyDay)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].legacy, true)
  assert.equal(entries[0].hhmm, '22:48')
  assert.match(entries[0].text, /先把壳造好/)
  // 老的本来就没存类型/重要度，退回时是空——那不叫丢，因为从来没有过
  assert.equal(entries[0]['类型'], '')
  assert.equal(entries[0]['重要度'], null)
})

await check('坏 JSON 行不把整天读垮', async () => {
  const brokenDay = '2026-11-02'
  await fs.writeFile(path.join(L.today, `${brokenDay}.md`), `# ${brokenDay}\n\n- 09:00 一条正常。　〔网页〕\n`, 'utf8')
  await fs.writeFile(
    path.join(L.today, `${brokenDay}.jsonl`),
    '{"id":"ok","text":"好的"}\n这不是 JSON\n{"id":"ok2","text":"也好"}\n',
    'utf8',
  )
  const entries = await readTodayEntries(L, brokenDay)
  assert.equal(entries.length, 2, '坏行跳过，好行留下')
})

await check('没有这一天：返回空，不抛', async () => {
  const out = await readTodayEntries(L, '2026-01-01')
  assert.deepEqual(out, [])
})

await check('正文里的换行折成空格：今天必须一行一条', async () => {
  // 2026-11-09 自查踩到的：谁把多段正文塞进 text，.md 就被撑成多行，
  // 续行不以「- 」开头 → readToday 看不见 → 人翻开流水只看到前半句。
  const day = '2026-11-05'
  const now = new Date(`${day}T12:00:00+08:00`)
  await appendToday(
    L,
    { id: 'm-multi', name: '多行', kind: '事件', importance: 3, text: '第一段。\n\n第二段。\n第三段。', source: '网页' },
    now,
  )
  const lines = await readToday(L, day)
  assert.equal(lines.length, 1, '一条记录只能占一行，续行会被读丢：' + JSON.stringify(lines))
  assert.match(lines[0], /第一段。 第二段。 第三段。/)
  const entries = await readTodayEntries(L, day)
  assert.equal(entries.length, 1)
  assert.equal(entries[0].id, 'm-multi')
  assert.match(entries[0].text, /第三段/, '侧车也得是折好的那份，两边不许不一致')
})

// ---- 「上次」摘要（B1）：跨天连续性，不叫「昨天」
await check('「上次」：拿今天之前最近那一天，并说清隔了几天', async () => {
  const last = await readLastSession(L, '2026-11-10')
  assert.ok(last.day, '应该找得到上一次')
  assert.ok(last.text.length > 0, '要有摘要，不能是空壳')
  assert.equal(last.day, '2026-11-09', '要的是最近那一天（本测试里主 day 就是 11-09），不是最早那天')
  assert.equal(last.daysAgo, 1)
})

await check('「上次」：没有历史就不留空块', async () => {
  const none = await readLastSession(L, '2026-11-01')
  assert.equal(none.text, '')
  assert.deepEqual(buildLast(none).lines, [])
  assert.ok(!buildMemoryBlock({ last: none }).text.includes('【上次】'), '不许留光秃秃的标题')
})

await check('「上次」：注入里带「多久以前」，排在今天记录前面', () => {
  const whole = buildMemoryBlock({
    last: { day: '2026-11-05', daysAgo: 4, text: '修了核的 bug、装了生图' },
    today: ['22:00 干了一件活。'],
  })
  assert.ok(whole.text.includes('【上次】'), whole.text)
  assert.match(whole.text, /11\.05 · 4 天前/, '必须说清隔了几天，不然后被当成昨天')
  assert.ok(whole.text.indexOf('【上次】') < whole.text.indexOf('【今天记录】'))
})

await check('「上次」：一天多条压成一行，且不重复', async () => {
  const text = await summarizeToday(L, day)
  assert.ok(!text.includes('\n'), '不能换行：一行一条')
  const parts = text.split('、')
  assert.equal(new Set(parts).size, parts.length, '不该有重复：' + text)
  assert.match(text, /测试条目/)
})

await check('「上次」：日期前缀和「看见了什么：」都要擦掉', async () => {
  // 实测踩过：不擦会得到「2026-11-08 凌晨，、看见什么：…」这种废物摘要
  const d = '2026-11-11'
  await fs.writeFile(
    path.join(L.today, `${d}.md`),
    `# ${d}\n\n- 02:10 2026-11-11 凌晨，主人说这扇窗以后只修图。　〔网页〕\n- 02:20 看见了什么：改好了。　〔网页〕\n`,
    'utf8',
  )
  const text = await summarizeToday(L, d)
  assert.ok(!/20\d{2}-\d{2}-\d{2}/.test(text), '日期前缀不许进摘要：' + text)
  assert.ok(!/看(见)?了什么/.test(text), '标签不许进摘要：' + text)
  assert.ok(!/〔/.test(text), '来源标记不许进摘要：' + text)
  assert.match(text, /主人说这扇窗以后只修图/)
})

await check('今天窗口只取最近 6 小时，夸零点接上昨天', async () => {
  // 2026-11-12 23:30 一条 + 2026-11-13 00:10 一条；now = 13 日 00:40，6 小时窗从 12 日 18:40 起。
  await appendToday(
    L,
    { id: 'late', name: '昨晚', kind: '事件', importance: 3, text: '看见了什么：昨晚的事。', source: '网页' },
    new Date('2026-11-12T23:30:00+08:00'),
  )
  await appendToday(
    L,
    { id: 'early', name: '今晨', kind: '事件', importance: 3, text: '看见了什么：今晨的事。', source: '网页' },
    new Date('2026-11-13T00:10:00+08:00'),
  )
  const win = await readTodayWindow(L, new Date('2026-11-13T00:40:00+08:00'), 6)
  assert.equal(win.length, 2, '跨零点的两条都该在：' + win.length)
  const far = await readTodayWindow(L, new Date('2026-11-13T12:00:00+08:00'), 6)
  assert.equal(far.length, 0, '过了 6 小时窗口就不该再带')
})

await fs.rm(tmp, { recursive: true, force: true })

console.log(`今天层结构化 ${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
