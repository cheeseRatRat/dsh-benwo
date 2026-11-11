import assert from 'node:assert/strict'
import {
  validateDraft,
  importanceFor,
  canPromote,
  splitWhy,
  composeBody,
  WHY_MARKER,
  DAILY_WRITE_LIMIT,
  LONG_PER_TURN,
} from '../src/core/judge.js'

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

const draft = (over = {}) => ({
  '名': '修根不打补丁',
  '类型': '约定',
  '来源': ['网页:2026-11-07#2240'],
  body: composeBody('主人说过：问题从根上修，别只打补丁。', '以后想省事打补丁时，得先看见这条。'),
  ...over,
})

// ---- 硬闸数量
check('每轮只能写一条长期', () => assert.equal(LONG_PER_TURN, 1))
check('每天合计最多十二条', () => assert.equal(DAILY_WRITE_LIMIT, 12))

// ---- 为什么
check('正文里必须能找到「为什么」', () => {
  const { detail, why } = splitWhy(composeBody('看见了什么', '为什么留'))
  assert.equal(detail, '看见了什么')
  assert.equal(why, '为什么留')
})
check('没有为什么就是残条', () => {
  const out = validateDraft(draft({ body: '主人说了一句话，没有为什么。' }))
  assert.equal(out.ok, false)
  assert.ok(out.errors.some((e) => e.includes(WHY_MARKER)))
})

// ---- 三样必写
check('齐了就能写', () => {
  const out = validateDraft(draft())
  assert.equal(out.ok, true, JSON.stringify(out.errors))
  assert.equal(out.record['名'], '修根不打补丁')
  assert.equal(out.record['类型'], '约定')
  assert.equal(out.record['强度'], 40)
  assert.equal(out.record['证据'], 0)
  assert.equal(out.record['状态'], 'active')
})
check('缺名字不行', () => {
  const out = validateDraft(draft({ '名': '' }))
  assert.equal(out.ok, false)
  assert.ok(out.errors.some((e) => e.includes('名')))
})
check('名字太长不行', () => {
  const out = validateDraft(draft({ '名': '一'.repeat(30) }))
  assert.equal(out.ok, false)
})
check('类型必须在枚举里', () => {
  const out = validateDraft(draft({ '类型': '心情' }))
  assert.equal(out.ok, false)
  assert.ok(out.errors.some((e) => e.includes('类型')))
})
check('没来源一律拒', () => {
  const out = validateDraft(draft({ '来源': [] }))
  assert.equal(out.ok, false)
})
check('正文太短不行', () => {
  const out = validateDraft(draft({ body: composeBody('嗯', '测试') }))
  assert.equal(out.ok, false)
})

// ---- 密钥
check('密钥直接拒，不落盘', () => {
  const out = validateDraft(draft({ body: composeBody('这里的 key 是 sk-abcdefghijklmnopqrstuvwx', '测试') }))
  assert.equal(out.ok, false)
  assert.ok(out.errors.some((e) => e.includes('密钥')))
})

// ---- 重要度
check('基准是 3', () => assert.equal(importanceFor({ text: '今天吃了饭', kind: '感受' }), 3))
check('明说记住 +1', () => assert.equal(importanceFor({ text: '你要记住这个', kind: '偏好' }), 4))
check('约定再 +1', () => assert.equal(importanceFor({ text: '以后都这样', kind: '约定' }), 5))
check('被纠正 +1', () => assert.equal(importanceFor({ text: '不是这样', kind: '事实', corrected: true }), 4))
check('一次性日常 -1', () => assert.equal(importanceFor({ text: '今天下雨了', kind: '事件' }), 2))
check('夹在 1 到 5', () => {
  assert.equal(importanceFor({ text: '记住，以后都这样，底线', kind: '约定', corrected: true }), 5)
  assert.equal(importanceFor({ text: '下雨', kind: '事件' }), 2)
})
check('写进记录时用的是算出来的值', () => {
  const out = validateDraft(draft({ body: composeBody('主人说以后都要这样', '记住') }))
  assert.equal(out.record['重要度'], 5)
})

// ---- 升长期
check('证据两条、跨两天，才许升', () => {
  assert.equal(canPromote({ evidence: 2, firstDay: '2026-11-05', today: '2026-11-07' }).ok, true)
})
check('同一天提五次不算证据', () => {
  const out = canPromote({ evidence: 5, firstDay: '2026-11-07', today: '2026-11-07' })
  assert.equal(out.ok, false)
  assert.ok(out.reason.includes('天'))
})
check('只有一条证据不行', () => {
  const out = canPromote({ evidence: 1, firstDay: '2026-11-01', today: '2026-11-07' })
  assert.equal(out.ok, false)
})

console.log(`\n写入闸门测试：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
