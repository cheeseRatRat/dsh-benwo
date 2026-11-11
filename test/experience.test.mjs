import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { layout, initCore } from '../src/core/store.js'
import {
  saveExperience,
  readAllExperience,
  findExperience,
  bumpExperience,
  safeName,
  scoreExperience,
  EXP_MIN_SCORE,
} from '../src/core/experience.js'
import { tokenize } from '../src/core/recall.js'

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

const root = path.join(os.tmpdir(), 'benwo-exp-' + process.pid + '-' + Date.now())
const L = layout(root)
await initCore(root)

await check('路径穿不出去', () => {
  const evil = safeName('../../etc/passwd')
  assert.ok(!evil.includes('/'))
  assert.ok(!evil.includes('\\'))
  assert.equal(safeName(''), '未命名')
  assert.ok(!safeName('..').includes('..'))
})

await check('存一条，按分类分目录', async () => {
  const out = await saveExperience(L, {
    '名': '怎么对账',
    '分类': '工具',
    '触发': ['对账', 'sha256'],
    body: '远程树用 git blob sha1，附件用 sha256；别用大小和时间。',
    '来源': ['网页:2026-11-07'],
  })
  assert.equal(out.ok, true)
  assert.ok(out.file.includes('工具'))
  await fs.access(out.file)
})

await check('读得回来，字段不丢', async () => {
  const { list, broken } = await readAllExperience(L)
  assert.equal(broken.length, 0)
  const hit = list.find((e) => e['名'] === '怎么对账')
  assert.ok(hit)
  assert.deepEqual(hit['触发'], ['对账', 'sha256'])
  assert.equal(hit['用到'], 0)
  assert.ok(hit.body.includes('sha256'))
})

await check('同类活能浮上来', async () => {
  const { list } = await readAllExperience(L)
  const hit = findExperience(list, '发布前怎么对账')
  assert.ok(hit.length >= 1, '一条都没浮上来')
  assert.equal(hit[0].exp['名'], '怎么对账')
  assert.ok(hit[0].score >= EXP_MIN_SCORE)
})

await check('不相干的活不硬凑', async () => {
  const { list } = await readAllExperience(L)
  const hit = findExperience(list, '今天晚上吃什么')
  assert.equal(hit.length, 0)
})

await check('触发词命中的排前面', async () => {
  await saveExperience(L, {
    '名': '打包别用系统 zip',
    '分类': '工具',
    '触发': ['zip', '打包'],
    body: 'Windows 自带打 zip 会写反斜杠，解出来是怪文件名。',
  })
  const { list } = await readAllExperience(L)
  const hit = findExperience(list, 'release 的 zip 怎么打')
  assert.ok(hit.length >= 1)
  assert.equal(hit[0].exp['名'], '打包别用系统 zip')
})

await check('用过一次记一笔，重存不丢计数', async () => {
  const { list } = await readAllExperience(L)
  const target = list.find((e) => e['名'] === '怎么对账')
  const bumped = await bumpExperience(target, new Date('2026-11-08T10:00:00Z'))
  assert.equal(bumped['用到'], 1)

  const after = (await readAllExperience(L)).list.find((e) => e['名'] === '怎么对账')
  const again = await saveExperience(L, {
    '名': '怎么对账',
    '分类': '工具',
    '触发': ['对账'],
    body: '远程树用 git blob sha1，附件用 sha256；别用大小和时间。再补一句：先删后传。',
  })
  assert.equal(again.fresh, false)
  assert.equal(again.exp['用到'], 1, '重写正文不该清零')
  assert.equal(again.exp['最后用'], '2026-11-08T10:00:00.000Z')
  assert.ok(after)
})

await check('坏文件单独列出来，不拖垮整次读取', async () => {
  await fs.mkdir(path.join(L.exp, '杂'), { recursive: true })
  await fs.writeFile(path.join(L.exp, '杂', 'broken.md'), '没有头部', 'utf8')
  const { list, broken } = await readAllExperience(L)
  assert.ok(list.length >= 2, '好的还在')
  assert.equal(broken.length, 1, '坏的单独报')
})

await check('打分：触发词比正文更重', () => {
  const a = { '名': '甲', '触发': ['对账', 'sha256'], body: '随便写点什么。' }
  const b = { '名': '乙', '触发': [], body: '对账的时候要看 sha256，也要看大小。' }
  const tokens = tokenize('对账 sha256')
  assert.ok(scoreExperience(a, tokens) > scoreExperience(b, tokens))
})

await fs.rm(root, { recursive: true, force: true })
console.log(`\n经验层测试：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
