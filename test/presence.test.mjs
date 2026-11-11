import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import {
  normPath,
  emptyPresence,
  readPresence,
  writePresence,
  resolveActive,
  claim,
  release,
  registerPersona,
  listWorkspaces,
} from '../src/core/presence.js'

let passed = 0
let failed = 0
const check = async (name, fn) => {
  try {
    await fn()
    passed += 1
    console.log('  ✓ ' + name)
  } catch (error) {
    failed += 1
    console.error('  ✗ ' + name + ' — ' + error.message)
  }
}

const base = path.join(os.tmpdir(), 'benwo-presence-' + process.pid + '-' + Date.now())
const CORE = 'C:/Users/11588/.dsh/benwo/核'

console.log('\n在场登记：')

await check('路径规范化：大小写、斜杠、尾巴', () => {
  assert.equal(normPath('D:\\A\\B\\'), 'd:/a/b')
  assert.equal(normPath('d:/a/b'), normPath('D:/A/B/'))
})

await check('没有登记表 = 谁都不在场（默认）', async () => {
  const presence = await readPresence(base)
  assert.deepEqual(presence.workspaces, {})
  const state = resolveActive(presence, 'D:/anything')
  assert.equal(state.active, false)
  assert.ok(state.reason.includes('没认领'))
})

await check('登记人格住处，再认领工作区，才在场', async () => {
  let presence = emptyPresence()
  presence = registerPersona(presence, '小蓝', CORE, true).presence
  assert.equal(presence.selected, '小蓝')

  const state0 = resolveActive(presence, 'D:/work')
  assert.equal(state0.active, false)

  const claimed = claim(presence, 'D:/work')
  assert.equal(claimed.ok, true)
  presence = claimed.presence

  const state = resolveActive(presence, 'D:/work')
  assert.equal(state.active, true)
  assert.equal(state.persona, '小蓝')
  assert.equal(state.root, CORE)
})

await check('大小写不同也算同一个工作区', () => {
  const presence = claim(registerPersona(emptyPresence(), '小蓝', CORE, true).presence, 'D:/Work').presence
  assert.equal(resolveActive(presence, 'd:/work/').active, true)
})

await check('没选人格就不能认领', () => {
  const out = claim(emptyPresence(), 'D:/work')
  assert.equal(out.ok, false)
  assert.ok(out.reason.includes('人格'))
})

await check('人格没登记住处，认领也不生效', () => {
  const presence = { ...emptyPresence(), selected: '雪奈' }
  const out = claim(presence, 'D:/work')
  assert.equal(out.ok, false)
  assert.ok(out.reason.includes('住处'))
})

await check('解除认领之后就不在场了', () => {
  let presence = claim(registerPersona(emptyPresence(), '小蓝', CORE, true).presence, 'D:/work').presence
  const out = release(presence, 'd:/work')
  assert.equal(out.ok, true)
  assert.equal(resolveActive(out.presence, 'D:/work').active, false)
})

await check('一个工作区一个人格，两个工作区可以各是一个人', () => {
  let presence = emptyPresence()
  presence = registerPersona(presence, '小蓝', CORE, true).presence
  presence = registerPersona(presence, '雪奈', 'C:/elsewhere/雪奈核').presence
  presence = claim(presence, 'D:/blue', '小蓝').presence
  presence = claim(presence, 'D:/snow', '雪奈').presence
  assert.equal(resolveActive(presence, 'D:/blue').root, CORE)
  assert.equal(resolveActive(presence, 'D:/snow').root, 'C:/elsewhere/雪奈核')
})

await check('存盘再读回来，一个字不丢', async () => {
  let presence = emptyPresence()
  presence = registerPersona(presence, '小蓝', CORE, true).presence
  presence = claim(presence, 'D:/work').presence
  await writePresence(base, presence)
  const back = await readPresence(base)
  assert.equal(back.selected, '小蓝')
  assert.equal(resolveActive(back, 'D:/work').active, true)
  assert.equal(listWorkspaces(back).length, 1)
})

await check('坏文件不炸，当成不在场', async () => {
  const broken = path.join(os.tmpdir(), 'benwo-broken-presence-' + Date.now())
  await fs.mkdir(broken, { recursive: true })
  await fs.writeFile(path.join(broken, '在场.json'), '{ 这不是 json', 'utf8')
  const presence = await readPresence(broken)
  assert.equal(presence.workspaces && Object.keys(presence.workspaces).length, 0)
  await fs.rm(broken, { recursive: true, force: true })
})

await fs.rm(base, { recursive: true, force: true })
console.log(`\n在场登记：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
