import assert from 'node:assert/strict'
import { tokenize, tokenSet, jaccard, relevance, buildIndex, recall, REL_MIN, linksOf, FALLBACK_LIMIT } from '../src/core/recall.js'

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

const rec = (over = {}) => ({
  id: 'm1',
  '名': '修根不打补丁',
  '类型': '约定',
  '强度': 60,
  '重要度': 4,
  '状态': 'active',
  '被取代': '',
  body: '问题从根上修，别只打补丁。\n\n为什么值得记：以后想省事的时候先看见这条。',
  ...over,
})

// ---- 分词
check('中文按二字切', () => {
  const t = tokenize('小蓝喜欢大白饭')
  assert.ok(t.includes('小蓝'))
  assert.ok(t.includes('大白'))
  assert.ok(t.includes('白饭'))
})
check('单字也留一个', () => {
  assert.ok(tokenize('鱼').includes('鱼'))
})
check('英文数字按词', () => {
  const t = tokenize('Live2D 模型 v2')
  assert.ok(t.includes('live2d'))
  assert.ok(t.includes('v2'))
})
check('标点全丢', () => {
  const t = tokenize('真的，假的！')
  assert.ok(!t.some((x) => /[，！]/.test(x)))
})

// ---- 相似度
check('同一句相似度为 1', () => {
  const a = tokenSet('问题从根上修')
  assert.equal(jaccard(a, tokenSet('问题从根上修')), 1)
})
check('毫不相干是 0', () => {
  assert.equal(jaccard(tokenSet('小蓝'), tokenSet('天气')), 0)
})
check('查询和文档余弦在 0 到 1 之间', () => {
  const index = buildIndex([rec()])
  const rel = relevance(tokenSet('为什么值得记'), index.docs[0], index.idf)
  assert.ok(rel > 0 && rel <= 1.0001, `实际 ${rel}`)
})
check('毫不相干的查询给 0', () => {
  const index = buildIndex([rec()])
  const rel = relevance(tokenSet('天气预报'), index.docs[0], index.idf)
  assert.equal(rel, 0)
})

// ---- 召回
check('对得上就捞出来，且不算弱命中', () => {
  const out = recall({ records: [rec()], query: '修根这事咋说的' })
  assert.equal(out.length, 1)
  assert.equal(out[0].record.id, 'm1')
  assert.ok(out[0].rel >= REL_MIN)
  assert.equal(out[0].weak, false)
})
check('对不上时不冒充命中：给弱候选，并且明确标 weak', () => {
  const out = recall({ records: [rec()], query: '明天天气怎么样' })
  assert.ok(out.length <= FALLBACK_LIMIT, `最多 ${FALLBACK_LIMIT} 条弱候选，实际 ${out.length}`)
  for (const hit of out) {
    assert.equal(hit.weak, true, '没十足把握就必须标 weak')
    assert.ok(hit.rel < REL_MIN, '弱候选的相关度本来就该在门槛以下')
  }
})
check('库里一条都没有时，兜底也不许凭空造', () => {
  assert.deepEqual(recall({ records: [], query: '明天天气怎么样' }), [])
})
check('最多三条', () => {
  const scenes = ['厨房的水管', '卧室的墙角', '楼下的铁门', '公司那台打印机', '海边的木船', '车里的座椅']
  const many = scenes.map((scene, i) =>
    rec({ id: 'm' + i, '名': '补丁' + i, body: `${scene}又打了一次补丁，还是没撑住。\n\n为什么值得记：${scene}这次教训。` }),
  )
  assert.equal(recall({ records: many, query: '补丁' }).length, 3)
})
check('重复的只留一条', () => {
  const a = rec({ id: 'a' })
  const b = rec({ id: 'b', '名': '修根不打补丁' })
  const out = recall({ records: [a, b], query: '修根' })
  assert.equal(out.length, 1, `实际 ${out.length} 条`)
})
check('被取代的不参与召回', () => {
  const out = recall({ records: [rec({ '状态': '被取代' })], query: '修根' })
  assert.equal(out.length, 0)
})
check('没查询时，按强度和重要度浮上来', () => {
  const strong = rec({ id: 's', '强度': 90, '重要度': 5, '名': '重要的事', body: '很重要的事。\n\n为什么值得记：重要。' })
  const weak = rec({ id: 'w', '强度': 20, '重要度': 2, '名': '小事', body: '一件小事。\n\n为什么值得记：小事。' })
  const out = recall({ records: [weak, strong], query: '' })
  assert.equal(out[0].record.id, 's')
})
check('一跳链接能带出邻居', () => {
  const a = rec({ id: 'a', '名': '修根', body: '主人说修根，别只打补丁，参见 [[补丁史]]。\n\n为什么值得记：测试。' })
  const b = rec({ id: 'b', '名': '补丁史', body: '过去打过很多补丁，都烂了。\n\n为什么值得记：测试。' })
  const out = recall({ records: [a, b], query: '修根' })
  const ids = out.map((x) => x.record.id)
  assert.ok(ids.includes('a'))
  assert.ok(ids.includes('b'), '链接的邻居应该被带出来')
})
check('linksOf 认得出 [[名字]]', () => {
  const b = rec({ id: 'b', '名': '补丁史' })
  const a = rec({ id: 'a', body: '参见 [[补丁史]] 和 [[不存在的]]' })
  const out = linksOf(a, new Map([['补丁史', b]]))
  assert.equal(out.length, 1)
  assert.equal(out[0].id, 'b')
})

console.log(`\n召回测试：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
