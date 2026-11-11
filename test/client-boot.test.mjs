/**
 * 客户端起飞前检查。
 *
 * 上一版 client.js 只过了 node --check，一进浏览器就把页面搞崩。
 * 这里用一个假 window + 假 React 把它装一遍：模块体、apply、图标、面板，
 * 全部真执行一次。能过这里，才有资格进浏览器。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

let passed = 0
let failed = 0
const check = (name, fn) => {
  try {
    fn()
    passed += 1
    console.log('  ✓ ' + name)
  } catch (error) {
    failed += 1
    console.error('  ✗ ' + name + ' — ' + error.message)
  }
}

const here = path.dirname(fileURLToPath(import.meta.url))
const code = fs.readFileSync(path.join(here, '..', 'client.js'), 'utf8')

const captured = { entry: null }
const fakeWindow = { __ModuleLoader__: { load(entry) { captured.entry = entry } } }

let moduleThrew = ''
try {
  // 客户端代码只碰 window.__ModuleLoader__，用 Function 执行就是它的真实起点
  new Function('window', code)(fakeWindow)
} catch (error) {
  moduleThrew = error.message
}

const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (value) => [value, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
}

let factoryThrew = ''
let mod = null
try {
  mod = captured.entry.factory((name) => {
    if (name === 'react') return React
    throw new Error('要了没声明的依赖: ' + name)
  })
} catch (error) {
  factoryThrew = error.message
}

const regs = []
const fakeSlots = {
  inject(name, factory) {
    const out = factory()
    return typeof out === 'function' ? out : () => {}
  },
  register(definition, component) {
    regs.push({ name: definition.name, key: definition.id || definition.key, component })
    return () => {}
  },
}

let applyThrew = ''
try {
  mod.apply({ slots: fakeSlots })
} catch (error) {
  applyThrew = error.message
}

console.log('\n客户端起飞前检查：')

check('模块体能执行', () => assert.equal(moduleThrew, ''))
check('注册的 id 等于包名', () => {
  // 2026-11-11：包名从 @local/dsh-benwo 改成 dsh-benwo（开源去 scope），client 的注册 id 跟着改。
  assert.equal(captured.entry.id, 'dsh-benwo')
})
check('factory 只要了 react', () => assert.equal(factoryThrew, ''))
check('有 apply', () => assert.equal(typeof mod.apply, 'function'))
check('apply 不抛错', () => assert.equal(applyThrew, ''))
check('声明了 slots 依赖（少了这行会卡死启动）', () => {
  assert.ok(Array.isArray(mod.inject), '插件对象上没有 inject')
  assert.ok(mod.inject.includes('slots'), JSON.stringify(mod.inject))
})
check('只挂一个入口（全名的那个）', () => {
  const entries = regs.filter((r) => r.name === 'sidebar.panellist')
  assert.equal(entries.length, 1)
  assert.equal(entries[0].key, 'benwo')
})
check('主面板 key 跟入口一致', () => {
  assert.deepEqual(regs.filter((r) => r.name === 'main').map((r) => r.key), ['benwo'])
})
check('里面有三个页签：记忆 / 人格 / 工坊', () => {
  assert.ok(/'memory'/.test(code) && /'persona'/.test(code) && /'workshop'/.test(code))
})
check('图标能渲染', () => {
  const entry = regs.find((r) => r.name === 'sidebar.panellist')
  const tree = entry.component({ size: 18, active: true })
  assert.equal(tree.type, 'svg')
})
/** 一层层往下渲染，直到拿到真正的 DOM 元素（type 是字符串）。 */
function renderDeep(component, props = {}, depth = 0) {
  let tree = component(props)
  while (tree && typeof tree.type === 'function' && depth < 8) {
    tree = tree.type(tree.props || {})
    depth += 1
  }
  return tree
}

check('没数据时显示加载态，不白屏', () => {
  const entry = regs.find((r) => r.name === 'main')
  const tree = renderDeep(entry.component)
  assert.ok(tree, '什么都没渲染出来')
  assert.equal(tree.type, 'div')
  assert.ok(JSON.stringify(tree).includes('把核打开'))
})
check('取数是包着 try/catch 的，失败只提示不抛', () => {
  assert.ok(code.includes('catch (error)'), 'call() 必须自己吞错')
  assert.ok(code.includes("return { error:"), '失败要转成 error 字段')
})
check('面板不直接改盘（没有写文件、没有 POST 之外的副作用）', () => {
  assert.ok(!/writeFile|fs\./.test(code), '客户端不该碰文件系统')
})

console.log(`\n客户端起飞前检查：${passed} 通过，${failed} 失败`)
if (failed > 0) process.exit(1)
