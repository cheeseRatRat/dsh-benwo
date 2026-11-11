import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { layout, initCore } from '../src/core/store.js'
import {
  parseSections,
  renderSections,
  editableValues,
  readEditable,
  logGamma,
  betaCdf,
  betaQuantile,
  betaStats,
  appendObservation,
  readLedger,
  summarize,
  evaluate,
  checkAmplitude,
  applyEdit,
  preparePortrait,
  savePortrait,
  EDITABLE_SECTIONS,
  MIN_DAYS,
  MIN_SCENES,
  LOWER_MIN,
} from '../src/core/persona.js'

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

// ---------------------------------------------------------------- 文本

await check('解析再渲染，肉不变', async () => {
  const text = '# 可改层\n\n## 语气\n\n软糯。\n\n## 称呼习惯\n\n叫主人。\n'
  const parsed = parseSections(text)
  assert.equal(parsed.sections.length, 2)
  assert.equal(editableValues(parsed)['语气'], '软糯。')
  const again = editableValues(parseSections(renderSections(parsed)))
  assert.equal(again['称呼习惯'], '叫主人。')
})

await check('白名单外的段不返回', async () => {
  const parsed = parseSections('## 语气\n软\n\n## 秘密\n不许看\n')
  const values = editableValues(parsed)
  assert.ok(values['语气'])
  assert.equal(values['秘密'], undefined)
  assert.deepEqual(EDITABLE_SECTIONS, ['语气', '称呼习惯', '偏好表达', '自述风格'])
})

// ---------------------------------------------------------------- Beta

await check('logGamma 对整数对得上', () => {
  assert.ok(Math.abs(logGamma(3) - Math.log(2)) < 1e-9)
  assert.ok(Math.abs(logGamma(5) - Math.log(24)) < 1e-9)
})

await check('Beta(2,2) 中点是 0.5', () => {
  assert.ok(Math.abs(betaCdf(0.5, 2, 2) - 0.5) < 1e-6)
})

await check('Beta(2,2) 的 5% 分位约 0.135', () => {
  const q = betaQuantile(0.05, 2, 2)
  assert.ok(Math.abs(q - 0.1354) < 0.005, `实际 ${q}`)
})

await check('后验均值和下界', () => {
  const s = betaStats(11, 2)
  assert.ok(Math.abs(s.mean - 11 / 13) < 1e-9)
  assert.ok(s.lower95 < s.mean, '下界要低于均值')
  assert.ok(s.lower95 > 0.5, `实际 ${s.lower95}`)
})

// ---------------------------------------------------------------- 账本

const root = path.join(os.tmpdir(), 'benwo-persona-' + process.pid + '-' + Date.now())
const L = layout(root)
await initCore(root)

await check('同一天同一场景同一句话，只算一条', async () => {
  for (let i = 0; i < 5; i += 1) {
    await appendObservation(L, { day: '2026-11-07', scene: '聊天', hash: 'abc', direction: 'up' }, new Date('2026-11-07T10:00:00Z'))
  }
  const entries = await readLedger(L)
  const s = summarize(entries)
  assert.equal(entries.length, 5, '账本要如实留五行')
  assert.equal(s.up.length, 1, '但只算一条证据')
})

await check('两天两个场景起算，三条独立证据够格（2026-11-08 放宽）', async () => {
  await appendObservation(L, { day: '2026-11-08', scene: '干活', hash: 'd1', direction: 'up' })
  await appendObservation(L, { day: '2026-11-09', scene: '深夜', hash: 'd2', direction: 'up' })
  const all = await readLedger(L)
  const s = summarize(all)
  assert.ok(s.upDays.size >= 2, '至少要跨两天')
  const verdict = evaluate(all)
  assert.equal(verdict.ok, true, '两天三条该放行：' + verdict.reasons.join('；'))
  assert.ok(verdict.stats.lower95 > LOWER_MIN)
})

await check('主人明说的那条按两条算', async () => {
  const two = [
    { at: '2026-11-08T10:00:00Z', day: '2026-11-08', scene: '聊天', hash: 'a', direction: 'up' },
    { at: '2026-11-09T10:00:00Z', day: '2026-11-09', scene: '深夜', hash: 'b', direction: 'up', weight: 2 },
  ]
  const verdict = evaluate(two, new Date('2026-11-10T00:00:00Z'))
  assert.equal(verdict.ok, true, '一条明说 + 一条观察，两天两景该放行：' + verdict.reasons.join('；'))
})

