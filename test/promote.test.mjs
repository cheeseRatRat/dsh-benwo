/**
 * 升长期的门，2026-11-08 改成两路：
 *   事实 / 约定 / 事件 —— 明说或确实发生的，重要度 ≥3 当场就立。
 *   偏好 / 感受        —— 从表现里读出来的，要 ≥2 次且跨 ≥2 天。
 *
 * 改这个的原因：主人在 11-08 指出「我们工作的事件这种事一般都是一天内搞定」。
 * 一刀切要求跨两天，等于一天做完的事永远进不了长期——那是设计漏洞，不是严谨。
 */
import assert from 'node:assert/strict'
import {
  canPromote,
  DIRECT_KINDS,
  INFERRED_KINDS,
  DIRECT_IMPORTANCE_MIN,
  EVIDENCE_MIN,
  EVIDENCE_SPAN_DAYS,
} from '../src/core/judge.js'
import { KINDS } from '../src/core/store.js'

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

check('两类分得清，加起来是八种类型（2026-11-10 拆分）', () => {
  assert.deepEqual(DIRECT_KINDS, ['事实', '约定', '愿望', '要求', '事件', '计划', '预期'])
  assert.deepEqual(INFERRED_KINDS, ['脾性'])
  assert.equal(DIRECT_KINDS.length + INFERRED_KINDS.length, 8)
  assert.deepEqual([...DIRECT_KINDS, ...INFERRED_KINDS].sort(), [...KINDS].sort(), '判官和存储的类型名单必须一致')
  assert.equal(DIRECT_IMPORTANCE_MIN, 3)
})

check('事件：当天做完，重要度 3 就当场进长期', () => {
  const out = canPromote({ kind: '事件', importance: 3, evidence: 1, firstDay: '2026-11-08', today: '2026-11-08' })
  assert.equal(out.ok, true, out.reason)
})

check('事实、约定同样当场立', () => {
  for (const kind of ['事实', '约定']) {
    const out = canPromote({ kind, importance: 4, evidence: 1, firstDay: '2026-11-08', today: '2026-11-08' })
    assert.equal(out.ok, true, `${kind}: ${out.reason}`)
  }
})

check('事件但分量不够：拦住，并说清怎么办', () => {
  const out = canPromote({ kind: '事件', importance: 2, evidence: 1, firstDay: '2026-11-08', today: '2026-11-08' })
  assert.equal(out.ok, false)
  assert.match(out.reason, /分量不够/)
})

check('换条路也行：事件分量不够但独立提过两次、跨两天', () => {
  const out = canPromote({ kind: '事件', importance: 2, evidence: 2, firstDay: '2026-11-06', today: '2026-11-08' })
  assert.equal(out.ok, true, out.reason)
})

check('偏好：重要度再高，当天一次也不算数', () => {
  const out = canPromote({ kind: '偏好', importance: 5, evidence: 1, firstDay: '2026-11-08', today: '2026-11-08' })
  assert.equal(out.ok, false)
  assert.match(out.reason, /一次不算数/)
})

check('感受：同一天提五次还是不算', () => {
  const out = canPromote({ kind: '感受', importance: 5, evidence: 5, firstDay: '2026-11-08', today: '2026-11-08' })
  assert.equal(out.ok, false)
  assert.match(out.reason, /要跨/)
})

check('偏好：跨两天、两次，才放行', () => {
  const out = canPromote({ kind: '偏好', importance: 2, evidence: EVIDENCE_MIN, firstDay: '2026-11-05', today: '2026-11-08' })
  assert.equal(out.ok, true, out.reason)
  assert.ok(EVIDENCE_SPAN_DAYS >= 2)
})

check('不传 kind 时走老规矩（向后兼容）', () => {
  assert.equal(
    canPromote({ evidence: 2, firstDay: '2026-11-05', today: '2026-11-07' }).ok,
    true,
  )
  assert.equal(
    canPromote({ evidence: 5, firstDay: '2026-11-07', today: '2026-11-07' }).ok,
    false,
  )
  assert.equal(
    canPromote({ evidence: 1, firstDay: '2026-11-01', today: '2026-11-07' }).ok,
    false,
  )
})

check('日期读不出来要拒，不能默默放行', () => {
  const out = canPromote({ kind: '偏好', evidence: 3, firstDay: '不是日期', today: '2026-11-08' })
  assert.equal(out.ok, false)
  assert.match(out.reason, /日期读不出来/)
})

console.log(`升长期两道门 ${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
