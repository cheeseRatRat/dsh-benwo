import assert from 'node:assert/strict'
import {
  charCount,
  buildToday,
  rankFloating,
  buildFloating,
  buildMemoryBlock,
  BUDGET_TOTAL,
  BUDGET_TODAY,
  BUDGET_FLOATING,
  FLOATING_LIMIT,
} from '../src/core/inject.js'

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
  id: 'm-20261107-0001',
  '名': '短名',
  '类型': '事实',
  '强度': 40,
  '重要度': 3,
  '状态': 'active',
  '被取代': '',
  body: '这是一条记忆正文。\n\n为什么值得记：测试。',
  ...over,
})

check('字数按汉字算', () => {
  assert.equal(charCount('abc'), 3)
  assert.equal(charCount('小蓝'), 2)
  assert.equal(charCount('小蓝🎣'), 3, '表情算一个码点')
})

// ---- 今天段
check('今天按预算装，不再卡六行', () => {
  const lines = Array.from({ length: 10 }, (_, i) => `第 ${i} 件事`)
  const out = buildToday(lines)
  assert.ok(out.lines.length >= 8, '短条目该装得下更多，实际 ' + out.lines.length)
})
check('今天超预算时先丢低重要的', () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({
    hhmm: `0${i + 1}:00`,
    text: '看见了什么：' + '一'.repeat(60),
    importance: i === 0 ? 5 : 1,
    _t: i,
  }))
  const out = buildToday(rows, BUDGET_TODAY)
  const total = charCount(out.lines.join('\n'))
  assert.ok(total <= BUDGET_TODAY, `实际 ${total}`)
  assert.ok(out.dropped > 0, '应该丢掉一些低重要的')
  assert.ok(out.lines.some((l) => l.includes('01:00')), '重要那条被丢了：' + out.lines.join(' | '))
})

// ---- 浮上来
check('按 强度+5×(重要度−3) 排', () => {
  const a = rec({ id: 'a', '强度': 20, '重要度': 5 })
  const b = rec({ id: 'b', '强度': 35, '重要度': 3 })
  const c = rec({ id: 'c', '强度': 40, '重要度': 1 })
  const order = rankFloating([a, b, c]).map((r) => r.id)
  assert.equal(order[0], 'b', 'b 应该第一')
  assert.equal(order.length, 3)
})
check('最多三条', () => {
  const many = Array.from({ length: 14 }, (_, i) => rec({ id: 'm' + i, '强度': 90 }))
  assert.equal(rankFloating(many).length, FLOATING_LIMIT)
})
check('被取代的不上来', () => {
  const out = rankFloating([rec({ id: 'x', '状态': '被取代', '强度': 90 })])
  assert.equal(out.length, 0)
})
check('淡到进不了注入的也不上来', () => {
  const out = rankFloating([rec({ id: 'x', '强度': 5, '重要度': 4 })])
  assert.equal(out.length, 0)
})
check('重要度五的，地板也能露个名', () => {
  const out = rankFloating([rec({ id: 'x', '强度': 7, '重要度': 5 })])
  assert.equal(out.length, 1)
})

// ---- 措辞接进来
check('模糊的带标注，并带类型·日期和一句摘要', () => {
  const out = buildFloating([rec({ '强度': 20, '名': '修根', '类型': '事实', '首次': '2026-11-08T10:00:00.000Z' })])
  // 2026-11-09 起格式变成：- 名 · 类型 · 月.日 / 换行 + 一句摘要
  assert.match(out.lines[0], /^- 修根（有点模糊） · 事实 · 11\.08/)
  assert.match(out.lines[0], /\n {2}这/, '头一条应当带一句摘要')
})
check('清晰的不带标注', () => {
  const out = buildFloating([rec({ '强度': 60, '名': '修根' })])
  assert.ok(!out.lines[0].includes('模糊'), out.lines[0])
})
check('浮上来超预算就丢尾巴并报数', () => {
  const heavy = Array.from({ length: 3 }, (_, i) =>
    rec({ id: 'm' + i, '强度': 60, '名': '名'.repeat(16), body: '正文'.repeat(60) + '\n\n为什么值得记：测试。' }),
  )
  const out = buildFloating(heavy, BUDGET_FLOATING)
  assert.ok(charCount(out.lines.join('\n')) <= BUDGET_FLOATING)
})

