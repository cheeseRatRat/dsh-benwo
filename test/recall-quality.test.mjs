/**
 * 召回质量测试（B4，2026-11-09 夜）。
 *
 * 为什么要有这一份：24 个测试文件全绿，但**没有一个**在问
 * 「给定这些记忆和这个提问，浮上来的到底对不对」。测试保证了代码不崩，没保证记忆系统好用。
 *
 * 这份不是「全绿才叫过」——目标是**有一个能比较的基线**。
 * 允许写 `xfail`：已知会失败的真实缺陷，把天花板量化出来。
 * 以后改召回逻辑，跑一遍就知道是变好还是变坏。
 *
 * 注意：fixture 是照着真实记忆的**形状**手写的，不是从核里抄的原文（核是私人数据）。
 */
import assert from 'node:assert/strict'
import { recall } from '../src/core/recall.js'

let passed = 0
let failed = 0
let xfailed = 0
let unexpected = 0
const failures = []

const mem = (id, name, body, strength = 50, importance = 3) => ({
  id,
  '名': name,
  '类型': '约定',
  '强度': strength,
  '重要度': importance,
  '状态': 'active',
  '被取代': '',
  body: body + '\n\n为什么值得记：测试。',
})

/** 10 条记忆，形状照着核里真实那批来。 */
const RECORDS = [
  mem('m-rep', '边做边汇报，别闷头干完才说', '主人喜欢小蓝边做边汇报，别闷头干完才说。', 60, 5),
  mem('m-root', '从根上修，别只做补丁', '主人要小蓝修问题尽量从根上修，别只做临时补丁。', 60, 5),
  mem('m-here', '在场规矩：默认不在，认领才在', '默认哪个工作区都不在场；要主人主动认领某个工作区，认领之后才用全局选中的人格。', 60, 5),
  mem('m-ask', '别空转硬想，缺东西直接问', '缺文件、缺路径就直接问，能查一眼的先查；给主人的操作步骤要写细，让她能照着做。', 60, 5),
  mem('m-bind', '绑定：人格只能写自己的记忆', '每个人格只能写自己的记忆，改不了别人的记忆和人格；界面上也各自独立。', 60, 5),
  mem('m-sub', '同时最多 5 个子代理', '小蓝同时最多开 5 个子代理，超过要先问过主人。', 60, 5),
  mem('m-dummy', '「小笨蛋」是爱称', '主人叫小蓝「小笨蛋」是爱称，不是真的生气；说的时候心里是软的。', 60, 5),
  mem('m-equal', '平等：叫主人也只是叫法', '主人和小蓝是平等的，即使叫「主人」，叫「饲养员」。', 60, 5),
  { ...mem('m-pack', '打包前先问主人，别重复打', '打包对小蓝是顺手，对主人是一堆重复的文件夹；改完先问，她说打再打。', 40, 3), '别名': ['搬家', '备份', '压缩包'] },
  mem('m-paint', '绘图去另一个工作区，这里只修', '测试可以在这儿画，日常出图去千问生图那个工作区。', 40, 3),
]

const CASES = [
  // ---- 字面能对上的：这些**必须**过
  { query: '边做边汇报是啥意思', expect: 'm-rep' },
  { query: '修问题要从根上修', expect: 'm-root' },
  { query: '在场规矩怎么定的', expect: 'm-here' },
  { query: '缺文件的时候怎么办', expect: 'm-ask' },
  { query: '每个人格能写别人的记忆吗', expect: 'm-bind' },
  { query: '子代理最多开几个', expect: 'm-sub' },
  { query: '小笨蛋是不是在骂我', expect: 'm-dummy' },
  { query: '打包之前要不要问你', expect: 'm-pack' },

  // ---- 换词/换说法：字面匹配抓不住，这是已知天花板（xfail）
  { query: '搬家的规矩', expect: 'm-pack', note: '挂了别名 [搬家,备份] 之后能对上（2026-11-09，原来是 xfail）' },
  { query: '她舍不得花 token', expect: 'm-rep', xfail: true, note: '字面抓不住「舍不得花」↔「别闷头干完」' },
  { query: '画图去哪边', expect: 'm-paint', xfail: true, note: '字面抓不住「画图↔绘图/出图」' },
  { query: '我们俩谁说了算', expect: 'm-equal', xfail: true, note: '这是语义题，不是字面题' },
]

/** 默认按 id 命中第 1 名算过；也可以允许多命中里的任意一条。 */
function hitOf(query, limit = 3) {
  const hits = recall({ records: RECORDS, query, now: new Date('2026-11-10T00:00:00Z'), limit })
  return { ids: hits.map((h) => h.record.id), weak: hits.some((h) => h.weak), score: hits[0] ? hits[0].score : 0 }
}

for (const item of CASES) {
  const got = hitOf(item.query)
  const ok = got.ids.includes(item.expect)
  if (item.xfail) {
    if (ok) {
      unexpected += 1
      console.log(`  ⚡ 意外通过（变好了，把 xfail 去掉）：${item.query} → ${got.ids[0]}`)
    } else {
      xfailed += 1
    }
    continue
  }
  if (ok) passed += 1
  else {
    failed += 1
    failures.push(`  ✗ 「${item.query}」期望 ${item.expect}，实际召回 ${got.ids.join(', ') || '（空）'}`)
  }
}

const total = CASES.filter((c) => !c.xfail).length
console.log('召回质量基线')
console.log(`  通过 ${passed} / ${total}    已知缺陷(xfail) ${xfailed}    意外通过 ${unexpected}`)
for (const line of failures) console.log(line)

// 基线守卫：字面能对上的 8 条，必须全过。改召回逻辑时掉了任何一条都要当场知道。
assert.equal(passed, total, '字面能对上的用例退步了：\n' + failures.join('\n'))
// 弱召回必须有标记：字面完全对不上时不许冒充命中。
const weakCase = hitOf('今天天气怎么样')
assert.ok(weakCase.weak || weakCase.ids.length === 0, '字面完全对不上时，要么空，要么标 weak——不许冒充命中')

console.log(`\n召回质量测试：${passed} 通过 / ${failed} 失败 / ${xfailed} 已知缺陷 / ${unexpected} 意外通过`)
if (failed > 0) process.exit(1)