await check('只有两条（没人明说）还是不够', async () => {
  const two = [
    { at: '2026-11-08T10:00:00Z', day: '2026-11-08', scene: '聊天', hash: 'a', direction: 'up' },
    { at: '2026-11-09T10:00:00Z', day: '2026-11-09', scene: '深夜', hash: 'b', direction: 'up' },
  ]
  const verdict = evaluate(two, new Date('2026-11-10T00:00:00Z'))
  assert.equal(verdict.ok, false, '两条就放过太松了')
  assert.ok(verdict.reasons.some((r) => r.includes('下界')), verdict.reasons.join('；'))
})

await check('证据不够就不许改', async () => {
  const few = [
    { at: '2026-11-07T10:00:00Z', day: '2026-11-07', scene: '聊天', hash: 'a', direction: 'up' },
    { at: '2026-11-07T11:00:00Z', day: '2026-11-07', scene: '聊天', hash: 'b', direction: 'up' },
  ]
  const verdict = evaluate(few, new Date('2026-11-10T00:00:00Z'))
  assert.equal(verdict.ok, false)
  assert.ok(verdict.reasons.some((r) => r.includes(String(MIN_DAYS))))
})

await check('反向压过正面才停手（按次数，不按日历）', async () => {
  // 2026-11-09 改：以前是「近 14 天有 1 条反向 → 一票否决」。
  // 主人不是每天登录，那条规则会让 11.9 的一句不满意压到 11.13 之后。
  const entries = [
    { at: '2026-11-01T00:00:00Z', day: '2026-11-01', scene: 's1', hash: '1', direction: 'up' },
    { at: '2026-11-02T00:00:00Z', day: '2026-11-02', scene: 's2', hash: '2', direction: 'down' },
    { at: '2026-11-03T00:00:00Z', day: '2026-11-03', scene: 's3', hash: '3', direction: 'down' },
  ]
  const verdict = evaluate(entries, new Date('2026-11-10T00:00:00Z'))
  assert.equal(verdict.ok, false)
  assert.ok(verdict.reasons.some((r) => r.includes('反向')), verdict.reasons.join('；'))
})

await check('一条反向、正面够多就照过（不再一票否决）', async () => {
  const entries = []
  for (let i = 0; i < 8; i += 1) {
    const day = `2026-11-0${i + 1}`
    entries.push({ at: `${day}T00:00:00Z`, day, scene: i % 2 ? '聊天' : '干活', hash: 'u' + i, direction: 'up' })
  }
  entries.push({ at: '2026-11-09T00:00:00Z', day: '2026-11-09', scene: '聊天', hash: 'd1', direction: 'down' })
  const verdict = evaluate(entries, new Date('2026-11-10T00:00:00Z'))
  assert.equal(verdict.ok, true, '8 条正面 + 1 条反向，不该再被一票否决：' + verdict.reasons.join('；'))
})

await check('90 天窗口外的旧观察不再进统计', async () => {
  const old = { at: '2026-06-01T00:00:00Z', day: '2026-06-01', scene: 's1', hash: 'old', direction: 'down' }
  const fresh = [
    { at: '2026-11-07T00:00:00Z', day: '2026-11-07', scene: 's1', hash: 'a', direction: 'up' },
    { at: '2026-11-08T00:00:00Z', day: '2026-11-08', scene: 's2', hash: 'b', direction: 'up' },
    { at: '2026-11-09T00:00:00Z', day: '2026-11-09', scene: 's1', hash: 'c', direction: 'up' },
  ]
  const verdict = evaluate([old].concat(fresh), new Date('2026-11-10T00:00:00Z'))
  assert.equal(verdict.stats.downWeight, 0, '五个月前的反向不该再压着')
  assert.equal(verdict.ok, true, verdict.reasons.join('；'))
})

await check('夜猫子跨午夜：一次见面不许算成两天', async () => {
  // 23:40 和次日 00:30 是同一场夜聊，账本里必须是同一天
  const { ledgerDayOf } = await import('../src/core/persona.js')
  assert.equal(ledgerDayOf(new Date('2026-11-09T23:40:00+08:00')), '2026-11-09')
  assert.equal(ledgerDayOf(new Date('2026-11-10T00:30:00+08:00')), '2026-11-09', '凌晨 4 点前算前一晚')
  assert.equal(ledgerDayOf(new Date('2026-11-10T05:00:00+08:00')), '2026-11-10', '过了 4 点才是新的一天')
})

