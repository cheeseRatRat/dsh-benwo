import assert from 'node:assert/strict'
import {
  halfLifeDays,
  settleStrength,
  settleRecord,
  settleAll,
  reinforce,
  clarityOf,
  injectable,
  daysBetween,
  phraseFor,
  shortName,
  NEW_STRENGTH,
  NEW_IMPORTANCE,
  FLOOR,
  CAP,
  IMPORTANT_EXCEPTION,
} from '../src/core/decay.js'

let passed = 0
let failed = 0
const check = (name, fn) => {
  try {
    fn()
    passed += 1
  } catch (error) {
    failed += 1
    console.error('FAIL', name, '—', error.message)
  }
}

const base = (over = {}) => ({
  id: 'm-20261107-0001',
  '名': '修根不打补丁',
  '类型': '约定',
  '强度': NEW_STRENGTH,
  '重要度': NEW_IMPORTANCE,
  '首次': '2026-11-07T00:00:00.000Z',
  '上次': '2026-11-07T00:00:00.000Z',
  '提起': 0,
  '证据': 0,
  '来源': ['网页:2026-11-07#2240'],
  '状态': 'active',
  '被取代': '',
  body: '主人说过：问题从根上修，别只打补丁。\n\n为什么值得记：以后想省事打补丁时，得先看见这条。',
  ...over,
})

// ---- 半衰期
check('重要度 1 → 14 天', () => assert.equal(halfLifeDays(1), 14))
check('重要度 3 → 42 天', () => assert.equal(halfLifeDays(3), 42))
check('重要度 5 → 70 天', () => assert.equal(halfLifeDays(5), 70))
check('重要度越界会被夹住', () => {
  assert.equal(halfLifeDays(0), 14)
  assert.equal(halfLifeDays(99), 70)
  assert.equal(halfLifeDays('x'), 42)
})

// ---- 衰减
check('0 天不动', () => assert.equal(settleStrength(40, 0, 3), 40))
check('一个半衰期掉一半', () => {
  assert.equal(settleStrength(100, 14, 1), 50)
  assert.equal(settleStrength(100, 70, 5), 50)
})
check('重要度 3、30 天：落到模糊', () => {
  const s = settleStrength(NEW_STRENGTH, 30, 3)
  assert.ok(s > 24 && s < 25.5, `实际 ${s}`)
  assert.equal(clarityOf(s), '模糊')
})
check('重要度 3、90 天：只剩印象', () => {
  const s = settleStrength(NEW_STRENGTH, 90, 3)
  assert.ok(s >= 6 && s < 12, `实际 ${s}`)
  assert.equal(clarityOf(s), '只剩印象')
})
check('重要度 5、90 天：还在模糊', () => {
  const s = settleStrength(NEW_STRENGTH, 90, 5)
  assert.equal(clarityOf(s), '模糊')
})
check('地板 3，永不归零', () => {
  assert.equal(settleStrength(10, 100000, 1), FLOOR)
  assert.equal(settleStrength(3, 100000, 1), FLOOR)
})
check('上限 95', () => assert.equal(settleStrength(200, 0, 1), CAP))
check('负天数不倒扣', () => assert.equal(settleStrength(40, -5, 3), 40))
check('单调不涨', () => {
  let prev = 100
  for (let d = 1; d <= 30; d += 1) {
    const now = settleStrength(100, d, 2)
    assert.ok(now <= prev + 1e-9, `第 ${d} 天涨了`)
    prev = now
  }
})

// ---- 回血
check('回血按证据夹，最多五条', () => {
  assert.equal(reinforce(40, 0), 55)
  assert.equal(reinforce(40, 1), 40 + 60 * 0.3)
  assert.equal(reinforce(40, 5), 70)
  assert.equal(reinforce(40, 99), 70)
})
check('回血不超 95', () => assert.equal(reinforce(94, 5), CAP))
check('回血对沉底的最好使', () => {
  const lifted = reinforce(FLOOR, 3)
  assert.ok(lifted > 20, `从地板拉回来只有 ${lifted}`)
})

// ---- 档位
check('档位边界', () => {
  assert.equal(clarityOf(45), '清晰')
  assert.equal(clarityOf(44.9), '清楚')
  assert.equal(clarityOf(25), '清楚')
  assert.equal(clarityOf(24.9), '模糊')
  assert.equal(clarityOf(12), '模糊')
  assert.equal(clarityOf(11.9), '只剩印象')
  assert.equal(clarityOf(6), '只剩印象')
  assert.equal(clarityOf(5.9), '沉底')
  assert.equal(clarityOf(0), '沉底')
})

// ---- 注入门槛
check('够 12 就能进', () => assert.equal(injectable(base({ '强度': 12, '重要度': 1 })), true))
check('重要的地板低一档', () => {
  assert.equal(injectable(base({ '强度': 7, '重要度': 5 })), true)
  assert.equal(injectable(base({ '强度': 11, '重要度': 4 })), false)
})
check('沉底的谁都不进', () => assert.equal(injectable(base({ '强度': 3, '重要度': 5 })), false))

