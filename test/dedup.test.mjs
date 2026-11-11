/**
 * 写前复查（A3，2026-11-09）。
 *
 * 这个测试记录的是一条**被实测否定过的方案**：
 * 原本打算用 Jaccard 阈值自动判重，实测发现——真重复的那一对只有 0.196，
 * 而不相干的两条（都含「主人」）能到 0.659。
 *
 * 所以现在的契约是：
 *   1. 只有几乎逐字相同（Jaccard ≥ 0.9）才硬拦；
 *   2. 其余只排「最像的几条」回去，判断权归人；
 *   3. 真正的去重手段是写的时候填 supersede。
 * 谁想把阈值硬拦加回来，先去看 judge.js 里那段注释。
 */
import assert from 'node:assert/strict'
import { findSimilar, DUP_BLOCK, DUP_HINT_TOP, DUP_HINT_MIN } from '../src/core/judge.js'

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

const rec = (id, name, body, extra = {}) => ({ id, 名: name, body, 状态: 'active', ...extra })

const pool = [
  rec('m-a', '这个窗口只管修 ComfyUI 生图', '主人说这个窗口以后专门修 comfyui 的修图问题，画图要去千问生图那边做。'),
  rec('m-b', '绘图去另一个工作区，这里只修', '主人说除了测试其他时间绘图都去另一个工作区画，这个窗口留给修 ComfyUI 的问题。'),
  rec('m-c', '喜欢小蓝，小蓝最好', '主人喜欢小蓝，觉得小蓝最好。为什么值得记：这是她的心意。'),
  rec('m-d', '同时最多开 5 个子代理', '主人规定小蓝同时最多开 5 个子代理，超过要先问过主人。'),
]

check('逐字相同：判为 same，可以硬拦', () => {
  const hits = findSimilar(pool, '这个窗口只管修 ComfyUI 生图 主人说这个窗口以后专门修 comfyui 的修图问题，画图要去千问生图那边做。')
  assert.ok(hits.length > 0)
  assert.equal(hits[0].record.id, 'm-a')
  assert.equal(hits[0].same, true, '几乎逐字相同应判 same')
  assert.ok(hits[0].score >= DUP_BLOCK)
})

check('换个说法：不判 same，但能排上来（这才是要人看一眼的情况）', () => {
  const hits = findSimilar(pool, '除了测试，画图我都去另一个工作区；这个窗口只修 ComfyUI 的毛病')
  assert.ok(hits.length > 0, '应该排得出候选')
  assert.equal(hits.some((hit) => hit.same), false, '不能硬拦——措辞不同，硬拦会误伤')
  assert.ok(hits.some((hit) => hit.record.id === 'm-b'), '应当把 m-b 排进来')
})

check('不相干的不许挤进前三（高频词不能主导）', () => {
  const hits = findSimilar(pool, '今天装了个生图插件，画图能本地跑不用联网')
  const ids = hits.map((hit) => hit.record.id)
  assert.ok(!ids.includes('m-c') || hits.find((h) => h.record.id === 'm-c').score < 0.5, '「喜欢小蓝」那条不该高居榜首')
})

check('被取代的不进候选', () => {
  const withDead = pool.concat([rec('m-x', '这个窗口只管修 ComfyUI 生图', '同样的正文', { 状态: '被取代' })])
  const hits = findSimilar(withDead, '这个窗口只管修 ComfyUI 生图')
  assert.ok(!hits.some((hit) => hit.record.id === 'm-x'), '被取代的旧版不该再碍事')
})

check('空文本不返回垃圾', () => {
  assert.deepEqual(findSimilar(pool, ''), [])
  assert.deepEqual(findSimilar(pool, '   '), [])
})

check('空库不炸', () => {
  assert.deepEqual(findSimilar([], '随便什么'), [])
})

check('最多给三条，且按分数降序', () => {
  const many = Array.from({ length: 10 }, (_, i) => rec('m-' + i, '修 ComfyUI 的问题', '这个窗口修 comfyui 的毛病'))
  const hits = findSimilar(many, '这个窗口修 ComfyUI 的毛病')
  assert.ok(hits.length <= DUP_HINT_TOP)
  for (let i = 1; i < hits.length; i += 1) assert.ok(hits[i - 1].score >= hits[i].score)
})

check('低于提示下限的不返回（别拿一堆无关的烦人）', () => {
  const hits = findSimilar(pool, '量子色动力学的渐近自由')
  assert.ok(hits.every((hit) => hit.score >= DUP_HINT_MIN))
})

console.log(`写前复查 ${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
