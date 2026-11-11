import assert from "node:assert/strict"
import { guessArea, AREAS } from "../src/core/area.js"
import { recall, AREA_BOOST } from "../src/core/recall.js"

let passed = 0
let failed = 0
const check = (name, fn) => {
  try { fn(); passed += 1 } catch (e) { failed += 1; console.error("FAIL", name, "—", e.message) }
}

check("五个领域", () => assert.deepEqual(AREAS, ["核", "绘图", "QQ", "桌面", "生活"]))
check("问绘图 → 绘图", () => assert.equal(guessArea("千问的 denoise 设多少"), "绘图"))
check("问 QQ → QQ", () => assert.equal(guessArea("QQ 桥接怎么装"), "QQ"))
check("问核 → 核", () => assert.equal(guessArea("记忆注入预算多少"), "核"))
check("问生活 → 生活", () => assert.equal(guessArea("今晚吃火锅吗"), "生活"))
check("没线索就不猜", () => assert.equal(guessArea("嗯"), ""))
check("领域加成分很小", () => assert.ok(AREA_BOOST > 0 && AREA_BOOST <= 0.1))

const rec = (id, area, name) => ({
  id, "名": name, "别名": [], "类型": "事实", "强度": 60, "重要度": 3,
  "首次": "2026-11-09", "上次": "2026-11-09", "提起": 0, "证据": 1, "整理": "",
  "来源": ["测试"], "状态": "active", "被取代": "", "有效到": "", "计划": "", "完成": "",
  "关于": "", "领域": area, body: name + "\n\n为什么值得记：测试。\n",
})

check("同领域的那条会被抬上来", () => {
  const a = rec("a", "绘图", "图片参数基线")
  const b = rec("b", "QQ", "图片参数基线")
  const hits = recall({ records: [b, a], query: "图片参数设多少", now: new Date("2026-11-10T12:00:00+08:00"), limit: 2 })
  assert.equal(hits[0].record.id, "a", "问绘图该先出绘图那条")
})

console.log(`领域 ${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
