/**
 * 矛盾检测（2026-11-10 夜）。
 *
 * 最危险的记忆不是太多，是**互相打架**：
 * 两条要求相反时（「出图直接给图」vs「出图先给描述」），召回哪条都像对的，
 * 咱就会精神分裂，而系统一声不响。
 *
 * 做法不靠模型：两条都是「要求」、共享 ≥2 个实词、其中一条带否定词
 * （不要 / 别 / 不用 / 取消 / 不许）另一条不带 —— 就当一对嫌疑，报出来让人看。
 * 只报嫌疑，不自动改：判是不是真矛盾，得人来看。
 */
import { isFloatable } from './decay.js'

const NEGATIVE = /不要|不用|别|不许|不用了|取消|禁止/

/**
 * 不给它们当「共同实词」：
 * - 通用称呼（「主人」几乎每条都有，共享它说明不了任何事）
 * - 模板标签（「看见了什么」是每条正文的开头，不是内容）
 * - 太泛的虚词组合
 */
const STOP = new Set([
  '可以', '这样', '那样', '什么', '怎么', '这个', '那个', '一个', '主人',
  '看见', '见了', '了什', '时候', '是不', '不是', '就是', '一下', '出来', '起来', '还是', '现在',
])

/** 两个都是虚词字符，这个 2-gram 没有实义，别当共同词。 */
const FLUFF = /[的了是在和就也都没不这那个们我你他她它一二三四五六七八九十得很太更最着过把被给让从向对说吗嘛呀吧呢啊嗯]/

/**
 * 只取「名 + 正文里『看见了什么』之后、『为什么值得记』之前」这一段。
 * 2026-11-11 修：原来把「看见了什么：」「2026-11-10 夜，主人说……」都算进共同词，
 * 结果 20 条要求两两全中（74 对），真矛盾全被淹掉。
 */
function gist(r) {
  const body = String(r.body || '').split('为什么值得记')[0]
  const main = body.replace(/^[\s\S]*?看见了什么[：:]\s*/, '')
  return String(r['名'] || '') + ' ' + main
}

function grams(text) {
  // 通用称呼先删掉：不然「主人」会切出跨串碎片，
  // 每条记录都带它，碎片一共享就成了假嫌疑。
  const clean = String(text || '')
    .replace(/主人/g, '')
    .replace(/[^\u4e00-\u9fff]/g, '')
  const out = new Set()
  for (let i = 0; i + 2 <= clean.length; i += 1) {
    const g = clean.slice(i, i + 2)
    if (STOP.has(g)) continue
    if (FLUFF.test(g[0]) && FLUFF.test(g[1])) continue
    out.add(g)
  }
  return out
}

/**
 * 找疑似打架的记录对。只比「要求」——事件/事实/约定本身不会互相否定。
 * 返回 [{ a, b, shared: [...] }]
 */
export function findConflicts(records = [], { kinds = ['要求'], minShared = 2 } = {}) {
  const pool = (records || []).filter(
    (r) => r && kinds.includes(r['类型']) && isFloatable(r),
  )
  const items = pool.map((r) => ({
    record: r,
    grams: grams(gist(r)),
    negative: NEGATIVE.test(gist(r)),
  }))
  const out = []
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i]
      const b = items[j]
      if (a.negative === b.negative) continue // 都否定或都不否定，不是相反
      const shared = [...a.grams].filter((g) => b.grams.has(g))
      if (shared.length < minShared) continue
      out.push({ a: a.record, b: b.record, shared: shared.slice(0, 4) })
    }
  }
  return out
}