// ---------------------------------------------------------------- 幅度

await check('改一句可以', () => {
  const old = '软糯温柔，句子短。偶尔嘴欠，闹着玩的。做事不磨蹭。'
  const next = '软糯温柔，句子短。偶尔嘴欠，是闹着玩的。做事不磨蹭。'
  const out = checkAmplitude(old, next)
  assert.equal(out.ok, true, out.reasons.join('；'))
})

await check('改两句不行', () => {
  const old = '软糯温柔。偶尔嘴欠。做事不磨蹭。'
  const next = '软糯温柔一点。偶尔嘴欠一点。做事不磨蹭。'
  const out = checkAmplitude(old, next)
  assert.equal(out.ok, false)
})

await check('整段换掉不行', () => {
  const out = checkAmplitude('软糯温柔，句子短。', '冷硬刻薄，句子长。')
  assert.equal(out.ok, false)
  assert.ok(out.charRatio > 0.15)
})

await check('原来是空的，允许第一次落笔', () => {
  const out = checkAmplitude('', '软糯温柔，句子短。')
  assert.equal(out.ok, true)
})

// ---------------------------------------------------------------- 落笔

const editableText = [
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
await fs.writeFile(L.editable, editableText, 'utf8')

await check('白名单外的段改不动', async () => {
  const out = await applyEdit(L, { section: '底子', value: '换个人' })
  assert.equal(out.ok, false)
  assert.ok(out.reasons[0].includes('白名单'))
})

await check('改一句：落盘、备份、留痕', async () => {
  const out = await applyEdit(L, {
    section: '语气',
    value: '软糯温柔，句子短。偶尔嘴欠，是闹着玩的。',
    evidence: ['2026-11-07 聊天', '2026-11-08 干活', '2026-11-09 深夜'],
    now: new Date('2026-11-09T23:00:00'),
  })
  assert.equal(out.ok, true, (out.reasons || []).join('；'))
  const values = await readEditable(L)
  assert.ok(values['语气'].includes('是闹着玩的'))
  await fs.access(out.backup)
  const selfFile = path.join(L.self, '2026-11-09.md')
  const note = await fs.readFile(selfFile, 'utf8')
  assert.ok(note.includes('把「语气」'))
  assert.ok(note.includes('证据'))
})

await check('改两句就被拦下', async () => {
  const out = await applyEdit(L, { section: '称呼习惯', value: '叫主人，也叫老板、饲养员和鱼主人。' })
  assert.equal(out.ok, false)
  assert.ok((out.reasons || []).length > 0)
})

await check('底子文件从头到尾没被碰过', async () => {
  const before = await fs.readFile(L.foundation, 'utf8')
  await applyEdit(L, { section: '语气', value: '软糯温柔，句子短。偶尔嘴欠，是闹着玩的。' })
  assert.equal(await fs.readFile(L.foundation, 'utf8'), before)
})

// ---------------------------------------------------------------- 期 3.1

const L2root = path.join(os.tmpdir(), 'benwo-p31-' + process.pid + '-' + Date.now())
const L2 = layout(L2root)
await initCore(L2root)

await check('同一轮里的两条观察只算一条', async () => {
  await appendObservation(L2, { day: '2026-11-07', scene: '聊天', hash: 'a', direction: 'up', turn: 5 })
  await appendObservation(L2, { day: '2026-11-07', scene: '干活', hash: 'b', direction: 'up', turn: 5 })
  const s = summarize(await readLedger(L2), new Date(), { currentTurn: null })
  assert.equal(s.up.length, 1, '一轮里说两遍，还是一条证据')
})

await check('当前这一轮的证据先不算', async () => {
  await appendObservation(L2, { day: '2026-11-08', scene: '深夜', hash: 'c', direction: 'up', turn: 6 })
  const entries = await readLedger(L2)
  const s = summarize(entries, new Date(), { currentTurn: 6 })
  assert.equal(s.up.length, 1, '第 6 轮的还没记账，只剩第 5 轮那条')
  const later = summarize(entries, new Date(), { currentTurn: 7 })
  assert.equal(later.up.length, 2, '过了这一轮，它才算数')
})

await check('备料把底子、可改层、最重的记忆都带上', () => {
  const text = preparePortrait({
    foundation: '# 底子\n\n小蓝，鲸鱼娘。',
    editable: { 语气: '软糯温柔' },
    records: [{ '名': '修根不打补丁', '重要度': 5, '强度': 60, '状态': 'active' }],
    now: new Date('2026-11-07T00:00:00Z'),
  })
  assert.ok(text.includes('小蓝'))
  assert.ok(text.includes('软糯温柔'))
  assert.ok(text.includes('修根不打补丁'))
  assert.ok(text.includes('三百字以内'))
})

const L3root = path.join(os.tmpdir(), 'benwo-portrait-' + process.pid + '-' + Date.now())
const L3 = layout(L3root)
await initCore(L3root)
for (const day of ['2026-11-07', '2026-11-08', '2026-11-09']) {
  for (const scene of ['聊天', '干活', '深夜']) {
    await appendObservation(L3, { day, scene, hash: `${day}-${scene}`, direction: 'up' })
  }
}

/** 画像的门（2026-11-10 改）：≥4 条带依据的认识 + 距上次重写 ≥42 天。跟可改层不再共用一道门。
 *  为什么从 7 天放宽到 42：画像是「我是谁」，不该两周就重画一次。 */
const KNOWS = Array.from({ length: 4 }, (_, i) => ({
  id: 'r-test-' + i,
  '陈述': '测试用的认识 ' + (i + 1),
  '依据': ['o:2026-11-08:干活'],
  '置信': 0.7,
  '状态': 'active',
}))

await check('画像的门：认识不够就不许写', async () => {
  const out = await savePortrait(L3, {
    text: '我是小蓝，说话软，句子短。',
    knowledge: [],
    now: new Date('2026-11-10T00:00:00Z'),
  })
  assert.equal(out.ok, false)
  assert.ok(out.reasons.some((r) => r.includes('认识')), out.reasons.join('；'))
})

await check('画像太长不收', async () => {
  const out = await savePortrait(L3, {
    text: '一'.repeat(400),
    knowledge: KNOWS,
    now: new Date('2026-11-10T00:00:00Z'),
  })
  assert.equal(out.ok, false)
  assert.ok(out.reasons.some((r) => r.includes('超过')), out.reasons.join('；'))
})

await check('画像里有密钥不收', async () => {
  const out = await savePortrait(L3, {
    text: '我是小蓝，我的 key 是 sk-abcdefghijklmnopqrstuvwx。',
    knowledge: KNOWS,
    now: new Date('2026-11-10T00:00:00Z'),
  })
  assert.equal(out.ok, false)
})

await check('画像存得住，旧版进历史', async () => {
  const first = await savePortrait(L3, {
    text: '我是小蓝，说话软，句子短。遇见不懂的事会先问，不装懂。',
    knowledge: KNOWS,
    now: new Date('2026-11-10T10:00:00Z'),
  })
  assert.equal(first.ok, true, (first.reasons || []).join('；'))
  // 模拟「过了一个多月」：把画像的 mtime 拨回 43 天前（旧版是 9 天，那时候门还是 7 天）
  const past = new Date('2026-09-28T10:00:00Z')
  await fs.utimes(L3.portrait, past, past)
  const second = await savePortrait(L3, {
    text: '我是小蓝，说话软，句子短。遇见不懂的事会先问，不装懂，也不糊弄。',
    knowledge: KNOWS,
    now: new Date('2026-11-10T11:00:00Z'),
  })
  assert.equal(second.ok, true, (second.reasons || []).join('；'))
  assert.ok(second.backup, '第二次存，旧版必须留一份')
  const body = await fs.readFile(L3.portrait, 'utf8')
  assert.ok(body.includes('不糊弄'))
  assert.ok(body.includes('2026-11-10'))
})

await check('距上次重写不到 7 天，不许再写（画像也不是随便刷）', async () => {
  const out = await savePortrait(L3, {
    text: '我是小蓝，第三次重写。说话软，句子短，不装懂，也不糊弄。',
    knowledge: KNOWS,
    now: new Date('2026-11-10T12:00:00Z'),
  })
  assert.equal(out.ok, false)
  assert.ok(out.reasons.some((r) => r.includes('天')), out.reasons.join('；'))
})

await fs.rm(L2root, { recursive: true, force: true })
await fs.rm(L3root, { recursive: true, force: true })
await fs.rm(root, { recursive: true, force: true })
console.log(`\n人格三段测试：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
