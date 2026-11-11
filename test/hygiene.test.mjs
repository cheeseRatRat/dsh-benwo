/**
 * 工程卫生（⑩ 迁移 / ⑪ 跨进程锁），2026-11-09。
 *
 * ⑩ 以前只有 readState 抛错，没有迁移这条路——代码升级改字段，旧核就只剩「起不来」。
 * ⑪ 以前 withLock 只是进程内 Map，DSH 和 QQ 桥同时写同一个核，它一点用没有。
 */
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import {
  layout,
  ensureCore,
  initCore,
  migrateCore,
  withDiskLock,
  readState,
  writeState,
  SCHEMA,
  LOCK_STALE_MS,
} from '../src/core/store.js'

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

const fresh = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'benwo-hyg-'))
  const L = await initCore(root)
  return { root, L }
}

// ---------------- ⑩ 迁移

await check('新核：没有状态文件也不报错', async () => {
  const { root, L } = await fresh()
  const out = await migrateCore(L)
  assert.equal(out.ok, true)
  assert.equal(out.migrated, false)
  await fs.rm(root, { recursive: true, force: true })
})

await check('同版本：什么都不做', async () => {
  const { root, L } = await fresh()
  const out = await migrateCore(L)
  assert.equal(out.migrated, false)
  assert.equal(out.to, SCHEMA)
  await fs.rm(root, { recursive: true, force: true })
})

await check('旧版本：先备份，再升到当前版本', async () => {
  const { root, L } = await fresh()
  await fs.writeFile(L.state, JSON.stringify({ schema: 0, lastSettle: 'x', pending: false }), 'utf8')
  const out = await migrateCore(L)
  assert.equal(out.ok, true)
  assert.equal(out.migrated, true)
  assert.equal(out.from, 0)
  const after = await readState(L)
  assert.equal(after.schema, SCHEMA)
  const files = await fs.readdir(path.dirname(L.state))
  assert.ok(files.some((f) => f.includes('.bak-schema0-')), '迁移前必须先备份')
  await fs.rm(root, { recursive: true, force: true })
})

await check('新版本（旧代码读新核）：拒绝，不猜着读', async () => {
  const { root, L } = await fresh()
  await fs.writeFile(L.state, JSON.stringify({ schema: SCHEMA + 99 }), 'utf8')
  const out = await migrateCore(L)
  assert.equal(out.ok, false)
  assert.match(out.reason, /更新版本/)
  await fs.rm(root, { recursive: true, force: true })
})

await check('ensureCore 开机就对版本：新核直接拒绝启动', async () => {
  const { root, L } = await fresh()
  await fs.writeFile(L.state, JSON.stringify({ schema: SCHEMA + 99 }), 'utf8')
  await assert.rejects(() => ensureCore(root), /更新版本/)
  await fs.rm(root, { recursive: true, force: true })
})

// ---------------- ⑪ 跨进程锁

await check('拿到锁就执行，执行完把锁文件删掉', async () => {
  const { root, L } = await fresh()
  const out = await withDiskLock(L, 'demo', async () => 'ok')
  assert.equal(out, 'ok')
  const lockFile = path.join(L.status, 'locks', 'demo.lock')
  await assert.rejects(() => fs.stat(lockFile), '锁文件应该在 finally 里删掉')
  await fs.rm(root, { recursive: true, force: true })
})

await check('锁里写的是 pid 和时间戳（指望它能判陈旧）', async () => {
  const { root, L } = await fresh()
  await withDiskLock(L, 'peek', async () => {
    const raw = await fs.readFile(path.join(L.status, 'locks', 'peek.lock'), 'utf8')
    const [pid, at] = raw.trim().split(/\s+/)
    assert.ok(Number(pid) > 0)
    assert.ok(Number(at) > 0)
  })
  await fs.rm(root, { recursive: true, force: true })
})

await check('陈旧锁（超过 10 分钟）：可以抢，不会卡死', async () => {
  const { root, L } = await fresh()
  const dir = path.join(L.status, 'locks')
  await fs.mkdir(dir, { recursive: true })
  const stale = Date.now() - LOCK_STALE_MS - 60000
  await fs.writeFile(path.join(dir, 'old.lock'), `999999 ${stale}`, 'utf8')
  const out = await withDiskLock(L, 'old', async () => 'took-over')
  assert.equal(out, 'took-over')
  await fs.rm(root, { recursive: true, force: true })
})

await check('写得进去就说明锁真的放开了（不会自己锁死自己）', async () => {
  const { root, L } = await fresh()
  await withDiskLock(L, 'twice', async () => 1)
  const second = await withDiskLock(L, 'twice', async () => 2)
  assert.equal(second, 2)
  await fs.rm(root, { recursive: true, force: true })
})

console.log(`工程卫生 ${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
