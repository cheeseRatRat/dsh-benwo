/**
 * 别名标签（2026-11-09 夜）。
 *
 * 治什么：检索是按字比的（2-gram 重合）。问「搬家的规矩」，那条记忆写的是
 * 「打包前先问」——两个字都不重合，召不回来。这是字面匹配的天花板。
 *
 * 做法：给记忆挂几个「同一个意思的别的说法」，只参与检索、**不进注入、不占预算**。
 * 不上向量、不联网，核还是一个能拷走的文件夹。
 */
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import { layout, writeRecord, readAllRecords } from '../src/core/store.js'
import { recall } from '../src/core/recall.js'
import { buildMemoryBlock } from '../src/core/inject.js'

let passed = 0
let failed = 0
const check = async (name, fn) => {
  try {
    await fn()
    passed += 1
  } catch (error) {
    failed += 1
    console.error('FAIL', name, '—', error.message)
  }
}

const mem = (id, name, body, aliases = [], strength = 50, importance = 3) => ({
  id,
  '名': name,
  '别名': aliases,
  '类型': '约定',
  '强度': strength,
  '重要度': importance,
  '状态': 'active',
  '被取代': '',
  '有效到': '',
  body: body + '\n\n为什么值得记：测试。',
})

const now = new Date('2026-11-10T00:00:00Z')
const hitIds = (records, query) => recall({ records, query, now, limit: 3 }).map((h) => h.record.id)

const PACK = mem('m-pack', '打包前先问主人，别重复打', '打包对小蓝是顺手，对主人是一堆重复的文件夹。改完先问，她说打再打。', [
  '搬家',
  '备份',
  '压缩包',
])
const OTHER = mem('m-other', '从根上修，别只做补丁', '修问题尽量从根上修，别只做临时补丁。')

await check('没有别名：只能算「弱候选」，不许冒充命中（这就是要治的病）', () => {
  const bare = mem('m-pack', '打包前先问主人，别重复打', PACK.body)
  const hits = recall({ records: [bare, OTHER], query: '搬家的规矩', now, limit: 3 })
  // 字面全对不上时它会兜底给两条，但**必须标 weak**——找不回来就是找不回来。
  assert.ok(hits.length === 0 || hits.every((h) => h.weak), '没别名却当成真命中了')
})

await check('挂了别名：变成真命中（不再是弱候选）', () => {
  const hits = recall({ records: [PACK, OTHER], query: '搬家的规矩', now, limit: 3 })
  const hit = hits.find((h) => h.record.id === 'm-pack')
  assert.ok(hit, '别名没生效')
  assert.equal(hit.weak, false, '挂了别名还标 weak，说明 rel 还是没过门槛')
})

await check('别名也能对上「备份那块」这种说法', () => {
  const ids = hitIds([PACK, OTHER], '备份那块怎么弄')
  assert.ok(ids.includes('m-pack'), ids.join(', '))
})

await check('别名不进注入（省下的钱要真省下）', () => {
  const block = buildMemoryBlock({ records: [PACK], preRanked: true })
  assert.ok(!block.text.includes('搬家'), '别名漏进注入了：' + block.text)
  assert.ok(!block.text.includes('压缩包'), '别名漏进注入了：' + block.text)
  assert.ok(block.text.includes('打包'), '正文该在的还得在')
})

await check('没有别名的老记录行为不变（向后兼容）', () => {
  const ids = hitIds([OTHER], '从根上修')
  assert.ok(ids.includes('m-other'))
  const block = buildMemoryBlock({ records: [OTHER], preRanked: true })
  assert.ok(block.text.includes('从根上修'))
})

await check('挂歪了会引错命中——所以别名要写「同义」不写「相关」', () => {
  const wrong = mem('m-bad', '打包前先问', PACK.body, ['旅行', '出游'])
  const ids = hitIds([wrong], '下周去哪旅行')
  assert.ok(ids.includes('m-bad'), '这条是演示代价的：挂错别名就会这样')
})

// ---- 存→读往返：别名是数组，白名单漏了会静默丢
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'benwo-alias-'))
const L = layout(tmp)
await fsp.mkdir(L.long, { recursive: true })

await check('存→读往返：别名数组不许被丢掉', async () => {
  await writeRecord(L, PACK)
  const { records } = await readAllRecords(L)
  const found = records.find((r) => r.id === 'm-pack')
  assert.ok(found, '没读回来')
  assert.deepEqual(found['别名'], ['搬家', '备份', '压缩包'])
})

await check('空别名不炸，读成空数组', async () => {
  await writeRecord(L, mem('m-empty', '没有别名的一条', '正文。'))
  const { records } = await readAllRecords(L)
  const found = records.find((r) => r.id === 'm-empty')
  assert.deepEqual(found['别名'], [])
})

await check('手写的逗号别名也能读（不用非得方括号）', async () => {
  const dir = path.join(L.long, '约定')
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(
    path.join(dir, 'm-comma.md'),
    '---\nid: m-comma\n名: 逗号写法\n别名: 甲, 乙、丙\n类型: 约定\n强度: 40\n重要度: 3\n状态: active\n---\n\n正文。\n',
    'utf8',
  )
  const { records } = await readAllRecords(L)
  const found = records.find((r) => r.id === 'm-comma')
  assert.deepEqual(found['别名'], ['甲', '乙', '丙'])
})

await fsp.rm(tmp, { recursive: true, force: true })

console.log(`别名标签 ${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
