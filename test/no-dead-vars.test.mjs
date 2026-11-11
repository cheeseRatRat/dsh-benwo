/**
 * 死变量不许复活（B7，2026-11-09）。
 *
 * `experienceHint` 曾被赋值三次，三次都是空串（index.js 550/554/992），
 * 所以注入里那行 `- 有关经验：…` 永远不会出现——工坊「自动提示」从来没有工作过。
 * 已经删掉。这个测试防止它被谁「顺手加回来」还以为是接上了。
 *
 * 顺带锁住 A2 的同一条纪律：注入的两段各管一种稳定性。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const src = fs.readFileSync(path.join(repo, 'index.js'), 'utf8')

check('index.js 里没有 experienceHint 的赋值了', () => {
  const assignments = src.match(/experienceHint\s*=/g) || []
  assert.equal(assignments.length, 0, '还在赋值——那它要么是死变量，要么该改成真数据源')
})

check('没有把死变量当参数塞进 buildMemoryBlock', () => {
  assert.ok(!/experience:\s*experienceHint/.test(src), '又把空变量传进去了')
})

check('工坊的常驻确实还在接（别把有用的也删了）', () => {
  assert.ok(src.includes('pinnedHint'), '常驻列表不见了')
  assert.ok(src.includes("exp['常驻']"), '找不到「常驻」的筛选')
})

check('人格段与记忆段的稳定性分工还在（A2）', () => {
  assert.ok(src.includes('buildPersonaBlock'), '人格段应该走 buildPersonaBlock')
  assert.ok(src.includes('status: statusLine'), '会变的状态应该走记忆段的 status')
})

console.log(`死变量不许复活 ${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
