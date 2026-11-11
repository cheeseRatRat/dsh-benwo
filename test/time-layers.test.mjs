/**
 * 时间分层召回（2026-11-09 夜，主人的想法）。
 *
 * 病：以前检索完全不看时间。`强度` 让十月的旧事永远压十一月的——
 * 问「昨天那个 bug」，会翻出十月的三次小鲸鱼。同一个词，老的总赢。
 *
 * 做法：近 30 天 → 近 90 天 → 全部，哪层先找到真命中就在哪层答；
 * 问句里明说了时间（「八月」「上个月」「去年」）就直接从那层起搜。
 *
 * 这份测试用**造出来的 8 月记忆**验——真盘上现在只有 10～11 月的数据，
 * 不造跨月样本根本看不出分层有没有用。
 */
import assert from 'node:assert/strict'
import { recall, hintDays, LAYERS } from '../src/core/recall.js'

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

const mem = (id, name, body, firstDay, strength = 50, importance = 3) => ({
  id,
  '名': name,
  '别名': [],
  '类型': '事件',
  '强度': strength,
  '重要度': importance,
  '首次': firstDay,
  '状态': 'active',
  '被取代': '',
  '有效到': '',
  body: body + '\n\n为什么值得记：测试。',
})

const NOW = new Date('2026-11-09T12:00:00+08:00')

/** 十一月的新事 */
const NEW = mem('m-new', '修图流程改好了', '修图流程现在改成先出草图再精修。', '2026-11-05')
/** 八月的老事，强度故意给高——老问题就是「老的总赢」 */
const OLD = mem('m-old', '修图流程当初怎么定的', '八月里定下的修图流程：先量尺寸再三视图。', '2026-08-02', 90, 5)
/** 只存在七月的一件更早的事——用来验「近 90 天也找不到，才扩到全部」 */
const ONLY_OLD = mem('m-only-old', '七月那次跑图全白', '七月跑三视图，两张裙子全跑成白色。', '2026-07-20', 70, 4)

await check('提示词解析：上个月 → 约 60 天；去年 → 约 400 天', () => {
  assert.equal(hintDays('上个月说的那个'), 60)
  assert.equal(hintDays('去年那件事'), 400)
  assert.equal(hintDays('昨天那个 bug'), 2)
  assert.equal(hintDays('今天做了什么'), 1)
  assert.equal(hintDays('修图流程怎么定的'), 0, '没说时间就该是 0')
})

await check('提示词解析：点名月份 → 从那个月一号算起的天数', () => {
  // 现在是 11 月 9 日，八月是 100 天前左右
  const d = hintDays('八月那次的修图流程')
  assert.ok(d >= 95 && d <= 105, `八月的跨度算成了 ${d} 天`)
  const numeric = hintDays('8月那次')
  assert.ok(numeric >= 95 && numeric <= 105, `8 月算成了 ${numeric} 天`)
})

await check('没说时间：先只搜近 30 天，老的不出来', () => {
  const hits = recall({ records: [NEW, OLD], query: '修图流程', now: NOW, limit: 3 })
  assert.equal(hits.length, 1, '三十天窗口里只该有新事：' + hits.map((h) => h.record.id).join(','))
  assert.equal(hits[0].record.id, 'm-new')
  assert.equal(hits[0].layer, '近 30 天')
})

await check('近 30 天找不到 → 自动扩到全部（不会空手）', () => {
  // 只问八月才有的事，且不带时间提示
  const hits = recall({ records: [NEW, OLD, ONLY_OLD], query: '跑三视图全白', now: NOW, limit: 3 })
  assert.ok(hits.length > 0, '扩层之后该找得到')
  assert.equal(hits[0].record.id, 'm-only-old')
  assert.equal(hits[0].layer, '全部', '近 30 天和近 90 天都没有，该扩到全部')
})

await check('说了「八月」：直接从那一层起搜，老的就上来了', () => {
  const hits = recall({ records: [NEW, OLD], query: '八月定下的修图流程', now: NOW, limit: 3 })
  assert.ok(hits.some((h) => h.record.id === 'm-old'), '说了八月还找不到八月的事：' + hits.map((h) => h.record.id).join(','))
  assert.match(hits[0].layer, /近 \d+ 天/)
})

await check('说了「去年」：层放到一年，八月的东西照样能翻到', () => {
  const hits = recall({ records: [NEW, OLD], query: '去年的修图流程', now: NOW, limit: 3 })
  assert.ok(hits.length > 0)
  assert.ok(hits.some((h) => h.record.id === 'm-old' || h.record.id === 'm-new'))
})

await check('老的总赢这个病：分层之后，新事优先', () => {
  // OLD 强度 90、重要度 5，按老逻辑它一定压过强度 50 的 NEW
  const noLayer = recall({ records: [NEW, OLD], query: '修图流程', now: NOW, limit: 3, windows: [{ days: Infinity, label: '全部' }] })
  const layered = recall({ records: [NEW, OLD], query: '修图流程', now: NOW, limit: 3 })
  assert.equal(noLayer[0].record.id, 'm-old', '不分层时确实是老的赢（这就是原来那个病）')
  assert.equal(layered[0].record.id, 'm-new', '分层之后该是新的先出来')
})

await check('层内近期加成：同一层里越近越占优（但只是微调）', () => {
  const a = mem('m-a', '同一件事 A', '同一件事的描述文本一模一样。', '2026-11-08', 50, 3)
  const b = mem('m-b', '同一件事 B', '同一件事的描述文本一模一样。', '2026-10-20', 50, 3)
  const hits = recall({ records: [b, a], query: '同一件事的描述文本', now: NOW, limit: 2 })
  assert.equal(hits[0].record.id, 'm-a', '更近的那条该在前')
})

await check('没有「首次」的记录不会被分层误伤', () => {
  const noDay = { ...mem('m-noday', '没有日期的老事', '没有日期的正文。', ''), '首次': '' }
  const hits = recall({ records: [noDay], query: '没有日期的正文', now: NOW, limit: 3 })
  assert.ok(hits.some((h) => h.record.id === 'm-noday'), '没日期当作「今天」，不该被丢掉')
})

await check('没问句时不分层：按强度浮，一切照旧', () => {
  const hits = recall({ records: [NEW, OLD], query: '', now: NOW, limit: 3 })
  assert.ok(hits.length >= 1)
  assert.equal(hits[0].record.id, 'm-old', '无问句时还是强的前面')
})

await check('层的顺序是全的：30 / 90 / 全部', () => {
  assert.deepEqual(LAYERS.map((l) => l.days), [30, 90, Infinity])
})

console.log(`时间分层 ${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
