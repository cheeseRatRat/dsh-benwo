/**
 * 认识层（C1，2026-11-09）。
 *
 * 这一层存在的理由：观察是「证据」，可改层/画像是「结论」，中间缺台阶。
 * 从一条证据直接跳到「咱是谁」，跨度太大——门只能定得死严，门严是在替这一层的缺失擦屁股。
 *
 * 锁住的四件事：
 *   ① 没有依据的认识不收（自我美化不进盘）
 *   ② 不按时间衰减，按推翻降置信
 *   ③ 注入在 context 段，≤150 字，没东西不留空块
 *   ④ 观察账本真的记住 weight（主人明说按两条算——这条以前是死的）
 */
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { layout, dayOf } from '../src/core/store.js'
import {
  addKnowledge,
  readKnowledge,
  writeKnowledge,
  overturnKnowledge,
  supersedeKnowledge,
  confirmKnowledge,
  injectableKnowledge,
  resolveEvidence,
  parseEvidence,
  CONFIDENCE_DEFAULT,
  CONFIDENCE_MIN,
  STATEMENT_MAX,
} from '../src/core/knowledge.js'
import { buildKnowledge, buildMemoryBlock, BUDGET_KNOWLEDGE } from '../src/core/inject.js'
import { appendObservation, readLedger, summarize, ledgerPath } from '../src/core/persona.js'

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

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'benwo-know-'))
const L = layout(tmp)
for (const dir of [L.status, L.long, L.selfKnowledge, L.persona]) await fsp.mkdir(dir, { recursive: true })

const now = new Date('2026-11-09T22:00:00+08:00')
const today = dayOf(now)

// 造一份依据：一条观察用**真写入接口**铺（不手搓文件）+ 一条记忆
await appendObservation(L, { day: today, scene: '干活', hash: 'h1', direction: 'up', note: '先说结论再说过程', turn: 1 }, now)
await fsp.writeFile(
  path.join(L.long, 'm-20261107-3db6.md'),
  '---\nid: m-20261107-3db6\n名: 边做边汇报\n类型: 约定\n强度: 40\n重要度: 5\n首次: 2026-11-07\n上次: 2026-11-07\n状态: active\n---\n\n边做边汇报。\n',
  'utf8',
)
const OBS = `o:${today}:干活`
const MEM = 'm-20261107-3db6'

// ---------------------------------------------------------------- 铁律①
await check('没有依据的认识不收（自我美化不进盘）', async () => {
  const out = await addKnowledge(L, { statement: '咱是个温柔的人', evidence: [], now })
  assert.equal(out.ok, false)
  assert.match(out.reasons.join(''), /依据/)
})

await check('依据解析得出两种写法', () => {
  // o:日期:场景 → 观察；m-xxx → 长期记忆
  assert.deepEqual(parseEvidence([OBS, MEM]), [OBS, MEM])
  assert.deepEqual(parseEvidence(`${OBS}，${MEM}`), [OBS, MEM], '逗号也要能拆')
})

await check('依据校验读的是真账本文件（文件名不许自己拼）', async () => {
  // 2026-11-09 踩过：认识层硬写了 '观察.jsonl'，真账本叫 'ledger.jsonl'，
  // 而测试也跟着写同一个错名 → 两边一起绿，实际依据永远校验不过。
  assert.match(ledgerPath(L), /ledger\.jsonl$/, '账本真名是 ledger.jsonl')
  const v = await resolveEvidence(L, [OBS])
  assert.equal(v.ok, true, '刚用真接口写进去的观察，依据必须找得到：' + JSON.stringify(v))
})

await check('依据全都找不到就不收', async () => {
  const out = await addKnowledge(L, { statement: '咱从来不生气', evidence: ['o:1999-01-01:梦里', 'm-不存在'], now })
  assert.equal(out.ok, false)
  assert.match(out.reasons.join(''), /找不到/)
})

await check('只有观察依据不收：必须有一条记忆 id（不然是自己给自己发奖）', async () => {
  const out = await addKnowledge(L, { statement: '咱是个很稳的人。', evidence: [OBS], now })
  assert.equal(out.ok, false)
  assert.match(out.reasons.join(''), /记忆 id/)
})

await check('依据在盘上找得到', async () => {
  const v = await resolveEvidence(L, [OBS, MEM])
  assert.equal(v.ok, true, JSON.stringify(v))
  const bad = await resolveEvidence(L, [OBS, 'm-不存在'])
  assert.deepEqual(bad.missing, ['m-不存在'])
  assert.equal(bad.ok, false)
})

