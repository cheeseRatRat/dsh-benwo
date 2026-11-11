import assert from 'node:assert/strict'
import {
  pending,
  organizeWeight,
  shouldOrganize,
  mergeDuplicates,
  applyMerges,
  buildReflection,
  markOrganized,
  ORGANIZE_THRESHOLD,
  ORGANIZE_MAX_PER_DAY,
} from '../src/core/organize.js'

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

const rec = (over = {}) => ({
  id: 'm1',
  '名': '修根不打补丁',
  '类型': '约定',
  '强度': 40,
  '重要度': 3,
  '证据': 2,
  '整理': '',
  '状态': 'active',
  '被取代': '',
  body: '问题从根上修，别只打补丁。\n\n为什么值得记：以后想省事的时候先看见这条。',
  ...over,
})

check('整理过的就不算未巩固', () => {
  const out = pending([rec({ id: 'a' }), rec({ id: 'b', '整理': '2026-11-07T00:00:00Z' })])
  assert.equal(out.length, 1)
  assert.equal(out[0].id, 'a')
})
check('被取代的不算未巩固', () => {
  assert.equal(pending([rec({ '状态': '被取代' })]).length, 0)
})
check('攒够 25 才动', () => {
  const five = Array.from({ length: 5 }, (_, i) => rec({ id: 'm' + i, '重要度': 5 }))
  assert.equal(organizeWeight(five), 25)
  assert.equal(shouldOrganize(five).ok, true)
})
check('不够就不动，并说还差多少', () => {
  const three = Array.from({ length: 3 }, (_, i) => rec({ id: 'm' + i, '重要度': 3 }))
  const out = shouldOrganize(three)
  assert.equal(out.ok, false)
  assert.ok(out.reason.includes(String(ORGANIZE_THRESHOLD - 9)), out.reason)
})
check('一天最多两次', () => {
  const five = Array.from({ length: 5 }, (_, i) => rec({ id: 'm' + i, '重要度': 5 }))
  const out = shouldOrganize(five, ORGANIZE_MAX_PER_DAY)
  assert.equal(out.ok, false)
  assert.ok(out.reason.includes('上限'))
})
check('还没到上限还能动', () => {
  const five = Array.from({ length: 5 }, (_, i) => rec({ id: 'm' + i, '重要度': 5 }))
  assert.equal(shouldOrganize(five, ORGANIZE_MAX_PER_DAY - 1).ok, true)
})

// ---- 合并重复
check('几乎一样的合成一条', () => {
  const a = rec({ id: 'a', '证据': 2, '强度': 50 })
  const b = rec({ id: 'b', '证据': 1, '强度': 40 })
  const { survivorOf, replaced } = mergeDuplicates([a, b])
  assert.equal(replaced.length, 1)
  assert.equal(survivorOf.get('b'), 'a', '留证据多的那条')
})
check('只像一半的不合并', () => {
  const a = rec({ id: 'a', body: '问题从根上修。\n\n为什么值得记：测试。' })
  const b = rec({ id: 'b', body: '主人喜欢大白饭。\n\n为什么值得记：测试。' })
  const { replaced } = mergeDuplicates([a, b])
  assert.equal(replaced.length, 0)
})
check('合并后旧的标被取代，正文不动', () => {
  const a = rec({ id: 'a', '证据': 2 })
  const b = rec({ id: 'b', '证据': 1 })
  const { survivorOf } = mergeDuplicates([a, b])
  const after = applyMerges([a, b], survivorOf, new Date('2026-11-07T00:00:00Z'))
  const bAfter = after.find((r) => r.id === 'b')
  assert.equal(bAfter['状态'], '被取代')
  assert.equal(bAfter['被取代'], 'a')
  assert.equal(bAfter.body, b.body, '一个字都不许改')
})

// ---- 反思
check('反思带绝对日期', () => {
  const { text } = buildReflection([rec()], new Date('2026-11-07T12:00:00Z'))
  assert.ok(text.includes('2026-11-07'))
  assert.ok(!text.includes('今天'))
})
check('反思带证据编号', () => {
  const batch = [rec({ id: 'm-aaa', '重要度': 5 }), rec({ id: 'm-bbb', '重要度': 4 })]
  const { text, evidence } = buildReflection(batch, new Date('2026-11-07T12:00:00Z'))
  assert.deepEqual(evidence.sort(), ['m-aaa', 'm-bbb'])
  assert.ok(text.includes('m-aaa'))
  assert.ok(text.includes('m-bbb'))
  assert.ok(text.includes('证据：'))
})
check('没东西可整理就不写反思', () => {
  const { text, evidence } = buildReflection([])
  assert.equal(text, '')
  assert.equal(evidence.length, 0)
})
check('整理过的打上时间戳', () => {
  const after = markOrganized([rec({ id: 'a' }), rec({ id: 'b' })], ['a'], new Date('2026-11-07T12:00:00Z'))
  assert.ok(after[0]['整理'])
  assert.equal(after[1]['整理'], '')
})
check('打完之后权重归零', () => {
  const five = Array.from({ length: 5 }, (_, i) => rec({ id: 'm' + i, '重要度': 5 }))
  const after = markOrganized(five, five.map((r) => r.id))
  assert.equal(organizeWeight(after), 0)
})

console.log(`\n整理测试：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
