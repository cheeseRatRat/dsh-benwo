import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pickFloating, buildMemoryBlock } from '../src/core/inject.js'
import { recall } from '../src/core/recall.js'
import { readFloatLog, cooldownOf, noteFloated, floatPath, tiredOf } from '../src/core/float-log.js'

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

const rec = (id, strength = 40, importance = 3) => ({
  id,
  '名': id,
  '类型': '事实',
  '强度': strength,
  '重要度': importance,
  '状态': 'active',
  '被取代': '',
  body: id + '\n\n为什么值得记：测试。',
})

const L = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'benwo-float-'))
  fs.mkdirSync(path.join(dir, '状态'), { recursive: true })
  return { status: path.join(dir, '状态') }
}

await check('刚浮过的先歇着', () => {
  const records = [rec('a', 60), rec('b', 50), rec('c', 40), rec('d', 30)]
  const picks = pickFloating(records, { cooldown: new Set(['a']), limit: 3 })
  assert.deepEqual(picks.map((r) => r.id), ['b', 'c', 'd'])
})

await check('新鲜的不够时才补，补最久没浮的', () => {
  const records = [rec('a', 60), rec('b', 50), rec('c', 40)]
  const lastSeq = new Map([['a', 3], ['b', 9], ['c', 7]])
  const picks = pickFloating(records, { cooldown: new Set(['a', 'b', 'c']), lastSeq })
  assert.deepEqual(picks.map((r) => r.id), ['a', 'c', 'b'])
})

await check('不传 cooldown 就是原来的按分排', () => {
  const records = [rec('a', 40), rec('b', 70), rec('c', 55)]
  assert.deepEqual(pickFloating(records).map((r) => r.id), ['b', 'c', 'a'])
})

await check('先排新鲜的，再补旧的', () => {
  const records = [rec('a', 90), rec('b', 80), rec('c', 30), rec('d', 25)]
  const picks = pickFloating(records, { cooldown: new Set(['a', 'b']), limit: 3 })
  assert.deepEqual(picks.map((r) => r.id), ['c', 'd', 'a'])
})

await check('账本：写过才进冷却，序号往前走', async () => {
  const l = L()
  assert.equal((await readFloatLog(l)).seq, 0)
  await noteFloated(l, ['a', 'b'])
  const log1 = await readFloatLog(l)
  assert.equal(log1.seq, 1)
  assert.deepEqual([...cooldownOf(log1)].sort(), ['a', 'b'])
  await noteFloated(l, ['c'])
  const log2 = await readFloatLog(l)
  assert.equal(log2.seq, 2)
  // 上一轮（1）浮过的还算冷却，再上一轮的不算。
  assert.deepEqual([...cooldownOf(log2)].sort(), ['a', 'b', 'c'])
})

await check('账本：空数组不推进序号', async () => {
  const l = L()
  await noteFloated(l, [])
  assert.equal((await readFloatLog(l)).seq, 0)
})

await check('账本：老轮次会被裁掉，不留垃圾', async () => {
  const l = L()
  for (let i = 0; i < 10; i += 1) await noteFloated(l, ['id' + i])
  const log = await readFloatLog(l)
  assert.equal(log.seq, 10)
  assert.ok(log.recent.size <= 4, '近轮只留最近 4 轮，现在 ' + log.recent.size)
  assert.ok(log.recent.has('id9'))
  assert.ok(!log.recent.has('id1'))
})

await check('账本：文件坏了当空账，不炸', async () => {
  const l = L()
  fs.writeFileSync(floatPath(l), '{坏掉的', 'utf8')
  const log = await readFloatLog(l)
  assert.equal(log.seq, 0)
  assert.equal(log.recent.size, 0)
})

await check('注入报告浮了谁', () => {
  const records = [rec('a', 60), rec('b', 50)]
  const block = buildMemoryBlock({ records, preRanked: true })
  assert.deepEqual(block.floated, ['a', 'b'])
})

