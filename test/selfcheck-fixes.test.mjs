/**
 * 自查修掉的三处（2026-11-09 夜，主人让小蓝自己体检）。
 *
 * ① benwo_status 报的核路径是启动时那个默认 root，不是「开机对路」之后的真核。
 *    面板走 view.root 所以是对的——只有工具在撒谎。
 * ② 「今天」的 .jsonl 侧车不回填：老格式那几天一旦被追加一条，
 *    原有条目会从结构化视图里静静消失（.md 里还在，升长期和面板都看不到）。
 * ③ state.json 的 lastSettle 永远停在 1970：结算完不回写。
 *
 * 前两条能当场跑，第三条只能读源码锁住（要起宿主才能测工具）。
 */
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { layout, appendToday, readToday, readTodayEntries, dayOf } from '../src/core/store.js'

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

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const src = fs.readFileSync(path.join(repo, 'index.js'), 'utf8')

// ---------------------------------------------------------------- ① 状态里的核路径
await check('状态报的是真核（L.root），不是启动默认值', async () => {
  assert.ok(!/核：\$\{root\}/.test(src), '还在用启动时那个 root——面板和工具会报两个不同的地方')
  assert.ok(src.includes('`核：${L.root}`'), '应该用开机对路之后的 L.root')
})

await check('「核还没准备好」也报真核', async () => {
  assert.ok(!/'核还没准备好：' \+ root/.test(src), '出错时指的路径也必须是真核，不然人会照着错路径去找')
})

// ---------------------------------------------------------------- ③ lastSettle
await check('工具里结算完会推进 lastSettle', async () => {
  assert.match(src, /lastSettle:\s*now\.toISOString\(\)/, 'benwo_settle 结算完得把 lastSettle 写回去')
})

await check('面板上按「结算一下」也会推进 lastSettle', async () => {
  const panel = src.slice(src.indexOf("body.action === 'settle'"))
  assert.match(panel.slice(0, 900), /lastSettle:\s*new Date\(\)\.toISOString\(\)/, '面板这条路也不能漏')
})

// ---------------------------------------------------------------- ② 侧车回填
const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'benwo-selfcheck-'))
const L = layout(tmp)
await fsp.mkdir(L.today, { recursive: true })

await check('老格式追加一条：原来的条目不会从结构化视图里消失', async () => {
  const legacyDay = '2026-11-03'
  const legacy = `# ${legacyDay}\n\n- 22:48 主人说先把壳造好。　〔网页〕\n- 23:10 又定了一条。　〔网页〕\n`
  await fsp.writeFile(path.join(L.today, `${legacyDay}.md`), legacy, 'utf8')

  const now = new Date('2026-11-03T23:40:00+08:00')
  assert.equal(dayOf(now), legacyDay)
  await appendToday(L, { id: 'm-new', name: '新的一条', kind: '约定', importance: 4, text: '新的一条。', source: '网页' }, now)

  const entries = await readTodayEntries(L, legacyDay)
  assert.equal(entries.length, 3, '老的两条 + 新的一条，一条都不能少')
  assert.equal(entries[2].id, 'm-new', '新条目在最后')
  assert.equal(entries[0].legacy, true, '回填的两条要标 legacy，别冒充有结构')
  assert.equal(entries[0].hhmm, '22:48')
  assert.match(entries[0].text, /先把壳造好/)
  assert.equal(entries[1].hhmm, '23:10')

  const lines = await readToday(L, legacyDay)
  assert.equal(lines.length, 3, '.md 流水照旧三条')
})

await check('侧车已经有内容了就不再回填（不会越写越重）', async () => {
  const legacyDay = '2026-11-03'
  await appendToday(L, { id: 'm-new2', name: '再一条', kind: '事件', importance: 3, text: '再一条。', source: '网页' }, new Date('2026-11-03T23:50:00+08:00'))
  const entries = await readTodayEntries(L, legacyDay)
  assert.equal(entries.length, 4, '三条老/新 + 一条，不能再把老的复制一遍')
  const raw = await fsp.readFile(path.join(L.today, `${legacyDay}.jsonl`), 'utf8')
  assert.equal(raw.split('\n').filter(Boolean).length, 4)
})

await check('新的一天照常只有新条目（没有老流水可回填）', async () => {
  const now = new Date('2026-11-04T10:00:00+08:00')
  await appendToday(L, { id: 'm-day2', name: '第二天', kind: '事实', importance: 3, text: '第二天。', source: '网页' }, now)
  const entries = await readTodayEntries(L, '2026-11-04')
  assert.equal(entries.length, 1)
  assert.equal(entries[0].id, 'm-day2')
})

await fsp.rm(tmp, { recursive: true, force: true })

console.log(`自查修的三处 ${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