// ---- 结算
check('结算不改入参', () => {
  const record = base()
  settleRecord(record, new Date('2026-11-21T00:00:00Z'))
  assert.equal(record['强度'], NEW_STRENGTH)
})
check('结算到快睡着时标 dormant，文件不删', () => {
  const settled = settleRecord(base(), new Date('2027-06-01T00:00:00Z'))
  assert.equal(settled['强度'], FLOOR)
  assert.equal(settled['状态'], 'dormant')
  assert.equal(settled.body, base().body)
})
check('全量结算不再搬去冷却', () => {
  const out = settleAll([base({ id: 'a' }), base({ id: 'b' })], new Date('2026-11-10T00:00:00Z'))
  assert.equal(out.records.length, 2, '一条都不许丢')
  assert.equal(out.cooled.length, 0)
  assert.ok(out.touched >= 1)
})
check('ids 只结算点名的', () => {
  const out = settleAll([base({ id: 'a' }), base({ id: 'b' })], new Date('2026-12-07T00:00:00Z'), ['a'])
  const byId = Object.fromEntries(out.records.map((r) => [r.id, r]))
  assert.equal(byId.b['强度'], NEW_STRENGTH, 'b 没被点名，原样留着')
  assert.ok(byId.a['强度'] < NEW_STRENGTH)
})
check('空输入不炸', () => {
  const out = settleAll([], new Date())
  assert.deepEqual(out.records, [])
})

// ---- 天数
check('天数按 24 小时算', () => {
  assert.equal(daysBetween('2026-11-01T00:00:00Z', '2026-11-03T00:00:00Z'), 2)
  assert.equal(daysBetween('bad', '2026-11-03T00:00:00Z'), 0)
})

// ---- 「被取代」是人判的，不是算出来的（自查，2026-11-09）
// 以前 settleRecord 无条件重算 active/dormant，把人工标的「被取代」每轮冲掉，
// 视图里复活 → 召回和注入照收；按下结算更狠，永久写没。
check('结算不许把「被取代」冲成 active', () => {
  const record = base({ '状态': '被取代', '被取代': 'm-20261107-9999', '强度': 80 })
  const settled = settleRecord(record, new Date('2026-11-20T00:00:00Z'))
  assert.equal(settled['状态'], '被取代', '人判过的状态不许被算回去')
  assert.equal(settled['被取代'], 'm-20261107-9999', '被谁取代也得留着')
})

check('全量结算也不许复活被取代的', () => {
  const records = [base({ id: 'a' }), base({ id: 'b', '状态': '被取代', '被取代': 'a', '强度': 80 })]
  const out = settleAll(records, new Date('2026-11-20T00:00:00Z'))
  assert.equal(out.records.find((r) => r.id === 'b')['状态'], '被取代')
  assert.ok(!out.dormant || out.dormant >= 0)
})

check('没被判过的记录，state 照旧按强度算（别把正常路径也冻住）', () => {
  const old = settleRecord(base({ '强度': 40, '重要度': 1 }), new Date('2027-01-01T00:00:00Z'))
  assert.equal(old['状态'], 'dormant', '淡到 6 以下还是要沉底')
  const fresh = settleRecord(base({ '强度': 40, '重要度': 3 }), new Date('2026-11-07T01:00:00Z'))
  assert.equal(fresh['状态'], 'active')
})

// ---- 措辞
check('清晰给正文', () => {
  const text = phraseFor(base({ '强度': 60 }))
  assert.ok(text.startsWith('主人说过'))
  assert.ok(!text.includes('模糊'))
})
check('清楚只给上半句', () => {
  const long = '这是一条相当长的记忆正文，长到超过三十个字，用来测试清楚档会不会被截断而且截得干净。\n\n为什么值得记：测试。'
  const text = phraseFor(base({ '强度': 30, body: long }))
  assert.ok(text.endsWith('…'), text)
  assert.ok(text.length <= 31)
})
check('模糊给短名加标注', () => {
  assert.equal(phraseFor(base({ '强度': 20 })), '修根不打补丁（有点模糊）')
})
check('只剩印象只给名字', () => {
  const text = phraseFor(base({ '强度': 8 }))
  assert.equal(text, '修根不打补丁（只剩印象）')
  assert.ok(!text.includes('补丁会烂'))
})
check('沉底什么都不说', () => assert.equal(phraseFor(base({ '强度': 5 })), ''))
check('短名优先用「名」字段', () => {
  assert.equal(shortName(base({ '名': '密文' }), 10), '密文')
})
check('没名就从正文截', () => {
  assert.equal(shortName({ body: '一段没有名字的正文内容' }, 6), '一段没有名字…')
})

// ---- 正文那层壳不许漏进注入（自查，2026-11-09）
// 写记忆时正文第一行习惯写「看见了什么：…」，那是给自己看的标签。
// 注入里曾经原样带出来：「看见了什么：主人说，小蓝的构成是…」——白占地方，还像半句话。
check('清晰档不露出「看见了什么：」这层壳', () => {
  const text = phraseFor(base({ '强度': 60, body: '看见了什么：主人说，小蓝是记忆构成的。\n\n为什么值得记：这是定义。' }))
  assert.ok(!text.includes('看见了什么'), text)
  assert.ok(text.startsWith('主人说'), text)
})

check('清楚档也不露', () => {
  const body = '看见了什么：' + '主人说了一句相当长的话，长到超过三十个字会被截断，但壳不能留在前面。' + '\n\n为什么值得记：测试。'
  const text = phraseFor(base({ '强度': 30, body }))
  assert.ok(!text.includes('看见了什么'), text)
  assert.ok(text.startsWith('主人说'), text)
})

check('没有「名」时分不清时，短名兜底也不露壳', () => {
  const text = shortName({ body: '看见了什么：短短一句正文。' }, 8)
  assert.ok(!text.includes('看见了什么'), text)
  assert.equal(text, '短短一句正文。')
})

console.log(`\n结算测试：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