await check('固定行不算浮上来的', () => {
  const records = [rec('a', 60)]
  const block = buildMemoryBlock({ records, preRanked: true, pinned: ['某条经验'] })
  assert.deepEqual(block.floated, ['a'])
  assert.ok(block.text.includes('- 常驻：某条经验'))
})

await check('没措辞的条目不进浮上账本', () => {
  const blank = { ...rec('b', 60), '名': '', body: '   ' }
  const block = buildMemoryBlock({ records: [rec('a', 60), blank], preRanked: true })
  assert.deepEqual(block.floated, ['a'])
})

await check('名和正文首行不一样时，摘要也不许复读那一行', () => {
  // 2026-11-09 自查：名一重起，摘要立刻变成正文首行的复读——因为以前比的是「名」而不是显示出来的那行。
  const record = {
    ...rec('m-1', 60),
    '名': '酒馆 3.0.1 · 两个静默失效的坑',
    body: '酒馆更新到 3.0.1，把两个静默失效的坑填了\n\n为什么值得记：测试。',
  }
  const block = buildMemoryBlock({ records: [record], preRanked: true })
  const hits = (block.text.match(/酒馆更新到/g) || []).length
  assert.equal(hits, 1, '同一行写了两遍：' + block.text)
})

await check('淡到模糊时，第二行才补一句摘要', () => {
  const record = {
    ...rec('m-2', 20),
    '名': '两个坑',
    body: '酒馆更新到 3.0.1，把两个静默失效的坑填了\n\n为什么值得记：测试。',
  }
  const block = buildMemoryBlock({ records: [record], preRanked: true })
  assert.ok(block.text.includes('两个坑（有点模糊）'), block.text)
  assert.ok(block.text.includes('酒馆更新到 3.0.1'), '淡了才需要摘要补上下文：' + block.text)
})

await check('B3：带过 ≥2 次的只给标题，不给摘要', () => {
  // 摘要只在「模糊」及以下才出现（清晰/清楚档的摘要本来就是正文首行的复读，会自动省掉），
  // 所以要验 B3，得拿一条淡了的。
  const record = {
    ...rec('m-tired', 20),
    '名': '带过好几次的那条',
    body: '这条的摘要只在淡了以后才该出现。\n\n为什么值得记：测试。',
  }
  const withDigest = buildMemoryBlock({ records: [record], preRanked: true })
  assert.ok(withDigest.text.includes('这条的摘要只在淡了以后才该出现'), '没带过的时候该给摘要：' + withDigest.text)
  const tired = buildMemoryBlock({ records: [record], preRanked: true, skipDigest: new Set(['m-tired']) })
  assert.ok(tired.text.includes('带过好几次的那条（有点模糊）'), '标题还得在：' + tired.text)
  assert.ok(!tired.text.includes('这条的摘要只在淡了以后才该出现'), '摘要该省掉：' + tired.text)
  assert.ok(tired.chars < withDigest.chars, '省下来的字要真省下来')
})

await check('B3：带过计数记在账本里，老账本没这栏也不炸', async () => {
  const l = L()
  const empty = await readFloatLog(l)
  assert.equal(empty.counts.size, 0)
  await noteFloated(l, ['x', 'y'])
  await noteFloated(l, ['x'])
  await noteFloated(l, ['x'])
  const log = await readFloatLog(l)
  assert.equal(log.counts.get('x'), 3, '带过三次')
  assert.equal(log.counts.get('y'), 1)
  const tired = tiredOf(log)
  assert.ok(tired.has('x'))
  assert.ok(!tired.has('y'), '只带过一次的还不算腻')
})

await check('轮换两次：结果不会一直是同一条', async () => {
  const l = L()
  const records = [rec('a', 60), rec('b', 55), rec('c', 50), rec('d', 45)]
  const seen = []
  for (let turn = 0; turn < 3; turn += 1) {
    const log = await readFloatLog(l)
    const picks = pickFloating(records, { cooldown: cooldownOf(log), lastSeq: log.recent, limit: 3 })
    const block = buildMemoryBlock({ records: picks, preRanked: true })
    seen.push(block.floated.join('+'))
    await noteFloated(l, block.floated)
  }
  assert.notEqual(seen[0], seen[1], '相邻两轮不该完全一样：' + seen.join(' | '))
})

