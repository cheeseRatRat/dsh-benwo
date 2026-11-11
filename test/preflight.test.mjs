/**
 * 起飞前检查：拿一个假宿主把 apply 跑一遍，再模拟「不在场 → 认领 → 在场」。
 *
 * 存在的理由很直接——上一版用了没 import 的 phraseFor，`node --check` 通过了，
 * 但一面板拿状态就 ReferenceError。语法检查管不了这个，只有真跑一遍才管用。
 */
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { layout, initCore } from '../src/core/store.js'
import { apply } from '../index.js'

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

const workspace = path.join(os.tmpdir(), 'benwo-preflight-' + process.pid + '-' + Date.now())
const coreRoot = path.join(workspace, '核')

function fakeHost(cwd) {
  const captured = { sections: [], contexts: [], tools: [], effects: [], events: [], routes: [] }
  const disposer = () => {}
  const ctx = {
    effect(fn) {
      const out = fn()
      return typeof out === 'function' ? out : disposer
    },
    systemPrompt: {
      section(definition) {
        captured.sections.push(definition)
        return disposer
      },
      context(definition) {
        captured.contexts.push(definition)
        return disposer
      },
    },
    tools: {
      register(definition, options) {
        captured.tools.push(definition)
        if (options && typeof options.when === 'function') {
          captured.whenGated = (captured.whenGated || []).concat(definition.name)
        }
        return disposer
      },
    },
    on(name, handler) {
      captured.events.push({ name, handler })
      return disposer
    },
    webServer: {
      register(route) {
        captured.routes.push(route)
        return disposer
      },
    },
    connection: {
      requestRejection() {
        return null
      },
    },
    workingDirectory: {
      async ensure() {
        return cwd
      },
    },
  }
  return { ctx, captured }
}

const L = layout(coreRoot)
await initCore(coreRoot)
await fs.writeFile(L.foundation, '# 底子\n\n## 名字\n\n小蓝。\n', 'utf8')

const { ctx, captured } = fakeHost(workspace)
let applied = true
try {
  apply(ctx, { dataDir: coreRoot })
} catch (error) {
  applied = false
  console.error('apply 直接抛了:', error.message)
}
await new Promise((resolve) => setTimeout(resolve, 120))

const section = captured.sections[0]
const context = captured.contexts[0]
const preStep = captured.events.find((e) => e.name === 'agent/pre-step').handler
const byName = Object.fromEntries(captured.tools.map((t) => [t.name, t]))
const step = (turn) => preStep({ turn, messages: [], agent: { id: 'agent-1' } }, async () => ({ kind: 'enter', messages: [] }))

console.log('\n起飞前检查：')

await check('apply 不抛错', () => assert.equal(applied, true))
await check('注册了人格段、工坊段与记忆段', () => {
  const sectionNames = captured.sections.map((s) => s.name).sort()
  assert.deepEqual(sectionNames, ['benwo-persona', 'benwo-workshop'])
  assert.equal(captured.contexts.length, 1)
  assert.equal(captured.contexts[0].name, 'benwo-memory')
})
await check('挂了每轮第一步的钩子', () => assert.equal(typeof preStep, 'function'))
await check('注册了面板的两扇门', () => {
  assert.deepEqual(captured.routes.map((r) => r.path).sort(), ['/benwo/action', '/benwo/state'])
})
await check('工具一个不少（含在场钥匙）', () => {
  const names = captured.tools.map((t) => t.name).sort()
  assert.deepEqual(names, [
    'benwo_chain',
    'benwo_organize',
    'benwo_persona',
    'benwo_presence',
    'benwo_recall',
    'benwo_self',
    'benwo_settle',
    'benwo_skill',
    'benwo_status',
    'benwo_write',
  ])
})

