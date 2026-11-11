import assert from "node:assert/strict"
import { promotableTraits, TRAIT_MIN_DAYS, TRAIT_MIN_MENTIONS } from "../src/core/judge.js"

let passed = 0
let failed = 0
const check = (name, fn) => {
  try { fn(); passed += 1 } catch (e) { failed += 1; console.error("FAIL", name, "—", e.message) }
}

const NOW = new Date("2026-11-10T22:00:00+08:00")
const trait = (id, first, mentions, status = "active") => ({
  id, "名": id, "类型": "脾性", "状态": status, "首次": first, "提起": mentions,
})

check("门槛：7 天 + 露出 2 次", () => {
  assert.equal(TRAIT_MIN_DAYS, 7)
  assert.equal(TRAIT_MIN_MENTIONS, 2)
})

check("刚写的脾性不够格（活不满 7 天）", () => {
  assert.equal(promotableTraits([trait("a", "2026-11-08", 5)], NOW).length, 0)
})

check("够 7 天但只露 1 次 → 还不够", () => {
  assert.equal(promotableTraits([trait("b", "2026-10-01", 1)], NOW).length, 0)
})

check("够 7 天且露 2 次 → 升", () => {
  assert.equal(promotableTraits([trait("c", "2026-10-01", 2)], NOW).length, 1)
})

check("已内化的不再重复提示", () => {
  assert.equal(promotableTraits([trait("d", "2026-10-01", 9, "已内化")], NOW).length, 0)
})

check("不是脾性的不参与", () => {
  const other = { id: "e", "名": "e", "类型": "要求", "状态": "active", "首次": "2026-10-01", "提起": 9 }
  assert.equal(promotableTraits([other], NOW).length, 0)
})

check("没日期的脾性不会误升", () => {
  assert.equal(promotableTraits([trait("f", "", 9)], NOW).length, 0)
})

console.log(`脾性晋升 ${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
