/**
 * 在场登记。契约：默认不在场，认领了才在。
 *
 * 这份文件放在核的外面（`$DSH_HOME/benwo/在场.json`），因为它管的是「哪个工作区、
 * 哪个人格」——不属于任何一条鱼自己的记忆，属于这栋楼的门禁。
 *
 * 为什么默认不在场：不在场 = 不注入人格、不注入记忆、工具直接说没有核。
 * 零开销。普通 DSH 永远不会莫名其妙多出一个人格、多烧一份上下文。
 */
import fs from 'node:fs/promises'
import path from 'node:path'

export const PRESENCE_VERSION = 1

export function presencePath(baseDir) {
  return path.join(baseDir, '在场.json')
}

/** 路径规范化：Windows 不分大小写，斜杠统一，结尾不留分隔符。 */
export function normPath(input) {
  const text = String(input || '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
  return text.toLowerCase()
}

export function emptyPresence() {
  return { version: PRESENCE_VERSION, selected: '', personas: {}, workspaces: {} }
}

export async function readPresence(baseDir) {
  try {
    const raw = await fs.readFile(presencePath(baseDir), 'utf8')
    const parsed = JSON.parse(raw)
    return {
      version: Number(parsed.version) || PRESENCE_VERSION,
      selected: String(parsed.selected || ''),
      personas: parsed.personas && typeof parsed.personas === 'object' ? parsed.personas : {},
      workspaces: parsed.workspaces && typeof parsed.workspaces === 'object' ? parsed.workspaces : {},
    }
  } catch {
    // 没有登记表 = 谁都不在场。这是默认，不是错误。
    return emptyPresence()
  }
}

export async function writePresence(baseDir, presence) {
  await fs.mkdir(baseDir, { recursive: true })
  const file = presencePath(baseDir)
  const tmp = file + '.' + process.pid + '.tmp'
  await fs.writeFile(tmp, JSON.stringify(presence, null, 2) + '\n', 'utf8')
  await fs.rename(tmp, file)
  return file
}

/** 这个人格住哪。没登记就不住。 */
export function personaRoot(presence, persona) {
  const root = presence.personas[persona]
  return typeof root === 'string' && root.trim() ? root : ''
}

/**
 * 这个工作区现在是谁在场。
 * 返回 { active, persona, root, reason } —— reason 只给人看，不参与判断。
 */
export function resolveActive(presence, cwd) {
  const key = normPath(cwd)
  if (!key) return { active: false, persona: '', root: '', reason: '没有工作区路径' }

  for (const [workspace, persona] of Object.entries(presence.workspaces || {})) {
    if (normPath(workspace) !== key) continue
    const root = personaRoot(presence, persona)
    if (!root) {
      return { active: false, persona: String(persona || ''), root: '', reason: `人格「${persona}」还没登记住处` }
    }
    return { active: true, persona: String(persona || ''), root, reason: '' }
  }
  return { active: false, persona: '', root: '', reason: '这个工作区还没认领' }
}

/** 认领一个工作区。没指定人格就用全局选中的那个。 */
export function claim(presence, cwd, persona) {
  const key = String(cwd || '').trim()
  const who = String(persona || presence.selected || '').trim()
  if (!key) return { ok: false, reason: '没有工作区路径' }
  if (!who) return { ok: false, reason: '还没选人格' }
  const root = personaRoot(presence, who)
  if (!root) return { ok: false, reason: `人格「${who}」还没登记住处` }
  const next = {
    ...presence,
    workspaces: { ...presence.workspaces, [key]: who },
  }
  return { ok: true, presence: next, persona: who, root }
}

/** 解除认领。不动任何记忆文件，只是不让她在这个工作区里出现。 */
export function release(presence, cwd) {
  const key = normPath(cwd)
  const next = {}
  let removed = ''
  for (const [workspace, persona] of Object.entries(presence.workspaces || {})) {
    if (normPath(workspace) === key) {
      removed = workspace
      continue
    }
    next[workspace] = persona
  }
  return { ok: Boolean(removed), presence: { ...presence, workspaces: next }, removed }
}

/** 登记一个人格的住处（第一次装核时用）。 */
export function registerPersona(presence, persona, root, select = false) {
  const who = String(persona || '').trim()
  if (!who) return { ok: false, reason: '没有人格名' }
  if (!String(root || '').trim()) return { ok: false, reason: '没有核路径' }
  return {
    ok: true,
    presence: {
      ...presence,
      selected: select || !presence.selected ? who : presence.selected,
      personas: { ...presence.personas, [who]: String(root) },
    },
  }
}

export function listWorkspaces(presence) {
  return Object.entries(presence.workspaces || {}).map(([workspace, persona]) => ({ workspace, persona }))
}