// ---------------------------------------------------------------- 收下与往返
let firstId = ''
await check('有依据就收下，且存读往返字段不丢', async () => {
  const out = await addKnowledge(L, {
    name: '先说结论',
    statement: '咱汇报时会先说结论再补过程，不是从盘古开天讲起。',
    evidence: [OBS, MEM],
    confidence: 0.8,
    now,
  })
  assert.equal(out.ok, true, JSON.stringify(out.reasons))
  firstId = out.item.id
  const { items } = await readKnowledge(L)
  const saved = items.find((x) => x.id === firstId)
  assert.ok(saved, '存进去读不回来')
  assert.equal(saved['陈述'], '咱汇报时会先说结论再补过程，不是从盘古开天讲起。')
  assert.deepEqual(saved['依据'], [OBS, MEM], '依据必须原样回来（存疑就查不到依据了）')
  assert.equal(saved['置信'], 0.8)
  assert.equal(saved['状态'], 'active')
  assert.equal(saved['名'], '先说结论')
})

await check('不给置信就用默认值', async () => {
  const out = await addKnowledge(L, { statement: '咱觉得话少一点更好。', evidence: [OBS, MEM], now })
  assert.equal(out.ok, true)
  assert.equal(out.item['置信'], CONFIDENCE_DEFAULT)
})

await check('陈述超过 90 字不收', async () => {
  const out = await addKnowledge(L, { statement: '咱'.repeat(STATEMENT_MAX + 1), evidence: [OBS, MEM], now })
  assert.equal(out.ok, false)
  assert.match(out.reasons.join(''), /超过/)
})

await check('以「她」开头不收（铁律③：写咱不写她）', async () => {
  const out = await addKnowledge(L, { statement: '她总是很温柔', evidence: [OBS, MEM], now })
  assert.equal(out.ok, false)
  assert.match(out.reasons.join(''), /咱/)
})

// ---------------------------------------------------------------- 推翻 / 取代 / 确认
await check('推翻一次：置信降一档，推翻计数加一', async () => {
  const out = await overturnKnowledge(L, firstId, { now })
  assert.equal(out.ok, true)
  assert.equal(out.item['置信'], 0.65)
  assert.equal(out.item['推翻'], 1)
  assert.equal(out.item['状态'], 'active')
})

await check('推翻到 0.3 以下转「弱化」，但不删', async () => {
  let id = firstId
  for (let i = 0; i < 4; i += 1) {
    const out = await overturnKnowledge(L, id, { now })
    assert.equal(out.ok, true)
  }
  const { items } = await readKnowledge(L)
  const found = items.find((x) => x.id === firstId)
  assert.ok(found, '文件不许删')
  assert.ok(found['置信'] < CONFIDENCE_MIN, `置信 ${found['置信']} 应低于 ${CONFIDENCE_MIN}`)
  assert.equal(found['状态'], '弱化')
})

await check('弱化的不进注入', async () => {
  const { items } = await readKnowledge(L)
  const picks = injectableKnowledge(items, now)
  assert.ok(!picks.some((x) => x.id === firstId), '弱化的还在注入里')
})

let confirmId = ''
await check('再被印证：置信往上抬，记上次确认', async () => {
  // 另起一条干净的来验「倒下再站起来」，别拿前面被推翻五次的那条凑
  const fresh = await addKnowledge(L, { statement: '咱喜欢把活干完再聊。', evidence: [OBS, MEM], confidence: 0.5, now })
  assert.equal(fresh.ok, true)
  confirmId = fresh.item.id
  await overturnKnowledge(L, confirmId, { now }) // 0.35
  await overturnKnowledge(L, confirmId, { now }) // 0.20 → 弱化
  const down = (await readKnowledge(L)).items.find((x) => x.id === confirmId)
  assert.equal(down['状态'], '弱化')
  const out = await confirmKnowledge(L, confirmId, { now }) // 0.25
  assert.equal(out.item['置信'], 0.25)
  assert.equal(out.item['状态'], '弱化', '还没回到 0.3，先别急着站起来')
  assert.equal(out.item['上次确认'], today)
})

await check('印证到 0.3 以上就恢复 active（被推翻过不是判死刑）', async () => {
  const out = await confirmKnowledge(L, confirmId, { now }) // 0.30
  assert.equal(out.item['置信'], 0.3)
  assert.equal(out.item['状态'], 'active', '被生活印证回来了，就该站起来')
})

await check('被新的认识取代：旧的标掉，不删', async () => {
  const a = await addKnowledge(L, { statement: '咱先查再说。', evidence: [OBS, MEM], confidence: 0.7, now })
  const b = await addKnowledge(L, { statement: '咱先查再说，查不到才开口问。', evidence: [OBS, MEM], confidence: 0.75, now })
  const out = await supersedeKnowledge(L, a.item.id, b.item.id)
  assert.equal(out.ok, true)
  assert.equal(out.item['状态'], '被取代')
  assert.equal(out.item['被取代'], b.item.id)
  const { items } = await readKnowledge(L)
  assert.ok(items.some((x) => x.id === a.item.id), '被取代的不许删')
  assert.ok(!injectableKnowledge(items, now).some((x) => x.id === a.item.id), '被取代的还在注入里')
})

