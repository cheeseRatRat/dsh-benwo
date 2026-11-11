/**
 * 连续性链。契约 v0.2 第 10 节。
 *
 * 每轮一截，prev 连着上一截。断一环就查得出来——人格被换过、记忆被回滚过，
 * 这里是第一现场。断链的处理是：停下，报告，不猜不修。
 */
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { withLock } from './store.js'

export const CHAIN_FILE = 'chain.jsonl'

export function fingerprint(text, size = 12) {
  return crypto.createHash('sha256').update(String(text), 'utf8').digest('hex').slice(0, size)
}

export function chainPath(L) {
  return path.join(L.status, CHAIN_FILE)
}

/** 指纹串的规范形态：字段顺序写死，换顺序就是换指纹。 */
function payloadOf(link) {
  return [link.seq, link.at, link['底子'], link['库'], link['条数'], link.prev].join('|')
}

export function hashOf(link) {
  return fingerprint(payloadOf(link))
}

export function makeLink({ seq, at, 底子, 库, 条数, prev }) {
  const link = { seq, at, '底子': 底子, '库': 库, '条数': 条数, prev }
  return { ...link, hash: hashOf(link) }
}

export async function readChain(L) {
  let raw = ''
  try {
    raw = await fs.readFile(chainPath(L), 'utf8')
  } catch {
    return []
  }
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line)
      } catch {
        return { seq: -1, broken: true, line: index + 1, raw: line }
      }
    })
}

/** 追加一截。并发安全：读尾、算 prev、写，全在锁里。 */
export async function appendLink(L, { 底子, 库, 条数 }, now = new Date()) {
  return withLock('chain', async () => {
    const links = await readChain(L)
    const last = links[links.length - 1]
    const seq = last && Number.isFinite(last.seq) && last.seq > 0 ? last.seq + 1 : 1
    const link = makeLink({
      seq,
      at: new Date(now).toISOString(),
      '底子': 底子,
      '库': 库,
      '条数': 条数,
      prev: last && last.hash ? last.hash : '',
    })
    await fs.mkdir(L.status, { recursive: true })
    await fs.appendFile(chainPath(L), JSON.stringify(link) + '\n', 'utf8')
    return link
  })
}

/**
 * 和上一截对一下：底子、库的指纹是不是还一样。
 * 验链只证明「链本身没被改」，这里才证明「被链指着的东西没被改」。
 */
export async function checkCurrent(L, { 底子, 库 }) {
  const links = await readChain(L)
  const last = links[links.length - 1]
  if (!last || !last.hash) return { ok: true, reason: '' }
  if (last['底子'] !== 底子) {
    return { ok: false, reason: '底子变过了——上一截记的不是现在这份人格' }
  }
  if (last['库'] !== 库) {
    return { ok: false, reason: '记忆库变过了——有文件被改动，但没经过写入' }
  }
  return { ok: true, reason: '' }
}

/**
 * 验链。返回 { ok, brokenAt, reason }。
 * brokenAt 是第几截（从 1 开始），给人看的。
 */
export async function verifyChain(L) {
  const links = await readChain(L)
  for (let i = 0; i < links.length; i += 1) {
    const link = links[i]
    if (link.broken) {
      return { ok: false, brokenAt: i + 1, reason: `第 ${i + 1} 行解析不了` }
    }
    if (link.seq !== i + 1) {
      return { ok: false, brokenAt: i + 1, reason: `序号断了：第 ${i + 1} 截写的是 ${link.seq}` }
    }
    const expected = hashOf(link)
    if (link.hash !== expected) {
      return { ok: false, brokenAt: i + 1, reason: `第 ${i + 1} 截自己被改过` }
    }
    const prevExpected = i === 0 ? '' : links[i - 1].hash
    if ((link.prev || '') !== prevExpected) {
      return { ok: false, brokenAt: i + 1, reason: `第 ${i + 1} 截没接上第 ${i} 截` }
    }
  }
  return { ok: true, brokenAt: 0, reason: '' }
}
