import assert from "node:assert/strict"
import os from "node:os"
import path from "node:path"
import fsp from "node:fs/promises"
import { findConflicts } from "../src/core/conflict.js"
import { layout, writeRecord, readAllRecords } from "../src/core/store.js"

let passed = 0
let failed = 0
const check = async (name, fn) => {
  try { await fn(); passed += 1 } catch (e) { failed += 1; console.error("FAIL", name, "—", e.message) }
}

const req = (id, name, body = "", status = "active") => ({
  id, "名": name, "别名": [], "类型": "要求", "强度": 60, "重要度": 4,
  "首次": "2026-11-01", "上次": "2026-11-01", "提起": 0, "证据": 1, "整理": "",
  "来源": ["测试"], "状态": status, "被取代": "", "有效到": "", "计划": "", "完成": "", "关于": "",
  body: (body || name) + "\n\n为什么值得记：测试。\n",
})

await check("一正一反、共同词够 → 报一对", () => {
  const a = req("a", "出图直接给图片不读图", "每次出图直接把图片给我，不要读图。")
  const b = req("b", "出图前先读图再给", "出图前先读图，看完再给图片。")
  const pairs = findConflicts([a, b])
  assert.equal(pairs.length, 1, "该报一对，实际 " + pairs.length)
  assert.ok(pairs[0].shared.length >= 2)
})

await check("都是否定 → 不算打架", () => {
  const a = req("a", "别读图", "不要读图。")
  const b = req("b", "别截图", "不用截图。")
  const key = (x) => /不要|不用|别|不许|取消|禁止/.test(x["名"] + x.body)
  assert.equal(key(a) === key(b), true, "两条都带否定，检测器会跳过")
  assert.equal(findConflicts([a, b]).length, 0)
})

await check("共同词不够 → 不报（避免噪音）", () => {
  const a = req("a", "打包前先问", "每次打包先问你。")
  const b = req("b", "别用子代理生图", "不要开子代理去生图。")
  assert.equal(findConflicts([a, b]).length, 0)
})

await check("非要求类型不参与", () => {
  const a = { ...req("a", "出图直接给图片不读图"), "类型": "事实" }
  const b = req("b", "出图前先读图再给")
  assert.equal(findConflicts([a, b]).length, 0)
})

await check("已内化 / 作废 的不参与", () => {
  const a = req("a", "出图直接给图片不读图", "", "已内化")
  const b = req("b", "出图前先读图再给")
  assert.equal(findConflicts([a, b]).length, 0)
})

await check("名字和模板标签不当共同词（2026-11-11 修）", () => {
  const a = req("a", "在场规矩：默认不在", "看见了什么：2026-11-10 夜，主人说默认不在场，认领才在。")
  const b = req("b", "别空转硬想", "看见了什么：2026-11-10 夜，主人说别空转硬想，缺东西直接问。")
  assert.equal(findConflicts([a, b]).length, 0, "只共享名字和模板标签，不该报嫌疑")
})

await check("「关于」字段存得住、读得回", async () => {
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), "benwo-about-"))
  const L = layout(tmp)
  await fsp.mkdir(L.long, { recursive: true })
  await writeRecord(L, { ...req("x", "叫小笨蛋＝做了笨事"), "类型": "事实", "关于": "我们" })
  const { records } = await readAllRecords(L)
  assert.equal(records.find((r) => r.id === "x")["关于"], "我们")
  await fsp.rm(tmp, { recursive: true, force: true })
})

console.log(`矛盾检测与关于 ${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