// ---- 整块
check('整块不超预算', () => {
  const today = Array.from({ length: 6 }, () => '主人说了一件很长的今天发生的事，大概二三十个字左右。')
  const records = Array.from({ length: 5 }, (_, i) => rec({ id: 'm' + i, '强度': 50, '名': '短名' + i }))
  const out = buildMemoryBlock({ today, records })
  assert.ok(out.chars <= BUDGET_TOTAL + 30, `实际 ${out.chars}`)
})
check('丢了要明写还有几条没放下', () => {
  const today = Array.from({ length: 6 }, () => '一'.repeat(50))
  const records = Array.from({ length: 3 }, (_, i) => rec({ id: 'm' + i, '强度': 90, '名': '名' + i }))
  const out = buildMemoryBlock({ today, records })
  if (out.dropped > 0) assert.ok(out.text.includes('没放下'), out.text)
})
check('没有今天也没有旧的，就是空字符串', () => {
  const out = buildMemoryBlock({ today: [], records: [] })
  assert.equal(out.text, '')
  assert.equal(out.dropped, 0)
})
check('空的时候不硬凑', () => {
  const out = buildMemoryBlock({ today: ['今天只发生了一件小事。'], records: [] })
  assert.ok(!out.text.includes('【相关记忆】'), '想不起来就别放这个标题')
})
check('两段标题都在时顺序对', () => {
  const out = buildMemoryBlock({ today: ['今天有一件事。'], records: [rec({ '强度': 60 })] })
  assert.ok(out.text.indexOf('【今天记录】') < out.text.indexOf('【相关记忆】'))
})
check('经验只露一行名字，不占正文', () => {
  const out = buildMemoryBlock({ today: ['今天有一件事。'], records: [], experience: '怎么对账' })
  assert.ok(out.text.includes('- 有关经验：怎么对账'), out.text)
  assert.ok(!out.text.includes('git blob'), '正文不该被塞进来')
})
check('没有经验就不露这一行', () => {
  const out = buildMemoryBlock({ today: ['今天有一件事。'], records: [] })
  assert.ok(!out.text.includes('经验：'))
})

check('今天超预算时，同等重要的保新的', () => {
  const long = (n) => ({ hhmm: `0${n}:00`, text: '看见了什么：' + 'x'.repeat(100), importance: 3, _t: n })
  const out = buildToday([long(1), long(2), long(3), long(4)])
  const total = charCount(out.lines.join('\n'))
  assert.ok(total <= BUDGET_TODAY, '超预算了：' + total)
  assert.ok(out.lines.some((l) => l.includes('04:00')), '最新那条被丢了：' + out.lines.join(' | '))
})
check('今天每条会截短，别让一条吃光预算', () => {
  const out = buildToday(['长'.repeat(400), '短句。'])
  assert.ok(out.lines[0].length <= 90, '第一行没截住：' + out.lines[0].length)
})

check('常驻全文：名字和正文一起进来', () => {
  const out = buildMemoryBlock({
    records: [],
    pinnedFull: [{ name: '涩涩规则', body: '第一句正文。\n第二句正文。' }],
  })
  assert.ok(out.text.includes('- 常驻：涩涩规则'), out.text)
  assert.ok(out.text.includes('第二句正文'), out.text)
  assert.ok(out.pinnedChars > 0)
})
check('常驻全文：太长就被闸住，并且报一句', () => {
  const out = buildMemoryBlock({
    records: [],
    pinnedFull: [
      { name: '甲', body: '甲'.repeat(8000) },
      { name: '乙', body: '乙'.repeat(8000) },
    ],
  })
  assert.ok(out.text.includes('- 常驻：甲'))
  assert.ok(!out.text.includes('- 常驻：乙'), '乙该被闸掉')
  assert.ok(out.text.includes('常驻全文太长没放下'), out.text.slice(-120))
})

check('工坊单独一段，不和记忆混在一起', () => {
  const out = buildMemoryBlock({
    records: [rec(60)],
    preRanked: true,
    pinnedFull: [{ name: '某条技能', body: '工坊正文在这儿。' }],
  })
  assert.ok(out.text.startsWith('【经验】'), out.text.slice(0, 20))
  const cut = out.text.indexOf('【相关记忆】')
  const pinnedPart = cut === -1 ? out.text : out.text.slice(0, cut)
  assert.ok(pinnedPart.includes('工坊正文在这儿'), '正文该在工坊段里')
})

console.log(`\n注入测试：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
