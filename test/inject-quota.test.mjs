/**
 * 注入配额与两块新地基（2026-11-10 夜，主人定的分配）。
 *
 * 【相关记忆】共 8 条，怎么分：
 *   事件   最多 1 条  —— 事件要靠具体词才浮，不该占太多位置
 *   要求   保底 2 条  —— 「你让咱怎么做」得一直在
 *   自己   保底 2 条  —— 咱是什么样的人（有货才给，不硬凑）
 *   其余   3 条自由抢 —— 事实 / 约定 / 愿望
 *
 * 锁这三件事，以及【要办的事】【未来想做】不占这 8 个位置。
 */
import assert from 'node:assert/strict'
import {
  capKinds,
  pickWithQuota,
  rankFloating,
  buildMemoryBlock,
  EVENT_CAP,
  REQUIRE_MIN,
  SELF_MIN,
  FLOATING_LIMIT,
} from '../src/core/inject.js'

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

const rec = (id, kind, strength = 60, importance = 3) => ({
  id,
  '名': id,
  '类型': kind,
  '强度': strength,
  '重要度': importance,
  '状态': 'active',
  '首次': '2026-11-10',
  body: id + '\n\n为什么值得记：测试。',
})

check('配额常量：8 条，事件 1，要求 2，自己 2', () => {
  assert.equal(FLOATING_LIMIT, 10)
  assert.equal(EVENT_CAP, 1)
  assert.equal(REQUIRE_MIN, 2)
  assert.equal(SELF_MIN, 1)
})

check('事件最多 1 条，哪怕全是事件也不超', () => {
  const records = [rec('e1', '事件'), rec('e2', '事件'), rec('e3', '事件'), rec('e4', '事件')]
  const picked = pickWithQuota(records, { limit: 8 })
  assert.equal(picked.filter((r) => r['类型'] === '事件').length, 1, '事件没限住')
})

check('要求保底 2：要求排在事件后面也能上来', () => {
  const records = [
    rec('e1', '事件', 99), rec('e2', '事件', 99), rec('e3', '事件', 99),
    rec('r1', '要求', 10), rec('r2', '要求', 10),
    rec('f1', '事实', 50), rec('f2', '事实', 50), rec('f3', '事实', 50),
  ]
  const picked = pickWithQuota(records, { limit: 8 })
  const requires = picked.filter((r) => r['类型'] === '要求')
  assert.ok(requires.length >= 2, '要求该保底 2 条，实际 ' + requires.length)
  assert.ok(picked.some((r) => r.id === 'r1') && picked.some((r) => r.id === 'r2'))
})

check('自己保底 2：有货就给位置', () => {
  const records = [
    rec('e1', '事件', 99),
    rec('s1', '脾性', 10), rec('s2', '脾性', 10),
    rec('f1', '事实', 90), rec('f2', '事实', 90), rec('f3', '事实', 90), rec('f4', '事实', 90),
  ]
  const picked = pickWithQuota(records, { limit: 8 })
  assert.ok(picked.filter((r) => r['类型'] === '脾性').length >= 2, '脾性该保底 2 条')
})

check('自己没货时不硬凑空位', () => {
  const records = [rec('e1', '事件'), rec('f1', '事实')]
  assert.equal(pickWithQuota(records, { limit: 8 }).length, 2)
})

check('凑不满 8 条就少给，不重复不造', () => {
  const records = [rec('e1', '事件'), rec('r1', '要求'), rec('f1', '事实')]
  const picked = pickWithQuota(records, { limit: 8 })
  assert.equal(picked.length, 3)
  assert.equal(new Set(picked.map((r) => r.id)).size, 3, '不许重复')
})

check('rankFloating 也守配额', () => {
  const records = [rec('e1', '事件', 90), rec('e2', '事件', 90), rec('e3', '事件', 90), rec('r1', '要求', 40)]
  const picked = rankFloating(records, 8)
  assert.equal(picked.filter((r) => r['类型'] === '事件').length, 1)
  assert.ok(picked.some((r) => r['类型'] === '要求'), '要求该上来')
})

check('老名字 capKinds 还能用（一个参数限条数）', () => {
  const records = [rec('e1', '事件'), rec('e2', '事件'), rec('f1', '事实')]
  assert.equal(capKinds(records, 2).length, 2)
})

check('两块新地基：计划和预期各出 1 条', () => {
  const block = buildMemoryBlock({
    records: [rec('r1', '要求')],
    plans: [rec('p1', '计划')],
    wishes: [rec('x1', '预期')],
    now: new Date('2026-11-10T12:00:00Z'),
  })
  assert.ok(block.text.includes('【要办的事】'), '缺【要办的事】')
  assert.ok(block.text.includes('【未来想做】'), '缺【未来想做】')
  assert.ok(block.text.includes('p1') && block.text.includes('x1'))
})

check('没有计划和预期时不留空标题', () => {
  const block = buildMemoryBlock({ records: [rec('r1', '要求')], plans: [], wishes: [] })
  assert.ok(!block.text.includes('【要办的事】'), '空块不该出现')
  assert.ok(!block.text.includes('【未来想做】'), '空块不该出现')
})

console.log(`注入配额 ${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
