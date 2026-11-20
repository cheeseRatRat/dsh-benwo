/**
 * 用户档案：把那份文本读成几样纯数据（2026-11-20）。
 *
 * 两个来源，别混：
 *   1. `~/.dsh/benwo/主人.md` —— 跟着**这台机器**走，所有人格共用（她是谁、作息、称呼）。
 *   2. `<核>/人格/印象.md`   —— 跟着**人格**走，切人换人各写各的（「我怎么看她」）。
 *
 * 这里只有纯函数：给一段文本，回一段数据。不读盘、不碰 ctx，好测也好改。
 */

/** 档案里那几行「结构化的自我介绍」——摘要从它们抽，改上面就跟着变。 */
const DIGEST_SKIP = ['常驻摘要', '常出现时段', '以上是类容', '以上是内容']

/** 一行摘要：名字 / 出生 / 现状 / 爱好 / 对蓝曦说的话。手写「常驻摘要：」优先。 */
export function digestOf(raw) {
  const text = String(raw || '')
  const hand = text.match(/^常驻摘要[：:]\s*(.+)$/m)
  if (hand && hand[1].trim()) return hand[1].trim()
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('#') === false && line && !DIGEST_SKIP.some((skip) => line.startsWith(skip)))
    .slice(0, 5)
  if (lines.length === 0) return ''
  return lines.map((line) => (line.length > 26 ? line.slice(0, 26) + '…' : line)).join('，')
}

/** 「常出现时段：」后面那一句。 */
export function rhythmOf(raw) {
  const hit = String(raw || '').match(/^常出现时段[：:]\s*(.+)$/m)
  return hit ? hit[1].trim() : ''
}

/** 档案全文（问到「我是谁」时才用）：去掉摘要和作息——它们各有各的位置。 */
export function fullOf(raw) {
  return String(raw || '')
    .replace(/^常出现时段[：:].*$/m, '')
    .replace(/^常驻摘要[：:].*$/m, '')
    .trim()
}

/** 印象文件正文压成一句：`#` 标题和 `>` 引言都不是印象本身。 */
export function impressionOf(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('>'))
    .join('；')
}

/**
 * 每轮进注入的那一段【用户印象】：摘要 + 常在 + 印象。
 * full=true 时把摘要换成档案全文（问到「我是谁 / 生日 / 关于我」那一次）。
 * 三样都空就不出这一段（不留光秃秃的标题）。
 */
export function impressionBlock({ ownerRaw = '', impressionRaw = '', full = false } = {}) {
  const impression = impressionOf(impressionRaw)
  const lines = [
    full ? fullOf(ownerRaw) : digestOf(ownerRaw),
    rhythmOf(ownerRaw) ? '常在 ' + rhythmOf(ownerRaw) : '',
    impression ? '印象：' + impression : '',
  ].filter(Boolean)
  return lines.join('\n')
}
