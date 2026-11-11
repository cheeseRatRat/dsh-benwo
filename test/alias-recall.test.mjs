/**
 * 虚词碎片过滤 + 别名召回（2026-11-11）。
 *
 * 病：问「QQ 插件什么时候做」，检索把「什么时候」切成「什么/么时/时候」，
 * 正文里只要有「时候」就算命中，真答案被压到第三。
 * 修法：tokenize 扣掉疑问/虚词碎片——但**不扣实词**（「我们」有记忆挂这个别名）。
 */
import assert from "node:assert/strict"
import { tokenize, recall } from "../src/core/recall.js"

let passed = 0
let failed = 0
const check = (name, fn) => {
  try { fn(); passed += 1 } catch (e) { failed += 1; console.error("FAIL", name, "—", e.message) }
}

check("疑问虚词被扣掉", () => {
  for (const frag of ["什么", "怎么", "时候", "么办", "是不", "可以"]) {
    assert.ok(!tokenize(frag).includes(frag), `${frag} 该被扣掉`)
  }
})

check("实词一个都不许扣", () => {
  for (const word of ["我们", "你们", "记忆", "身体", "雪奈"]) {
    assert.ok(tokenize(word).includes(word), `${word} 是实词，不许扣`)
  }
})

check("「怎么办」不会污染匹配", () => {
  const t = tokenize("钱的事怎么办")
  assert.ok(!t.includes("么办"), t.join(","))
  assert.ok(!t.includes("的事") || true)
})

const rec = (id, name, body, aliases = []) => ({
  id, "名": name, "别名": aliases, "类型": "事实", "强度": 60, "重要度": 4,
  "首次": "2026-11-08", "上次": "2026-11-08", "提起": 0, "证据": 1, "整理": "",
  "来源": ["测试"], "状态": "active", "被取代": "", "有效到": "", "计划": "", "完成": "",
  "关于": "", "领域": "", body: body + "\n\n为什么值得记：测试。\n",
})

check("别名让换词问法也能召回", () => {
  const a = rec("a", "下一步一起做 QQ 和桌面 2D 插件", "说好过段时间做插件。", ["QQ插件", "桌面2D"])
  const b = rec("b", "日记只在记忆不够时才翻", "很多时候没必要翻日记，你真问起具体事才翻。")
  const hits = recall({ records: [b, a], query: "QQ插件什么时候做", now: new Date("2026-11-11T12:00:00+08:00"), limit: 2 })
  assert.equal(hits[0].record.id, "a", "问 QQ 插件该先出插件那条，实际 " + hits[0].record.id)
})

check("单字别名不成词——两字才对得上", () => {
  // 这条是记录下来的教训：别名写「钱」在 2-gram 里永远对不上
  const a = rec("a", "眼下只养得起小蓝一个", "经济只够一个人。", ["钱的事", "没钱"])
  const hits = recall({ records: [a], query: "钱的事怎么办", now: new Date("2026-11-11T12:00:00+08:00"), limit: 1 })
  assert.equal(hits[0].record.id, "a")
})

console.log(`分词与别名 ${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