// ---- 召回那边的打折 ----

const mem = (id, name, body, strength = 50, importance = 3) => ({
  id,
  '名': name,
  '类型': '事实',
  '强度': strength,
  '重要度': importance,
  '状态': 'active',
  '被取代': '',
  body: body + '\n\n为什么值得记：测试。',
})

await check('打折：上一轮浮过的分数确实降到 0.7 倍', () => {
  const records = [mem('a', '小蓝的尾巴', '小蓝的尾巴会拍水')]
  const query = '小蓝的尾巴'
  const plain = recall({ records, query }) [0]
  const quiet = recall({ records, query, cooldown: new Set(['a']) })[0]
  assert.ok(Math.abs(quiet.score - plain.score * 0.7) < 1e-9, `${quiet.score} vs ${plain.score}`)
})

await check('打折：勉强够线的让位，真正相关的还留得住', () => {
  const records = [
    // 强：问句里的词全对得上
    mem('strong', '小蓝的尾巴', '小蓝的尾巴会拍水，小蓝高兴了尾巴就拍水，拍水拍得满地都是。', 90),
    // 弱：只对上一半
    mem('weak', '尾巴', '尾巴。', 50),
    // 新面孔：只对上一半，但分不低
    mem('fresh', '拍水', '拍水的时候主人最开心。', 70),
  ]
  const query = '小蓝的尾巴拍水'
  const demoted = recall({ records, query, cooldown: new Set(['strong']) })
  assert.equal(demoted[0].record.id, 'strong', '真相关的不该被轮换挤掉：' + demoted.map((h) => h.record.id).join(','))
  const weakQuiet = recall({ records, query, cooldown: new Set(['weak']) })
  const weakLoud = recall({ records, query })
  const posQuiet = weakQuiet.findIndex((h) => h.record.id === 'weak')
  const posLoud = weakLoud.findIndex((h) => h.record.id === 'weak')
  assert.ok(posQuiet >= posLoud, `弱的那条该往后走：${posLoud} → ${posQuiet}`)
})

// ---- 主人档案：默认不加载，问到才给 ----

await check('主人档案默认不占位', () => {
  const block = buildMemoryBlock({ records: [rec('a', 60)], preRanked: true })
  assert.ok(!block.text.includes('【关于主人】'), block.text)
})

await check('问到才把主人档案带上，排在最后', () => {
  const block = buildMemoryBlock({
    records: [rec('a', 60)],
    preRanked: true,
    owner: '主人\n2001.5.7 出生',
  })
  assert.ok(block.text.includes('【关于主人】'), block.text)
  assert.ok(block.text.includes('2001.5.7'), block.text)
  const idxOwner = block.text.indexOf('【关于主人】')
  const idxFloat = block.text.indexOf('【相关记忆】')
  assert.ok(idxOwner > idxFloat, '主人档案该排在浮上来的后面')
})

await check('主人档案太长会被裁，不会挤爆预算', () => {
  const block = buildMemoryBlock({
    records: [rec('a', 60)],
    preRanked: true,
    owner: '主'.repeat(2000),
  })
  assert.ok(block.chars <= 650 + 40, '字数超了：' + block.chars)
  assert.ok(block.text.includes('【关于主人】'))
})

await check('提醒默认不出现', () => {
  const block = buildMemoryBlock({ records: [rec('a', 60)], preRanked: true })
  assert.ok(!block.text.includes('【提示】'), block.text)
})

await check('该写自述时，提醒会带上来', () => {
  const block = buildMemoryBlock({
    records: [rec('a', 60)],
    preRanked: true,
    hint: '主人要收工了。写一篇自述再走。',
  })
  assert.ok(block.text.includes('【提示】'), block.text)
  assert.ok(block.text.includes('自述'), block.text)
})

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exitCode = 1