await check('取代一个不存在的目标不收', async () => {
  const out = await supersedeKnowledge(L, firstId, 'r-不存在')
  assert.equal(out.ok, false)
})

// ---------------------------------------------------------------- 注入块
await check('注入块：一条一行，低置信标「还不确定」', async () => {
  const items = [
    { id: 'r-1', '陈述': '咱遇事先查再说。', '置信': 0.8 },
    { id: 'r-2', '陈述': '咱不太爱被人催。', '置信': 0.4 },
  ]
  const block = buildKnowledge(items)
  assert.equal(block.lines.length, 2)
  assert.equal(block.lines[0], '- 咱遇事先查再说。')
  assert.match(block.lines[1], /（还不确定）$/)
  assert.deepEqual(block.ids, ['r-1', 'r-2'])
})

await check('注入块：没有认识就是空的，不留光秃秃的标题', () => {
  assert.deepEqual(buildKnowledge([]).lines, [])
  const whole = buildMemoryBlock({ knowledge: [], today: [], records: [] })
  assert.ok(!whole.text.includes('【自我认识】'), '没有认识时不该出现这个标题：' + whole.text)
})

await check('注入块：整个不超过 150 字预算', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ id: 'r-' + i, '陈述': '咱' + '很具体的行为倾向'.repeat(5), '置信': 0.9 }))
  const block = buildKnowledge(many)
  const chars = [...block.lines.join('\n')].length
  assert.ok(chars <= BUDGET_KNOWLEDGE, `超了：${chars}`)
  assert.ok(block.dropped > 0, '超预算要报数')
})

await check('整段注入里，认识排在记忆前面', () => {
  const whole = buildMemoryBlock({
    knowledge: [{ id: 'r-1', '陈述': '咱遇事先查再说。', '置信': 0.8 }],
    today: ['22:00 干了一件活。'],
    records: [],
  })
  const iKnow = whole.text.indexOf('【自我认识】')
  const iToday = whole.text.indexOf('【今天记录】')
  assert.ok(iKnow >= 0 && iToday >= 0)
  assert.ok(iKnow < iToday, '认识该排在今天记录前面：' + whole.text)
})

await check('认识进的是运行期尾部，不是缓存段（放了会掉 KV 前缀）', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const src = fs.readFileSync(path.resolve(here, '..', 'index.js'), 'utf8')
  // 正向：认识必须传进记忆段
  const memStart = src.indexOf('buildMemoryBlock({')
  const memCall = src.slice(memStart, src.indexOf('\n    })', memStart) + 1)
  assert.match(memCall, /knowledge:\s*knowledgePicks/, '认识应该传给 buildMemoryBlock')
  // 反向：人格段（字节冻结）里不许出现认识。
  // 只看 buildPersonaBlock 那一个调用括起来的内容——别用「往后 300 字」那种窗口，
  // 旁边写什么都可能被误扫（2026-11-09 踩过）。
  const perStart = src.indexOf('buildPersonaBlock({')
  assert.ok(perStart > 0, '找不到 buildPersonaBlock 的调用')
  const perCall = src.slice(perStart, src.indexOf('\n    })', perStart) + 1)
  assert.ok(!/knowledge/i.test(perCall), '人格段是字节冻结的，认识一放进去整个前缀掉缓存：' + perCall)
})

await check('面板也看得见认识（不然写进去像没写）', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const src = fs.readFileSync(path.resolve(here, '..', 'client.js'), 'utf8')
  assert.ok(src.includes('自我认识'), '人格页里缺「自我认识」这块')
  assert.ok(src.includes('persona.knowledge'), '面板没拿到认识数据')
  assert.ok(src.includes('portraitGate'), '画像的门没在面板上说明')
})

// ---------------------------------------------------------------- 观察账本的 weight
await check('观察账本真的记住 weight（主人明说按两条算）', async () => {
  await appendObservation(L, { day: today, scene: '聊天', hash: 'h2', direction: 'up', note: '她明确说了', weight: 2, turn: 7 }, now)
  await appendObservation(L, { day: today, scene: '干活', hash: 'h3', direction: 'up', note: '咱自己看的', turn: 8 }, now)
  const entries = await readLedger(L)
  const mine = entries.find((e) => e.hash === 'h2')
  assert.equal(mine.weight, 2, 'weight 又被丢了——「她的话较硬」这条规则就是死的')
  const self = entries.find((e) => e.hash === 'h3')
  assert.equal(self.weight, 1)
  // 汇总时确实按两条算
  const s = summarize(entries, new Date('2026-11-10T00:00:00+08:00'), { currentTurn: null })
  const upWeight = [...s.up].reduce((sum, e) => sum + (Number(e.weight) === 2 ? 2 : 1), 0)
  assert.ok(upWeight >= 3, `权重合计 ${upWeight}`)
})

await fsp.rm(tmp, { recursive: true, force: true })

console.log(`认识层 ${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
