import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { layout, initCore } from '../src/core/store.js'
import { fingerprint, appendLink, readChain, verifyChain, chainPath, hashOf, archiveChain, readAllChain } from '../src/core/chain.js'

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

const root = path.join(os.tmpdir(), 'benwo-chain-' + process.pid + '-' + Date.now())
const L = layout(root)
await initCore(root)

await check('指纹十二位、确定性', () => {
  const a = fingerprint('小蓝')
  const b = fingerprint('小蓝')
  assert.equal(a, b)
  assert.equal(a.length, 12)
  assert.match(a, /^[0-9a-f]{12}$/)
  assert.notEqual(a, fingerprint('雪奈'))
})

await check('第一截没有 prev', async () => {
  const link = await appendLink(L, { 底子: 'aaa', 库: 'bbb', 条数: 0 })
  assert.equal(link.seq, 1)
  assert.equal(link.prev, '')
  assert.equal(link.hash, hashOf(link))
})

await check('后面的接上前面的', async () => {
  const second = await appendLink(L, { 底子: 'aaa', 库: 'ccc', 条数: 1 })
  const links = await readChain(L)
  assert.equal(second.seq, 2)
  assert.equal(second.prev, links[0].hash)
})

await check('链是好的', async () => {
  const out = await verifyChain(L)
  assert.equal(out.ok, true, out.reason)
})

await check('并发追加不丢、序号不乱', async () => {
  await Promise.all(
    Array.from({ length: 20 }, (_, i) => appendLink(L, { 底子: 'aaa', 库: 'd' + i, 条数: i })),
  )
  const links = await readChain(L)
  assert.equal(links.length, 22, `实际 ${links.length}`)
  const seqs = links.map((l) => l.seq)
  assert.deepEqual(seqs, Array.from({ length: 22 }, (_, i) => i + 1))
  assert.equal((await verifyChain(L)).ok, true)
})

await check('归档不删链：搬走之后验链照样通', async () => {
  // 2026-11-20：链只增不减会越拖越长，所以搬去 状态\链归档\。搬家不是断链。
  const out = await archiveChain(L, { at: 10, keep: 5 })
  assert.ok(out, '超过 at 就该归档')
  const rest = await readChain(L)
  assert.equal(rest.length, 5, `当前文件应剩 5 截，实际 ${rest.length}`)
  assert.equal(rest[0].seq, 18)
  const full = await readAllChain(L)
  assert.equal(full.length, 22, `拼回来应是完整 22 截，实际 ${full.length}`)
  const verify = await verifyChain(L)
  assert.equal(verify.ok, true, verify.reason)
})

await check('归档之后还能接着写、序号不乱', async () => {
  const link = await appendLink(L, { 底子: 'aaa', 库: 'zz', 条数: 99 })
  assert.equal(link.seq, 23)
  const verify = await verifyChain(L)
  assert.equal(verify.ok, true, verify.reason)
})

await check('改了某一截的指纹，验链要报', async () => {
  const file = chainPath(L)
  const lines = (await fs.readFile(file, 'utf8')).split('\n').filter(Boolean)
  const broken = JSON.parse(lines[3])
  // 归档之后当前文件从半截开始，所以拿它自己的 seq，别写死「第 4 截」。
  const brokenSeq = broken.seq
  broken.hash = 'ffffffffffff'
  lines[3] = JSON.stringify(broken)
  await fs.writeFile(file, lines.join('\n') + '\n', 'utf8')
  const out = await verifyChain(L)
  assert.equal(out.ok, false)
  assert.equal(out.brokenAt, brokenSeq)
  assert.ok(out.reason.includes('改过'), out.reason)
})

await fs.rm(root, { recursive: true, force: true })
console.log(`\n连续性链测试：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
