/**
 * 缓存段不许变（2026-11-09）。
 *
 * 背景：@jipika/dsh-memory 的作者实测过——动态计数放在 system prompt 靠前的段里，
 * 每写一条记忆就变一次，会让整个请求前缀失去 provider 的 KV cache。
 *
 * 咱犯过：人格段里塞过「记录力度」和「观察 N 条 / N 天 / N 场景」。已挪走。
 * 这个测试就是锁：谁再把会变的东西塞回人格段，这里要红。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPersonaBlock, buildMemoryBlock, BUDGET_STATUS } from '../src/core/inject.js'

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

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')

check('人格段：底子在，规则在', () => {
  const out = buildPersonaBlock({ foundation: '# 底子\n名字：小蓝', rules: '规则一条' })
  assert.match(out, /底子/)
  assert.match(out, /规则一条/)
})

check('人格段：可改层和画像有才加，没有就不留空标题', () => {
  const bare = buildPersonaBlock({ foundation: '底子' })
  assert.doesNotMatch(bare, /说话的样子/)
  assert.doesNotMatch(bare, /咱写的自己/)

  const full = buildPersonaBlock({ foundation: '底子', editableText: '语气：软', portrait: '咱是一条鲸鱼' })
  assert.match(full, /## 说话的样子/)
  assert.match(full, /## 咱写的自己/)
})

check('人格段：同样的输入永远同样的字节（这才是能缓存的）', () => {
  const args = { foundation: '底子', editableText: '语气：软', portrait: '画像', rules: '规则' }
  const a = buildPersonaBlock(args)
  const b = buildPersonaBlock(args)
  assert.equal(a, b)
})

check('会变的状态进了记忆段，没进人格段', () => {
  const persona = buildPersonaBlock({ foundation: '底子', rules: '规则' })
  assert.doesNotMatch(persona, /记录力度/)
  assert.doesNotMatch(persona, /观察 \d+ 条/)

  const block = buildMemoryBlock({
    today: ['一条今天'],
    records: [],
    preRanked: true,
    status: '记录力度：中（一天 12 条）\n自己长：观察 3 条 / 2 天 / 2 场景',
  })
  assert.match(block.text, /【记录设置】/)
  assert.match(block.text, /记录力度：中/)
  assert.match(block.text, /观察 3 条/)
})

check('状态行有字数上限，不许把预算吃光', () => {
  const long = '记'.repeat(500)
  const block = buildMemoryBlock({ today: [], records: [], preRanked: true, status: long })
  const line = block.text.split('【记录设置】')[1] || ''
  assert.ok([...line].length <= BUDGET_STATUS + 2, `状态行 ${[...line].length} 字，超过 ${BUDGET_STATUS}`)
})

check('源码里：人格段赋值块不许出现 recordLevel / growthLine', () => {
  const src = fs.readFileSync(path.join(repo, 'index.js'), 'utf8')
  const at = src.indexOf('personaCache = buildPersonaBlock(')
  assert.ok(at > 0, '找不到 personaCache 赋值，这条锁要更新')
  const end = src.indexOf('})', at)
  assert.ok(end > at)
  const chunk = src.slice(at, end + 2)
  for (const bad of ['recordLevel', 'growthLine', 'Date', 'now']) {
    assert.ok(!chunk.includes(bad), `人格段赋值块里出现了会变的东西：${bad}`)
  }
})

console.log(`缓存段不许变 ${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
