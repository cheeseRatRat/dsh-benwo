/**
 * 文档一致性（2026-11-12）。
 *
 * 病：代码连改三轮，文档停在定稿那天——版本号、包名、测试数、工具数、预算全对不上。
 * 不是忘了写，是**没有任何东西在改代码时提醒「文档也该改」**。
 *
 * 这份测试只盯「可以机械核对」的数字：版本、工具数、测试文件数、注入预算、类型数。
 * 描述性内容靠人看，数字靠测试。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  BUDGET_TOTAL,
  BUDGET_TODAY,
  BUDGET_FLOATING,
  BUDGET_LAST,
  BUDGET_STATUS,
  FLOATING_LIMIT,
} from '../src/core/inject.js'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const read = (p) => fs.readFile(path.join(root, p), 'utf8')

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

const pkg = JSON.parse(await read('package.json'))
const index = await read('index.js')
const install = await read('docs/安装到新机器.md')
const memory = await read('docs/记忆是怎么运转的.md')
const archive = await read('docs/工程档案.md')

const toolNames = new Set([...index.matchAll(/name: '(benwo_[a-z]+)'/g)].map((m) => m[1]))
const testFiles = new Set(pkg.scripts.test.match(/node test\/[a-z0-9-]+\.test\.mjs/g) || [])

await check('版本号：安装文档跟 package.json 一致', () => {
  assert.ok(
    install.includes(`插件 ${pkg.version}`),
    `安装文档里找不到「插件 ${pkg.version}」——改版本号时记得一起改文档`,
  )
})

await check('工具数：代码、文档、安装步骤三处一致', () => {
  assert.equal(toolNames.size, 10, `代码里已经是 ${toolNames.size} 个工具：${[...toolNames].join('、')}`)
  assert.ok(install.includes('工具十个'), '安装文档没写「工具十个」')
})

await check('测试文件数：安装文档跟 scripts.test 一致', () => {
  const n = testFiles.size
  assert.ok(install.includes(`${n} 个测试文件`), `安装文档没写「${n} 个测试文件」`)
  assert.ok(install.includes(`${n} 个文件全绿`), `安装文档没写「${n} 个文件全绿」`)
  assert.ok(archive.includes(`测试 ${n} 文件`), `工程档案没写「测试 ${n} 文件」`)
})

await check('注入预算：记忆文档跟 BUDGET_* 常量一致', () => {
  assert.ok(memory.includes(`${BUDGET_TOTAL} 个字`), `记忆文档没写「${BUDGET_TOTAL} 个字」`)
  assert.ok(
    memory.includes(`| 【上次】（几天前那次） | ${BUDGET_LAST} |`),
    `【上次】预算对不上（代码 ${BUDGET_LAST}）`,
  )
  assert.ok(
    memory.includes(`| 【今天记录】 | ${BUDGET_TODAY} |`),
    `【今天记录】预算对不上（代码 ${BUDGET_TODAY}）`,
  )
  assert.ok(
    memory.includes(`| 【相关记忆】（最像的 ${FLOATING_LIMIT} 条） | ${BUDGET_FLOATING} |`),
    `【相关记忆】行对不上（代码 ${BUDGET_FLOATING} 字 / ${FLOATING_LIMIT} 条）`,
  )
  assert.ok(
    memory.includes(`| 【记录设置】 | ${BUDGET_STATUS} |`),
    `【记录设置】预算对不上（代码 ${BUDGET_STATUS}）`,
  )
})

await check('类型数：记忆文档写的是八种', () => {
  assert.ok(memory.includes('八种'), '记忆文档没写「八种」类型')
})

console.log(`文档一致性 ${passed} 通过 / ${failed} 失败`)
if (failed > 0) process.exit(1)
