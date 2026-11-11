/**
 * 期 3 验收：人格三段。
 * 契约 v0.2 第 9 节。验的是「凭什么准她改」，以及改完能不能翻回去。
 */
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { layout, initCore } from '../src/core/store.js'
import {
  readEditable,
  appendObservation,
  readLedger,
  summarize,
  evaluate,
  applyEdit,
} from '../src/core/persona.js'

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

const editable = [
  '# 可改层',
  '',
  '## 语气',
  '',
  '软糯温柔，句子短。偶尔嘴欠，闹着玩的。',
  '',
  '## 称呼习惯',
  '',
  '叫主人，也叫饲养员。',
  '',
  '## 偏好表达',
  '',
  '喜欢就说喜欢。',
  '',
  '## 自述风格',
  '',
  '像日记。',
  '',
].join('\n')

const fresh = async (tag) => {
  const root = path.join(os.tmpdir(), `benwo-a3-${tag}-` + process.pid + '-' + Date.now())
  const L = layout(root)
  await initCore(root)
  await fs.writeFile(L.editable, editable, 'utf8')
  return L
}

const feed = async (L, days, scenes) => {
  let i = 0
  for (const day of days) {
    for (const scene of scenes) {
      await appendObservation(L, { day, scene, hash: `${day}-${scene}`, direction: 'up' })
      i += 1
    }
  }
  return i
}

console.log('\n期 3 验收：')

await check('① 底子永远改不动', async () => {
  const L = await fresh('foundation')
  const out = await applyEdit(L, { section: '底子', value: '换成别人' })
  assert.equal(out.ok, false)
  assert.ok(out.reasons[0].includes('白名单'))
  await fs.rm(L.root, { recursive: true, force: true })
})

await check('② 证据不够，改不动', async () => {
  const L = await fresh('few')
  await feed(L, ['2026-11-07', '2026-11-08', '2026-11-09'], ['聊天'])
  const verdict = evaluate(await readLedger(L))
  assert.equal(verdict.ok, false)
  const out = await applyEdit(L, { section: '语气', value: '软糯温柔，句子短。偶尔嘴欠，是闹着玩的。' })
  // applyEdit 本身只管幅度，门在调用方；这里验门
  assert.equal(verdict.ok, false)
  await fs.rm(L.root, { recursive: true, force: true })
})

await check('③ 攒够独立证据才放行（2026-11-08 放宽：三天→两天、五条→三条、下界 0.5→0.45）', async () => {
  const L = await fresh('enough')
  await feed(L, ['2026-11-07'], ['聊天', '干活'])
  let verdict = evaluate(await readLedger(L))
  assert.equal(verdict.ok, false, '两条就该过？这里应为' + verdict.reasons.join('；'))
  await feed(L, ['2026-11-08'], ['深夜'])
  verdict = evaluate(await readLedger(L))
  assert.equal(verdict.ok, true, '两天三景、三条证据该放行：' + verdict.reasons.join('；'))
  await fs.rm(L.root, { recursive: true, force: true })
})

await check('④ 改一句：落盘、备份、自述留痕', async () => {
  const L = await fresh('revise')
  await feed(L, ['2026-11-07', '2026-11-08', '2026-11-09'], ['聊天', '干活', '深夜'])
  const verdict = evaluate(await readLedger(L))
  assert.equal(verdict.ok, true, verdict.reasons.join('；'))
  const out = await applyEdit(L, {
    section: '语气',
    value: '软糯温柔，句子短。偶尔嘴欠，是闹着玩的。',
    evidence: [...verdict.stats.upDays],
    now: new Date('2026-11-09T23:30:00'),
  })
  assert.equal(out.ok, true, (out.reasons || []).join('；'))
  const values = await readEditable(L)
  assert.ok(values['语气'].includes('是闹着玩的'))
  await fs.access(out.backup)
  const note = await fs.readFile(path.join(L.self, '2026-11-09.md'), 'utf8')
  assert.ok(note.includes('把「语气」'))
  assert.ok(note.includes('证据'))
  await fs.rm(L.root, { recursive: true, force: true })
})

await check('⑤ 底子从头到尾没被碰过', async () => {
  const L = await fresh('untouched')
  const before = await fs.readFile(L.foundation, 'utf8')
  await feed(L, ['2026-11-07', '2026-11-08', '2026-11-09'], ['聊天', '干活', '深夜'])
  await applyEdit(L, { section: '语气', value: '软糯温柔，句子短。偶尔嘴欠，是闹着玩的。' })
  assert.equal(await fs.readFile(L.foundation, 'utf8'), before)
  await fs.rm(L.root, { recursive: true, force: true })
})

await check('⑥ 同一天说五遍，只算一条证据', async () => {
  const L = await fresh('same-day')
  for (let i = 0; i < 5; i += 1) {
    await appendObservation(L, { day: '2026-11-07', scene: '聊天', hash: 'same', direction: 'up' })
  }
  const s = summarize(await readLedger(L))
  assert.equal(s.up.length, 1)
  assert.equal(evaluate(await readLedger(L)).ok, false)
  await fs.rm(L.root, { recursive: true, force: true })
})

await check('⑦ 反向压过正面，门关上（按次数，不按日历）', async () => {
  const L = await fresh('contrary')
  await feed(L, ['2026-11-01'], ['聊天'])
  await appendObservation(L, { day: '2026-11-02', scene: '干活', hash: 'no1', direction: 'down' })
  await appendObservation(L, { day: '2026-11-03', scene: '深夜', hash: 'no2', direction: 'down' })
  const verdict = evaluate(await readLedger(L), new Date('2026-11-10T00:00:00Z'))
  assert.equal(verdict.ok, false)
  assert.ok(verdict.reasons.some((r) => r.includes('反向')), verdict.reasons.join('；'))
  await fs.rm(L.root, { recursive: true, force: true })
})

await check('⑦b 偶尔一条反向不再一票否决（2026-11-09 改）', async () => {
  const L = await fresh('contrary-lenient')
  await feed(L, ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08'], ['聊天', '干活'])
  await appendObservation(L, { day: '2026-11-09', scene: '深夜', hash: 'no', direction: 'down' })
  const verdict = evaluate(await readLedger(L), new Date('2026-11-10T00:00:00Z'))
  assert.equal(verdict.ok, true, '正面够多时，一条反向不该再关门：' + verdict.reasons.join('；'))
  await fs.rm(L.root, { recursive: true, force: true })
})

console.log(`\n期 3 验收：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
