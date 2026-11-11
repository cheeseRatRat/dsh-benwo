/**
 * 家务：备份与换位置。
 *
 * 这两件事**不碰任何记忆内容**，只搬文件夹、改在场登记。
 * 所以它们可以走面板的按钮（跟「写记忆」不是一回事）。
 */
import fs from 'node:fs/promises'
import path from 'node:path'

const copyTree = async (from, to) => {
  await fs.mkdir(to, { recursive: true })
  for (const entry of await fs.readdir(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name)
    const dst = path.join(to, entry.name)
    if (entry.isDirectory()) await copyTree(src, dst)
    else await fs.copyFile(src, dst)
  }
}

const sizeOf = async (dir) => {
  let bytes = 0
  let files = 0
  const walk = async (current) => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) await walk(full)
      else {
        const stat = await fs.stat(full)
        bytes += stat.size
        files += 1
      }
    }
  }
  await walk(dir)
  return { bytes, files }
}

/**
 * 备份：整栋楼 + 门禁表 + 家那一层该带走的东西。
 *
 * 家那一层不是全都带：在场.json / 隐私.json 里存的是绝对路径，
 * 换台机器、换个盘符就失效了，硬带过去只会指错路。
 * 但主人档案和记录力度是「人的偏好」，不属于哪台机器，必须跟着走。
 */
export async function backupAll({ coreBase, presenceFile, backupBase, homeFiles = [], now = new Date() }) {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, '-')
  const target = path.join(backupBase, stamp)
  await copyTree(coreBase, path.join(target, '核'))
  try {
    await fs.copyFile(presenceFile, path.join(target, '在场.json'))
  } catch {}
  const carried = []
  for (const file of homeFiles) {
    if (!file) continue
    try {
      await fs.mkdir(path.join(target, '家'), { recursive: true })
      await fs.copyFile(file, path.join(target, '家', path.basename(file)))
      carried.push(path.basename(file))
    } catch {}
  }
  const { bytes, files } = await sizeOf(target)
  return { ok: true, target, files, bytes, carried }
}

/**
 * 换位置：把整栋楼搬到新地方，再改门禁表里的路径。
 * 先复制、核对、再删旧的——宁可多占一会儿盘，也不冒险先删。
 */
export async function moveAll({ coreBase, presenceFile, destination, readPresence, writePresence }) {
  const source = path.resolve(coreBase)
  const target = path.resolve(destination)
  if (source === target) return { ok: false, reason: '新位置和旧位置一样' }
  try {
    await fs.access(target)
    const entries = await fs.readdir(target)
    if (entries.length > 0) return { ok: false, reason: '新位置不是空目录：' + target }
  } catch {}

  await copyTree(source, target)
  const before = await sizeOf(source)
  const after = await sizeOf(target)
  if (before.files !== after.files) {
    return { ok: false, reason: `复制不完整：旧 ${before.files} 个文件，新 ${after.files} 个` }
  }

  const presence = await readPresence()
  const personas = {}
  for (const [name, root] of Object.entries(presence.personas || {})) {
    const normalized = String(root).replace(/\\/g, '/')
    personas[name] = normalized.startsWith(source.replace(/\\/g, '/'))
      ? normalized.replace(source.replace(/\\/g, '/'), target.replace(/\\/g, '/'))
      : root
  }
  await writePresence({ ...presence, personas })

  // 核对完才删旧的
  await fs.rm(source, { recursive: true, force: true })
  return { ok: true, target, files: after.files, bytes: after.bytes, personas }
}

export async function dirStats(dir) {
  try {
    return await sizeOf(dir)
  } catch {
    return { bytes: 0, files: 0 }
  }
}

export function humanSize(bytes) {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}