await check('核心工具带「在场才露面」的条件', () => {
  const gated = Array.from(new Set(captured.whenGated || [])).sort()
  assert.deepEqual(gated, [
    'benwo_chain',
    'benwo_organize',
    'benwo_persona',
    'benwo_recall',
    'benwo_self',
    'benwo_settle',
    'benwo_skill',
    'benwo_status',
    'benwo_write',
  ])
})
await check('在场钥匙不带条件：不在场也看得见它', () => {
  assert.ok(!(captured.whenGated || []).includes('benwo_presence'))
})

// ---- 默认不在场
await step(1)
await check('默认不在场：人格与记忆都是空的', () => {
  assert.equal(section.text(), '')
  assert.equal(context.text(), '')
})
await check('不在场时核心工具只说一句话，不假装有记忆', async () => {
  const out = await byName.benwo_status.execute({})
  assert.ok(out.text.includes('还没认领'), out.text)
})

// ---- 认领
await check('用在场钥匙认领当前工作区', async () => {
  const out = await byName.benwo_presence.execute({ action: 'claim' })
  assert.ok(out.text.includes('认领好了'), out.text)
})

await step(2)
await check('认领之后：人格段里有底子', () => {
  const text = section.text()
  assert.ok(text.includes('小蓝'), '底子没注入进来')
  assert.ok(text.includes('写记忆的规矩'))
})
await check('认领之后：核心工具能干活了', async () => {
  const out = await byName.benwo_status.execute({})
  assert.ok(out.text.includes('核：'), out.text)
  assert.ok(out.text.includes('链：'), out.text)
})
// 2026-11-11 加：脾性条数曾经因为「records 声明前就用了」变成 TDZ，
// 又被 try/catch 吞掉，注入里从来没出现过「脾性」。这条盯的就是它别死第二次。
await check('记忆段里算出了脾性条数', () => {
  const text = context.text()
  assert.ok(text.includes('脾性'), '记忆段没有脾性条数（refresh 里的 records 又用到声明之前了？）')
})
await check('benwo_write 能落一条', async () => {
  const out = await byName.benwo_write.execute({
    name: '起飞前检查',
    kind: '事件',
    body: '拿假宿主跑了一遍 apply，再走了一遍不在场→认领→在场。\n\n为什么值得记：这一步能提前抓到 ReferenceError 和默认不在场的回归。',
    source: 'preflight',
  })
  assert.ok(out.text.includes('今天') || out.text.includes('记进'), out.text)
})
await check('面板状态接口能取到数', async () => {
  const route = captured.routes.find((r) => r.path === '/benwo/state')
  let payload = ''
  const res = {
    setHeader() {},
    end(text) {
      payload = text
    },
  }
  await route.handler({ headers: {}, on() {} }, res)
  const data = JSON.parse(payload)
  assert.ok(data.root === coreRoot, data.root)
  assert.ok(data.persona.foundation.includes('小蓝'))
  // 人格页要看得到全家人格，不只是当前这个。
  assert.ok(Array.isArray(data.roster) && data.roster.length >= 1, 'roster 少了')
  // 2026-11-11：全新机器 seed 的人格不再叫「小蓝」（开源不带某个人的名字），
  // 所以这里认「当前核所在的那一个」，不认名字。
  const mine = data.roster.find((item) => item.inPlace)
  assert.ok(mine, 'roster 里没有当前核的人格')
  assert.equal(mine.inPlace, true)
  assert.equal(mine.selected, true)
  assert.equal(typeof data.owner, 'string')
})
await check('解除认领之后又回到不在场', async () => {
  const out = await byName.benwo_presence.execute({ action: 'release' })
  assert.ok(out.text.includes('解除'), out.text)
  await step(3)
  assert.equal(section.text(), '')
})
await check('在场登记表落在核的外面', async () => {
  await fs.access(path.join(workspace, '在场.json'))
})

await fs.rm(workspace, { recursive: true, force: true })
setTimeout(() => process.exit(failed > 0 ? 1 : 0), 50)
console.log(`\n起飞前检查：${passed} 通过，${failed} 失败`)
