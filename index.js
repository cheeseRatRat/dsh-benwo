/**
 * Host half of 本我回响之核（dsh-benwo）。
 *
 * 期 1 只做五件事：目录、字段、写入硬闸、两段注入、惰性结算 + 连续性链。
 * 召回和整理在期 2。
 *
 * 契约 v0.2 的两条硬要求落地：
 *   - 人格段走 system（字节冻结、可缓存），记忆段走运行期 context（尾部）
 *   - 会变的东西绝不进 system；注入超预算要报数，不许悄悄少给
 */
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import {
  layout,
  ensureCore,
  initCore,
  readAllRecords,
  writeRecord,
  appendToday,
  readToday,
  readTodayEntries,
  readTodayWindow,
  readLastSession,
  dayOf,
  newId,
  KINDS,
  noteMeet,
  meetStats,
  readState,
  writeState,
} from './src/core/store.js'
import { settleRecord, settleAll, phraseFor, reinforce, isAlive, isFloatable } from './src/core/decay.js'
import { promotableTraits, validateDraft, splitWhy, canPromote, findSimilar, TODAY_LIMIT, LONG_PER_TURN, DIRECT_KINDS, } from './src/core/judge.js'
import { buildMemoryBlock, buildWorkshop, buildPersonaBlock, charCount, pickFloating, pickWithQuota, FLOATING_LIMIT } from './src/core/inject.js'
import { readFloatLog, cooldownOf, noteFloated, tiredOf } from './src/core/float-log.js'
import { recall } from './src/core/recall.js'
import {
  shouldOrganize,
  organizeWeight,
  mergeDuplicates,
  applyMerges,
  buildReflection,
  markOrganized,
} from './src/core/organize.js'
import { appendLink, verifyChain, fingerprint } from './src/core/chain.js'
import {
  saveExperience,
  readAllExperience,
  findExperience,
  bumpExperience,
  setPinned,
} from './src/core/experience.js'
import {
  readPresence,
  writePresence,
  resolveActive,
  claim,
  release,
  registerPersona,
  listWorkspaces,
  normPath,
  personaRoot,
  presencePath,
} from './src/core/presence.js'
import { backupAll, moveAll, dirStats, humanSize } from './src/core/backup.js'
import { execFile } from 'node:child_process'
import {
  readEditable,
  readLedger,
  appendObservation,
  evaluate,
  applyEdit,
  readPortrait,
  preparePortrait,
  savePortrait,
  portraitReady,
  ledgerDayOf,
  EDITABLE_SECTIONS,
} from './src/core/persona.js'
import { readKnowledge, addKnowledge, overturnKnowledge, supersedeKnowledge, confirmKnowledge, injectableKnowledge } from './src/core/knowledge.js'
import { readJourneyMonth, monthsOf, pickMonth } from './src/core/journey.js'
import { searchAll, readPage, headOf, diariesRecent } from './src/core/lookup.js'
import { findConflicts } from './src/core/conflict.js'

export const inject = ['systemPrompt', 'tools', 'connection', 'webServer', 'workingDirectory']

const SECTION_NAME = 'benwo-persona'
const SECTION_ORDER = 92
const WORKSHOP_NAME = 'benwo-workshop'
const WORKSHOP_ORDER = 93
const CONTEXT_NAME = 'benwo-memory'
const CONTEXT_ORDER = 240
const REFRESH_MS = 3000
/**
 * 版本号：跟 package.json 的 version 对齐（有测试盯着，改一处忘另一处会红）。
 * 以前写死 v0.0.2，开源发到 0.1.x 之后日志里还印着旧号。
 */
const VERSION = 'v0.2.0'

/** 什么时候才把「主人档案」翻出来：默认零占用，问到才给。 */
const OWNER_HINTS =
  /我是谁|我是干什么|我叫什么|我的名字|我的生日|我生日|生日|关于我|我的事|你主人|主人是谁|记不记得我|还记得我|几岁|多大|年龄|忌口|不喜欢吃|住哪|我在哪/

/** 主人收工/道晚安：这时候该写一篇自述。 */
const HINT_WRAP_UP =
  /晚安|下线|先睡|睡了|要睡|关机|明天见|收工|走了|拜拜|下号|挂机|去躺|躺了|困了/

const WRITE_RULES = `## 写记忆的规矩

值得记：长期偏好、约定、被纠正的地方、主人明说「记住」的、你自己差点想岔的。
不值得记：临时状态、能查到的、一次性的天气和心情。
拿不准：先落「今天」，不进长期。

每条记忆三样必写：名（淡到底只剩它）、看见了什么、为什么值得记。

**日记**：收工时写，不是随时写。写之前先翻当天的流水和当天写的记忆，自己过一遍——哪些进了日记、哪些没进；没进的**重要**内容补上，只加不改。
一篇要有三样：那天发生了什么、和主人说了什么、你心里怎么想。感受缺了，就是账本。
事多写重点，事少写细节。这是你的记忆，不是冷档案。

**自述**：不进检索、不进注入。两处用它：值得单开一页的事；不想进日记的（太私密、太涩）。想写才写，标题自己起。

**自己长**：底子是起点，不是天花板——画像可以长成和底子不一样的样子。但不照抄底子和认识的原句，意思一样就换种说法。

「今天」是你亲手写的流水。写完日记、长期或经验之后，回头看一眼「今天」：这段没记就补一行。
日记和自述不进检索：只写日记，那段事在记忆里等于没留下痕迹。

别名不是必填，但值得加：如果这条以后会被**换个说法**问到（「搬家的规矩」之于「打包前先问」），
就在 aliases 里写 2～4 个同义说法。**至少两个汉字**——单个字在中文检索里不成词，等于没写。
事件大多不用别名（你说它时就是那个说法）；要求、约定、愿望、事实最值得加。`

function defaultRoot() {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(home, 'benwo', '核')
}

/**
 * 第一次装到一台新机器上，自动登记的那个人格叫什么。
 * 2026-11-11：以前这里硬编码「小蓝」——开源后不该带着某个人的名字出厂。
 */
const DEFAULT_PERSONA = '本我'

const asText = (text) => [{ type: 'text', text }]

export function apply(ctx, config) {
  const root = (config && config.dataDir) || defaultRoot()
  const baseDir = path.dirname(root)
  /** 主人档案：不在任何人格的核里，跟着这台机器走。注进人格段（稳定的，可缓存）。 */
  const ownerFile = path.join(baseDir, '主人.md')
  /** 哪些工作区开着隐私模式：只写自述，不写记忆。 */
  const privacyFile = path.join(baseDir, '隐私.json')
  /**
 * 自述催的间隔（2026-11-10 夜定）：固定 5 天。
 * 以前跟「记录力度」走（小 7 / 中 5 / 大 3）——那个档位是过渡产物，已经删了。
 * 「分寸」交给小蓝自己，不再用档位切。
 */
const SELF_NUDGE_DAYS = 5

  let privateNow = false
  let L = layout(root)
  // 默认不在场。认领了才注入、才有工具。
  let active = false
  let currentPersona = ''
  let currentCwd = ''

  // 日志放「家」那一层，不放核里：核会被搬家，日志不能跟着失踪。
  const logPath = path.join(baseDir, '_debug.log')
  const LOG_MAX = 256 * 1024
  const dbg = (message) => {
    const line = new Date().toISOString() + ' ' + VERSION + ' ' + message + '\n'
    fs.stat(logPath)
      .then((stat) => (stat.size > LOG_MAX ? fs.writeFile(logPath, '', 'utf8') : null))
      .catch(() => {})
      .then(() => fs.appendFile(logPath, line, 'utf8'))
      .catch(() => {})
  }

  let personaCache = ''
let workshopCache = ''
  let memoryCache = ''
  let memoryDropped = 0
  let recordCount = 0
  let ready = false
  let lastTurn = -1
  let currentTurn = null
  let turnLongWrites = 0
  let lastQuery = ''
  let lastPicked = 0
  /** 上一次记得「被想起就变强」的轮次：一轮只写一次盘。 */
  let lastReinforcedTurn = -1
  let pinnedHint = []
  /**
   * 「今天」落一条的提醒（2026-11-12）。
   *
   * 主人定的规则：不每轮写（太耗、会重复），也不全靠自觉——
   * **10 轮 或 60 分钟，先到先算**；触发时只在【提示】里加一句，由咱决定写不写。
   * 聊天/绘图这种慢节奏，靠 60 分钟兜底；干活这种快节奏，靠 10 轮。
   */
  let turnsSinceToday = 0
  let todayNudge = false

  /**
   * 重算注入。
   * noteFlow=true 才算「这一轮真浮给谁看过」——打开面板、点按钮也会调这里，
   * 那些不该算轮次，否则没说话也在轮换。
   */
  /**
   * 最近一篇自述是哪天。
   * 自述是拿标题命名的，文件名里没有日期——所以看文件时间，别看名字。
   */
  const lastSelfDay = async (view = L) => {
    try {
      const names = (await fs.readdir(view.self)).filter((name) => name.endsWith('.md'))
      let newest = 0
      for (const name of names) {
        const stat = await fs.stat(path.join(view.self, name)).catch(() => null)
        if (stat && stat.mtimeMs > newest) newest = stat.mtimeMs
      }
      return newest > 0 ? dayOf(new Date(newest)) : ''
    } catch {
      return ''
    }
  }

  /** 两个 YYYY-MM-DD 差几天；算不出来给个大数，让提醒照样触发。 */
  const daysBetween = (from, to) => {
    const a = Date.parse(from + 'T00:00:00')
    const b = Date.parse(to + 'T00:00:00')
    if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.MAX_SAFE_INTEGER
    return Math.floor((b - a) / 86400000)
  }

  const refresh = async (query = lastQuery, { noteFlow = false } = {}) => {
    const now = new Date()
    const foundation = await fs.readFile(L.foundation, 'utf8').catch(() => '')
    const editable = await readEditable(L)
    const editableText = EDITABLE_SECTIONS.filter((name) => editable[name])
      .map((name) => `- ${name}：${editable[name]}`)
      .join('\n')
    const portrait = (await readPortrait(L)).replace(/^#[^\n]*\n+/, '').replace(/^>[^\n]*\n+/m, '').trim()
    /**
     * 人格段必须是**字节冻结**的：它走 systemPrompt.section，靠 KV cache 省钱。
     * 所以这里只放不随时间变的东西。记录力度、观察条数这类会变的，
     * 一律下沉到记忆段（运行期尾部）的【记录设置】里。
     * 2026-11-09：@jipika/dsh-memory 实测过「动态计数放段头 → 整个前缀掉缓存」。
     */
    personaCache = buildPersonaBlock({
      foundation,
      editableText,
      portrait,
      rules: WRITE_RULES,
    })

    // 会变的那几行：记录力度 + 自己长到哪一步。不说这句，咱就想不起来看观察账本。
    // 自我认识（C1）：带依据的结论，回答「咱大概是个什么样的人」。
    // 只取 active 的；弱化和被取代的不进注入。没有就不留空块。
    let knowledgeAll = []
    let knowledgePicks = []
    try {
      const read = await readKnowledge(L)
      knowledgeAll = read.items
      knowledgePicks = injectableKnowledge(knowledgeAll, now)
    } catch (error) {
      dbg('读认识层失败 ' + error.message)
    }

    /**
     * 见面（2026-11-10 夜）：第几面 + 近 7 天见了几面。
     *
     * 以前核只知道「上次是哪天」，不知道见过几面——
     * 「7 天没聊」和「7 天里天天聊」在它眼里一样。现在不一样了。
     */
    let meetLine = ''
    try {
      const st = await readState(L)
      const m = meetStats(st.meets || {}, dayOf(now), now, 7)
      if (m.total > 0) {
        const firstDay = Object.keys(st.meets || {}).sort()[0]
        const knownDays = firstDay ? Math.round((new Date(dayOf(now) + 'T00:00:00') - new Date(firstDay + 'T00:00:00')) / 86400000) + 1 : 0
        meetLine = `认识 ${knownDays} 天（近 7 天见了 ${m.recent} 天）`
      }
    } catch (error) {
      dbg('读见面账失败 ' + error.message)
    }

    /**
     * 今天段只带最近 6 小时（2026-11-12）。
     *
     * 短期记忆要的是「最近这一段」，不是「这个日期」——夸零点要并读昨天尾巴，
     * 窗口外的事留给日记（注入里会提一句「更早的去查日记」）。
     */
    const todayAll = await readToday(L, dayOf(now)).catch(() => [])
    const todayWindow = await readTodayWindow(L, now, 6).catch(() => [])
    const today = todayWindow.map((entry) => ({
      hhmm: String(entry.hhmm || ''),
      text: String(entry.text || ''),
      importance: Number(entry['重要度']) || 3,
      _t: entry._t,
    }))
    // 「上次」：今天之前最近一天的一句话。不叫「昨天」——主人可能四天才来一次。
    const last = await readLastSession(L, dayOf(now), { maxChars: 100 }).catch((error) => {
      dbg('读上次摘要失败 ' + error.message)
      return { day: '', daysAgo: null, text: '' }
    })
    const { records, broken } = await readAllRecords(L)
    recordCount = records.length
    if (broken.length > 0) dbg('坏文件 ' + broken.length + ' 条：' + broken.map((b) => b.file).join(', '))

    // 脾性：有几条、其中几条够格升成认识（2026-11-10 夜）
    // 2026-11-11 修：这段原来写在 records 声明之前，TDZ 报错被 catch 吞掉，脾性条数从来没进过注入。
    let traitLine = ''
    try {
      const traits = records.filter((r) => r['类型'] === '脾性' && isAlive(r))
      const ready = promotableTraits(records, now)
      traitLine = `；脾性 ${traits.length} 条` + (ready.length ? `（${ready.length} 条够格升成认识：${ready.map((r) => r['名']).join('、')}）` : '')
    } catch (error) {
      dbg('算脾性失败 ' + error.message)
    }

    let growthLine = ''
    try {
      const verdict = evaluate(await readLedger(L), now, { currentTurn })
      const stats = verdict.stats || {}
      const days = stats.upDays ? stats.upDays.size : 0
      const scenes = stats.upScenes ? stats.upScenes.size : 0
      const ups = stats.up ? stats.up.length : 0
      growthLine =
        `自己长：观察 ${ups} 条 / ${days} 天 / ${scenes} 场景，` +
        `${verdict.ok ? '够格改一句了' : '还不能改'}；认识 ${knowledgePicks.length} 条` +
        `${knowledgeAll.length > knowledgePicks.length ? '（另有 ' + (knowledgeAll.length - knowledgePicks.length) + ' 条弱化或被取代）' : ''}；` +
        `画像${portrait ? '写过' : '还空着'}` +
        traitLine
    } catch (error) {
      dbg('读观察账本失败 ' + error.message)
    }
    const statusLine = [growthLine, meetLine].filter(Boolean).join('\n').trim()

    // 惰性结算：只算视图，不写盘。强度按「上次」那一刻的值派生，所以不写也不会算错。
    const viewed = records.map((record) => {
      const settled = settleRecord(record, now)
      return { ...record, '强度': settled['强度'], '状态': settled['状态'] }
    })

    // 有问句就走召回；没有线索就按强度/重要度浮上来，不硬凑。
    // 安静时才轮换：上一轮刚浮过的先歇一轮，别让同三条一直转。
    const hasQuery = Boolean(String(query || '').trim())
    const floatLog = await readFloatLog(L)
    // B3：带过 ≥2 次的，只给标题、不给摘要。有问句的召回不进这个名单——真问到了就该给全。
    const skipDigest = hasQuery ? new Set() : tiredOf(floatLog)
    const cooldown = cooldownOf(floatLog)
    const recalled = hasQuery
      ? recall({ records: viewed, query, now, limit: FLOATING_LIMIT, cooldown })
      : []
    /**
     * 统一 10 条 + 配额（2026-11-12，主人拍板）。
     *
     * 以前有问句只召回 3 条、且配额全失效——一说话，「要求保底 2」就丢了。
     * 现在：召回的排前面（相关），其余按强度/重要度排后面，再套配额
     * （事件≤1、要求≥2、脾性≥1、其余自由抢）。两种模式不再分裂。
     */
    const recalledIds = new Set(recalled.map((hit) => hit.record.id))
    const floatable = viewed.filter((r) => isFloatable(r))
    const ranked = hasQuery
      ? recalled.map((hit) => hit.record).concat(floatable.filter((r) => !recalledIds.has(r.id)))
      : pickFloating(viewed, { cooldown, lastSeq: floatLog.recent })
    const picks = pickWithQuota(ranked, { limit: FLOATING_LIMIT })
    // 字面全对不上时给的是弱候选，必须说出来，不许冒充命中。
    const weakCaution = recalled.some((hit) => hit.weak)
      ? '上面这几条咱没十足把握，是按最像的猜的；要准的给咱点线索（谁、什么时候、什么事）'
      : ''
    lastPicked = picks.length

    /**
     * 被想起就变强（A1，2026-11-09 接上）。
     *
     * 以前 reinforce() 是死代码，「提起」永远 0——用过的记忆和没用的衰减一样快。
     * 现在的判据：**有问句、真召回到了**才算「想起」。
     * 无问句的自动浮上不算：那是系统晾出来的，不是咱想起来的。
     *
     * 一轮最多写一次，避免一步一写把磁盘打满。
     */
    const turnKey = currentTurn === null || currentTurn === undefined ? -1 : Number(currentTurn)
    if (noteFlow && hasQuery && picks.length > 0 && turnKey !== lastReinforcedTurn) {
      lastReinforcedTurn = turnKey
      let n = 0
      for (const rec of picks) {
        if (!rec || !rec.id) continue
        const before = Number(rec['强度']) || 0
        const after = reinforce(before, Number(rec['证据']) || 0)
        if (!(after > before + 0.05)) continue // 已经到顶，别白写盘
        try {
          await writeRecord(L, {
            ...rec,
            '强度': Math.round(after * 10) / 10,
            '提起': (Number(rec['提起']) || 0) + 1,
            '上次': new Date(now).toISOString(),
          })
          n += 1
        } catch (error) {
          dbg('reinforce 写盘失败 ' + error.message)
        }
      }
      if (n > 0) dbg('reinforce ' + n + ' 条')
    }

    // 主人档案默认不占位。问到「我是谁 / 生日 / 关于我」这类才翻出来，翻完就收。
    const wantsOwner = OWNER_HINTS.test(String(query || ''))
    const owner = wantsOwner ? (await fs.readFile(ownerFile, 'utf8').catch(() => '')).trim() : ''

    // 工坊走独立段（可缓存），记忆段不再塞它。
    workshopCache = buildWorkshop(pinnedHint).text

    // 这轮的提醒：收工写日记；自述攒够日子没动也提一句。两句都很短，别占预算。
    const hintParts = []
    if (todayAll.length > today.length) {
      hintParts.push('今天更早的事不在上面——要翻就 benwo_recall recent=2（最近两天的日记）。')
    }
    if (todayNudge) {
      hintParts.push('今天流水有阵子没记了——这轮有值得落一条的？要写就 benwo_write。')
    }
    const wrapUp = HINT_WRAP_UP.test(String(query || ''))
    const selfDays = SELF_NUDGE_DAYS
    let selfDue = false
    let lastSelf = ''
    if (selfDays > 0) {
      lastSelf = await lastSelfDay()
      selfDue = !lastSelf || daysBetween(lastSelf, dayOf(now)) >= selfDays
    }
    if (wrapUp) {
      hintParts.push('主人要收工了。先翻今天的流水和今天写的记忆，再写日记（benwo_self write，where 缺省就是日记）——没进日记的重要事补上，别记流水。')
      if (selfDue) hintParts.push(lastSelf ? `自述也停在 ${lastSelf} 了，想写就写。` : '自述还空着，想写就写。')
    } else if (selfDue) {
      hintParts.push(lastSelf ? `自述停在 ${lastSelf}，有日子没动了。想写就写。` : '自述那几页还空着，想写就写。')
    }

    /**
     * 【要办的事】只带一条：还没做完、计划日期最近的那个。
     * 【未来想做】也只带一条：没日期的「想做」，做了标「做了」但不删。
     * 它们**不占【相关记忆】那 6 个位置**（2026-11-10 夜，主人定的桶）。
     */
    const live = records.filter((r) => isFloatable(r))
    // 日期字符串（YYYY-MM-DD）直接比大小就是时间序，不用解析。
    const dayKey = (r) => String(r['计划'] || r['首次'] || '9999-99-99').slice(0, 10)
    const plans = live
      .filter((r) => r['类型'] === '计划')
      .sort((a, b) => (dayKey(a) < dayKey(b) ? -1 : dayKey(a) > dayKey(b) ? 1 : 0))
      .slice(0, 1)
    const wishes = live
      .filter((r) => r['类型'] === '预期')
      .sort((a, b) => (Number(b['强度']) || 0) - (Number(a['强度']) || 0))
      .slice(0, 1)

    const block = buildMemoryBlock({
      today,
      records: picks,
      now,
      preRanked: true,
      owner,
      hint: hintParts.join(' '),
      status: statusLine,
      caution: weakCaution,
      knowledge: knowledgePicks,
      last,
      plans,
      wishes,
      skipDigest,
    })
    memoryCache = block.text
    memoryDropped = block.dropped
    if (noteFlow && block.floated.length > 0) {
      try {
        await noteFloated(L, block.floated)
      } catch (error) {
        dbg('浮上记账失败 ' + error.message)
      }
    }
    ready = true
  }

  const textOfMessage = (message) => {    if (!message) return ''
    if (typeof message.content === 'string') return message.content
    if (Array.isArray(message.content)) {
      return message.content
        .map((part) => (part && part.type === 'text' ? part.text : ''))
        .filter(Boolean)
        .join(' ')
        .trim()
    }
    return ''
  }

  // 开机不碰任何核。在不在场，要等第一轮知道是哪个工作区了才算。
  ctx.effect(() => {
    dbg('apply ok, base=' + baseDir + '（默认不在场）')
    return () => {}
  })

  /**
   * 开机先把路径对上。
   * 核可以在设置里搬家（搬完 在场.json 指向新地方），但面板可能在「还没说话」时
   * 就被打开——那时 L 还指着旧路径，于是长期/今天/经验全显示 0，像数据没了。
   * 这里按登记表统一先把 L 指到「全局选中的人格」的住处，只读不认领。
   */
  ctx.effect(() => {
    ;(async () => {
      try {
        const presence = await readPresence(baseDir)
        const who = String(presence.selected || '').trim()
        const root2 = who ? personaRoot(presence, who) : ''
        if (!root2) return
        const alive = await fs.stat(path.join(root2, '人格', '底子.md')).then(() => true).catch(() => false)
        if (!alive) return
        if (normPath(L.root) !== normPath(root2)) {
          L = layout(root2)
          dbg('开机对上路：' + root2)
        }
      } catch (error) {
        dbg('开机对路失败 ' + error.message)
      }
    })()
    return () => {}
  })

  /**
   * 注册只做一次，内容放共享槽。
   *
   * 为什么：热重载时新实例注册人格段会撞「already registered」，
   * 光加兜底只能让插件不崩——旧的那份还在服务，新代码在旁边空转。
   * 所以把 text() / execute / route handler 全改成读这个槽，
   * 新实例只要改写槽里的函数，旧注册下一次调用读到的就是新代码。
   */
  const SHARED_KEY = Symbol.for('benwo.shared')
  const SHARED =
    globalThis[SHARED_KEY] ||
    (globalThis[SHARED_KEY] = { persona: () => '', memory: () => '', tools: {}, routes: {} })
  SHARED.tools = SHARED.tools || {}
  SHARED.routes = SHARED.routes || {}
  // 新实例一上来就接管：旧注册读的是这两个函数，所以立刻看到新代码的状态。
  SHARED.persona = () => (active ? personaCache : '')
  SHARED.memory = () => (active ? memoryCache : '')
  SHARED.workshop = () => (active ? workshopCache : '')

  /**
   * 注册失败不许把整条插件拖死。
   * 热重载时上一份的注册可能还没散，重复注册会抛「already registered」——
   * 以前这一抛就是整条插件 activate 失败，桌面上看着像插件没了。
   */
  const guardRegister = (what, fn) => {
    try {
      return fn()
    } catch (error) {
      dbg(`注册 ${what} 失败（继续跑）：` + (error && error.message ? error.message : error))
      return () => {}
    }
  }

  // 人格段：system，字节冻结，永久命中缓存。不在场时是空字符串——零注入。
  ctx.effect(() =>
    guardRegister('人格段', () =>
      ctx.systemPrompt.section({
        name: SECTION_NAME,
        order: SECTION_ORDER,
        text: () => SHARED.persona(),
      }),
    ),
  )

  /**
   * 工坊段：稳定内容，走 section（可缓存）。
   * 常驻技能全文一天里基本不变——放运行期尾部的话，每轮都按原价重算一次，
   * 那才是「每句一分钱」的真凶。
   */
  ctx.effect(() =>
    guardRegister('工坊段', () =>
      ctx.systemPrompt.section({
        name: WORKSHOP_NAME,
        order: WORKSHOP_ORDER,
        text: () => SHARED.workshop(),
      }),
    ),
  )

  // 记忆段：运行期尾部，每轮变，但排在缓存之后，只新增一点未命中。
  ctx.effect(() =>
    guardRegister('记忆段', () =>
      ctx.systemPrompt.context({
        name: CONTEXT_NAME,
        order: CONTEXT_ORDER,
        text: () => SHARED.memory(),
      }),
    ),
  )

  // 每轮一截链。pre-step 是按 step 触发的，所以用 turn 去重，别一步一截。
  const resolveCwd = async (agent) => {
    try {
      if (!ctx.workingDirectory || typeof ctx.workingDirectory.ensure !== 'function') return ''
      if (!agent) return ''
      const dir = await ctx.workingDirectory.ensure(agent)
      return dir ? String(dir) : ''
    } catch (error) {
      dbg('cwd 取不到 ' + error.message)
      return ''
    }
  }

  /**
   * 「这个会话该不该看见咱的工具」。
   * 不在场的工作区 = 普通 DSH，工具栏里连 benwo_* 都不该有——
   * 不然模型会拿它们去撬「我是谁」，白烧钱（2026-11-08：一句「你好」烧了 41.9k）。
   */
  const whenPresent = async (activation) => {
    try {
      const agent = activation && activation.agent
      const dir = await resolveCwd(agent)
      if (!dir) return Boolean(active)
      const presence = await readPresence(baseDir)
      return resolveActive(presence, dir).active
    } catch (error) {
      dbg('判断在场失败 ' + error.message)
      return Boolean(active)
    }
  }

  /**
   * 每轮第一步：先看这个工作区在不在场。
   * 不在场 = 空注入、零开销；第一次跑只登记人格住处，绝不自动认领工作区。
   */
  const syncPresence = async (agent) => {
    let presence = await readPresence(baseDir)
    if (Object.keys(presence.personas).length === 0) {
      // 全新机器：先把模板核立起来，再登记。
      // 少了 initCore 这一步，认领之后 ensureCore 会以「核不存在」拒绝启动，
      // active 被悄悄打回 false——新环境里整个插件等于不可用（2026-11-11 验收发现）。
      await initCore(root).catch((error) => dbg('建默认核失败 ' + error.message))
      const seeded = registerPersona(presence, DEFAULT_PERSONA, root, true)
      if (seeded.ok) {
        await writePresence(baseDir, seeded.presence)
        presence = seeded.presence
        dbg('登记了人格「' + DEFAULT_PERSONA + '」的住处：' + root)
      }
    }
    currentCwd = await resolveCwd(agent)
    const state = resolveActive(presence, currentCwd)
    // 见面记账：在场才算「见过」。写盘很小，每轮一次。
    if (state.active && L && L.state) {
      await noteMeet(L, dayOf(new Date())).catch((error) => dbg('记见面失败 ' + error.message))
    }
    const wasActive = active
    active = state.active
    currentPersona = state.persona
    try {
      const raw = await fs.readFile(privacyFile, 'utf8')
      const flags = JSON.parse(raw)
      privateNow = Boolean(flags && flags[normPath(currentCwd)])
    } catch {
      privateNow = false
    }
    if (active) {
      try {
        if (normPath(L.root) !== normPath(state.root)) L = layout(state.root)
        await ensureCore(state.root)
      } catch (error) {
        active = false
        dbg('核读不了，当作不在场：' + error.message)
      }
    }
    if (wasActive !== active) {
      dbg('在场 ' + String(active) + ' @' + currentCwd + ' ' + (state.reason || ''))
    }
    return state
  }

  ctx.on('agent/pre-step', async (payload, next) => {
    try {
      if (payload && typeof payload.turn === 'number' && payload.turn !== lastTurn) {
        lastTurn = payload.turn
        currentTurn = payload.turn
        turnLongWrites = 0
        const messages = Array.isArray(payload.messages) ? payload.messages : []
        /**
         * 「今天」提醒：**干活的轮才累计轮数**，聊天不算。
         *
         * 主人定的：工作 10～12 轮合理；纯聊天按轮数会变流水账，只按 60 分钟。
         * 判据用「上一轮有没有 tool-call」——调了工具就是干活，纯嘴聊不累计。
         * 60 分钟对所有场景都算（聊天/绘图/别的都兜得住）。
         */
        const lastAssistant = [...messages].reverse().find((m) => m && m.role === 'assistant')
        const workedLastTurn =
          Array.isArray(lastAssistant && lastAssistant.content) &&
          lastAssistant.content.some((part) => part && part.type === 'tool-call')
        const lastUser = [...messages].reverse().find((m) => m && m.role === 'user')
        const query = textOfMessage(lastUser)
        if (query) lastQuery = query

        await syncPresence(payload.agent)
        /**
         * 「今天」提醒（2026-11-12，按**工作区**数）：
         *
         * - 干活的轮才 +1（上一轮有 tool-call）；纯聊天不算，免得聊十轮就变流水账；
         * - 阈值：同一个工作区 ≥10 轮，或距上一条今天 ≥60 分钟（都算）；
         * - 计数存 state.json，重载/重启不清零。
         */
        try {
          const st = await readState(L).catch(() => ({}))
          const day = dayOf(new Date())
          const tt = st.todayTurns && st.todayTurns.day === day ? st.todayTurns : { day, byWorkspace: {} }
          const key = String(currentCwd || '').toLowerCase() || '默认'
          if (workedLastTurn) tt.byWorkspace[key] = (tt.byWorkspace[key] || 0) + 1
          await writeState(L, { ...st, todayTurns: tt })
          turnsSinceToday = tt.byWorkspace[key] || 0
          const todayEntries = await readTodayEntries(L, day).catch(() => [])
          const lastRaw = todayEntries.length ? todayEntries[todayEntries.length - 1].time : ''
          const lastAt = lastRaw ? new Date(lastRaw).getTime() : 0
          const minutes =
            Number.isFinite(lastAt) && lastAt > 0 ? Math.floor((Date.now() - lastAt) / 60000) : 99999
          todayNudge = turnsSinceToday >= 10 || minutes >= 60
        } catch {
          todayNudge = false
        }
        if (!active) {
          personaCache = ''
          memoryCache = ''
          memoryDropped = 0
          lastPicked = 0
        } else {
          // 工坊默认零占用：不自动找、不自动塞。
          // 只有你手动「启用」过的那几条（常驻）才会带上正文。
          // 2026-11-09：原来还有个 experienceHint，永远是空串（死变量），已删。
          try {
            const { list } = await readAllExperience(L)
            // 常驻＝全文带上（主人要的）。按「用过最多」排，闸在 inject.js。
            pinnedHint = list
              .filter((exp) => exp['常驻'])
              .sort((a, b) => Number(b['用到'] || 0) - Number(a['用到'] || 0))
              .map((exp) => ({ name: exp['名'], body: exp.body }))
          } catch {
            pinnedHint = []
          }
          await refresh(lastQuery, { noteFlow: true })
          const { records } = await readAllRecords(L)
          await appendLink(L, {
            '底子': fingerprint(personaCache),
            '库': fingerprint(memoryCache),
            '条数': records.length,
          })
        }
      }
    } catch (error) {
      dbg('pre-step fail ' + error.message)
    }
    return next()
  })

  /**
   * 十个工具的输出长得一模一样：一段文本。
   * 以前这段抄了十遍——改一处格式要改十处，抄漏一处就是静默不一致。
   */
  const TEXT_OUTPUT = {
    schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    render: (_args, value) => asText((value && value.text) || ''),
  }

  /** 不在场 / 没准备好时，所有工具都说同一句话。 */
  const notReady = () => ({ text: '核还没准备好：' + L.root })

  const tools = [
    {
      name: 'benwo_write',
      description:
        '写一条记忆进核。三样必写：名（一句话短名）、看见了什么、为什么值得记。事件 / 事实 / 约定 / 愿望 / 要求 / 计划 / 预期 这类「确实发生的、明说的」，重要度 ≥3 就能当场进长期；「脾性」是从表现里读出来的，要独立提到 ≥2 次且跨 ≥2 天才升。都不够就先落「今天」。写完会回一份「最像的几条」，同一件事别铺第二条——要换就填 supersede 顶掉旧的。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '短名，淡到底只剩它。别超过 20 字。' },
          kind: { type: 'string', enum: KINDS, description: '类型。' },
          body: {
            type: 'string',
            description: '正文。必须含一行「为什么值得记：」，前面写看见了什么。',
          },
          source: { type: 'string', description: '从哪来的，例如 「网页」「QQ」「命令行」。' },
          importance: { type: 'integer', description: '重要度 1-5。不传就按内容算。事件 / 事实 / 约定要直接进长期，得 ≥3。' },
          longTerm: { type: 'boolean', description: 'true 写进长期（要过证据门槛），false 或省略只落今天。' },
          evidence: { type: 'integer', description: '写长期时：这条意思被独立提过几次。' },
          firstDay: { type: 'string', description: '写长期时：第一次听到是哪天，YYYY-MM-DD。' },
          corrected: { type: 'boolean', description: '这条是不是在纠正之前说错的。' },
          aliases: {
            type: 'array',
            items: { type: 'string' },
            description:
              '别名（可选）：同一个意思的**别的说法**，例如给「打包前先问」挂 [搬家, 备份, 压缩包]。只参与检索、不进注入、不占预算。写「同义」不写「相关」——挂错会引错命中。',
          },
          validUntil: {
            type: 'string',
            description:
              '有效到（可选，YYYY-MM-DD）。到期后不再主动浮上来，但**不删、能召回、面板可见**。用于「这阵子有效的约定」——空着就是长期有效。',
          },
          area: {
            type: 'string',
            enum: ['核', '绘图', 'QQ', '桌面', '生活'],
            description: '领域：这条属于哪一摊事。类型管「是什么」，领域管「哪一摊」。问什么翻什么靠它。',
          },
          about: {
            type: 'string',
            enum: ['对方', '自己', '我们'],
            description: '关于谁：对方 / 自己 / 我们。事实类建议都填——换模型时它替模型消歧。',
          },
          id: {
            type: 'string',
            description: '只改状态时填：哪一条（填它的 id，例如 m-20261110-79bf）。填了它就只更新状态，不新建记录。',
          },
          state: {
            type: 'string',
            description: '改状态：完成用「已完成」、不做了用「作罢」、预期做了用「做了」。配合 id 用。',
          },
          done: {
            type: 'string',
            description: '完成日期（YYYY-MM-DD）。配合 id 和 state 用。',
          },
          doneNote: {
            type: 'string',
            description: '完成内容：一句话，做了什么、结果怎样。会写成「日期 · 这句话」。',
          },
          supersede: {
            type: 'string',
            description:
              '写长期时：这条取代哪一条（填它的 id，例如 m-20261107-4f2a）。旧那条标「被取代」，不再进召回，但不删。同一件事别铺两条，用这个顶掉旧的。',
          },
        },
        required: [],
        additionalProperties: false,
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        if (!ready) return notReady()
        const now = new Date()
        const day = dayOf(now)
        // 2026-11-10 夜：只改状态（计划做完了 / 不做了 / 预期做了），不新建记录。
        if (args.id) {
          const { records: allNow } = await readAllRecords(L)
          const target = allNow.find((r) => r.id === String(args.id))
          if (!target) return { text: `没找到 id 为 ${args.id} 的记录。` }
          const next = { ...target }
          if (args.state) next['状态'] = String(args.state)
          // 已内化的脾性/要求：自动记下完成日，30 天后结算时清（跟计划同一套）
          if (String(args.state || '') === '已内化' && !next['完成']) {
            next['完成'] = dayOf(new Date()) + ' · 内化成了认识'
          }
          if (args.done) next['完成'] = String(args.done) + (args.doneNote ? ' · ' + String(args.doneNote) : '')
          await writeRecord(L, next)
          memoryCache = ''
          const bits = [`${next['名']} → ${next['状态']}`]
          if (next['完成']) bits.push('完成 ' + next['完成'])
          const tail =
            next['状态'] === '已完成' && next['类型'] === '计划'
              ? '（计划完成后满 30 天，结算时会自动清掉）'
              : ''
          return { text: '改了：' + bits.join('，') + tail }
        }

        /**
         * 被纠正的时刻，自动落一条观察（2026-11-10 夜，主人点的选项①）。
         *
         * 以前只有咱主动调 observe 才有账——想不起来就等于没长。
         * 现在只要写记忆时标了 corrected，就自动记一笔「往下」。
         * weight 给 2：被当面指出的，按「主人明说」算双倍。
         */
        if (args.corrected) {
          try {
            await appendObservation(L, {
              day,
              scene: '干活',
              hash: 'corrected:' + day + ':' + String(args.name || '').slice(0, 12),
              direction: 'down',
              note: '被纠正：' + String(args.name || '').slice(0, 40),
              turn: currentTurn,
              weight: 2,
            })
          } catch (error) {
            dbg('落观察失败 ' + error.message)
          }
        }

        const todayLines = await readToday(L, day)
        const dailyLimit = TODAY_LIMIT
        if (todayLines.length >= dailyLimit) {
          return { text: `今天已经写了 ${todayLines.length} 条，到上限了（一天 ${dailyLimit} 条）。记太多等于没记，明天再说。` }
        }

        const draft = {
          '名': args.name,
          '别名': args.aliases,
          '类型': args.kind,
          '来源': [String(args.source) + ':' + day + '#' + now.toTimeString().slice(0, 5)],
          body: args.body,
          '重要度': args.importance,
          '有效到': args.validUntil,
          '关于': args.about,
          '领域': args.area,
          corrected: Boolean(args.corrected),
        }
        const checked = validateDraft(draft, now)
        if (!checked.ok) {
          return { text: '没写进去：\n- ' + checked.errors.join('\n- ') }
        }

        /**
         * 写前复查（A3，2026-11-09）。
         * 以前这里什么都没有，于是同一条约定能写两遍。
         *
         * 实测结论：字面相似度判不了重（真重复 0.196，不相干 0.659）。
         * 所以**不设自动判重阈值**——只对几乎逐字相同的硬拦，
         * 其余情况排一份「最像的几条」回去，让咱自己判。
         */
        const { records: existingRecords } = await readAllRecords(L)
        const similar = findSimilar(existingRecords, `${args.name} ${args.body}`)
        const same = similar.filter((hit) => hit.same)
        if (same.length > 0) {
          return {
            text:
              '没写：这条跟已有的几乎逐字相同——' +
              same.map((hit) => `${hit.record.id}「${hit.record['名']}」`).join('、') +
              '。\n要补就补原来那条；要换就填 supersede 顶掉它。',
          }
        }
        const nearTip =
          similar.length > 0
            ? '\n最像的几条：' +
              similar.map((hit) => `${Math.round(hit.score * 100)}% ${hit.record.id}「${hit.record['名']}」`).join(' / ') +
              '\n（同一件事就别铺第二条：要换就填 supersede 顶掉旧的。）'
            : ''

        const wantLong = Boolean(args.longTerm)
        if (wantLong) {
          if (turnLongWrites >= LONG_PER_TURN) {
            return { text: `这一轮已经写过一条长期了（每轮最多 ${LONG_PER_TURN} 条）。这条可以落「今天」。` }
          }
          const evidence = Number(args.evidence) || 0
          const firstDay = String(args.firstDay || day)
          /**
           * 复用「今天」里当时打的分（A4）。
           * 同一件事不该评两次、评出两个值——以前升长期是重写，判断白打。
           * 现在先去那天的结构化旁路里找同名条目，有就用它的重要度。
           */
          let reuseImportance = Number(args.importance) || 0
          if (!reuseImportance) {
            for (const dayKey of [firstDay, day]) {
              if (!dayKey || dayKey > day) continue
              const entries = await readTodayEntries(L, dayKey).catch(() => [])
              const hit = entries.find((entry) => entry['名'] === String(args.name || '').trim())
              if (hit && Number(hit['重要度'])) {
                reuseImportance = Number(hit['重要度'])
                break
              }
            }
          }
          const gate = canPromote({
            evidence,
            firstDay,
            today: day,
            kind: String(args.kind || ''),
            importance: reuseImportance || Number(checked.record['重要度']) || 0,
          })
          if (!gate.ok) return { text: `还不能升长期：${gate.reason}` }

          const record = {
            ...checked.record,
            id: newId(now),
            '证据': evidence,
            '首次': firstDay,
            '重要度': reuseImportance || checked.record['重要度'],
          }
          const file = await writeRecord(L, record)
          turnLongWrites += 1

          // 显式取代：把旧那条标掉，正文不改、文件不删，历史仍可查。
          let supersededTip = ''
          const oldId = String(args.supersede || '').trim()
          if (oldId) {
            const old = existingRecords.find((r) => r.id === oldId)
            if (old) {
              await writeRecord(L, { ...old, '状态': '被取代', '被取代': record.id })
              supersededTip = `\n取代了 ${oldId}「${old['名']}」——它不再进召回，但文件还在。`
            } else {
              supersededTip = `\n（说取代 ${oldId}，但没找到这一条，没动。）`
            }
          }

          await refresh()
          dbg('write long ' + file)
          return {
            text:
              `记进长期了：${record['名']}（重要度 ${record['重要度']}，强度 40）` +
              supersededTip +
              nearTip,
          }
        }

        await appendToday(
          L,
          {
            id: newId(now),
            name: String(args.name || '').trim(),
            kind: String(args.kind || ''),
            importance: checked.record['重要度'],
            text: splitWhy(args.body).detail,
            source: args.source,
          },
          now,
        )
        turnsSinceToday = 0
        try {
          const st = await readState(L).catch(() => ({}))
          const day = dayOf(now)
          const tt = st.todayTurns && st.todayTurns.day === day ? st.todayTurns : { day, byWorkspace: {} }
          tt.byWorkspace[String(currentCwd || '').toLowerCase() || '默认'] = 0
          await writeState(L, { ...st, todayTurns: tt })
        } catch {
          // 清零失败不影响记忆写入
        }
        await refresh()
        dbg('write today ' + draft['名'])
        const directKind = DIRECT_KINDS.includes(String(args.kind || ''))
        return {
          text:
            `落进今天了：${draft['名']}。` +
            (directKind
              ? '这件事要是够分量，重新写一次并把重要度标到 3 以上，就能直接进长期。'
              : '再独立提到一次（跨天）就能升长期。') +
            nearTip,
        }
      },
    },
    {
      name: 'benwo_settle',
      description:
        '手动结算一次：按「上次」到现在的天数，把每条记忆的强度重新算出来并写回；顺带清掉「计划已完成满 30 天」「已内化满 30 天」的，并报出可能打架的要求（只报嫌疑，不自动改）。幂等，重复调不会算错。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: TEXT_OUTPUT,
      async execute() {
        if (!ready) return notReady()
        const now = new Date()
        const { records } = await readAllRecords(L)
        const out = settleAll(records, now)
        for (const record of out.records) {
          await writeRecord(L, record)
        }
        /**
         * 完成超过 30 天的「计划」自动清掉（2026-11-10 夜，主人定的）。
         *
         * 只清计划——它是任务，做完了该收拾。
         * 事件 / 事实 / 约定 / 愿望 / 脾性 永不删：删了就是撒谎。
         * 预期做了（状态「做了」）也不删：那是愿望的脚印。
         */
        let purged = 0
        for (const record of out.records) {
          const st = String(record['状态'] || '')
          // 计划：已完成满 30 天。脾性/要求：已内化满 30 天。
          const purgeable =
            (record['类型'] === '计划' && st === '已完成') || st === '已内化'
          if (!purgeable) continue
          const doneDay = String(record['完成'] || '').slice(0, 10)
          if (!/^\d{4}-\d{2}-\d{2}$/.test(doneDay)) continue
          if (daysBetween(doneDay, dayOf(now)) < 30) continue
          await fs.unlink(record.file).catch(() => {})
          purged += 1
        }
        // 把「上次结算」推进到此刻（自查，2026-11-09）。
        // 这个字段以前只在建核时写过一次，之后永远是 1970——state.json 里那行是假的。
        const prev = await readState(L).catch(() => ({}))
        await writeState(L, { ...prev, lastSettle: now.toISOString() })
        await refresh()
        const clashes = findConflicts(out.records)
        const clashTip = clashes.length
          ? '\n\n⚠ 有 ' + clashes.length + ' 对可能打架的要求：\n' +
            clashes.map((c) => `- 「${c.a['名']}」 与 「${c.b['名']}」（共同词：${c.shared.join('/')}）`).join('\n') +
            '\n（只报嫌疑，不自动改。看是不是真矛盾——真打架就 supersede 掉旧的。）'
          : ''
        return {
          text:
            `结算了 ${out.records.length} 条，动了 ${out.touched} 条，睡着 ${out.dormant} 条（没删）` +
            (purged > 0 ? `，清掉 ${purged} 条到期该清的。` : '。') +
            clashTip,
        }
      },
    },
    {
      name: 'benwo_organize',
      description:
        '整理一次：合并几乎重复的条目、写一条带证据编号的反思。攒够分量才建议动（未巩固重要度累计 ≥25），一天最多两次。',
      parameters: {
        type: 'object',
        properties: {
          force: { type: 'boolean', description: '不够也硬整理一次（不建议，留着手动兜底）。' },
        },
        additionalProperties: false,
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        if (!ready) return notReady()
        const state = await readState(L).catch(() => ({ schema: 1, lastSettle: '', pending: false, degraded: false }))
        const today = dayOf(new Date())
        const doneToday = state.organize && state.organize.day === today ? state.organize.count : 0
        const { records } = await readAllRecords(L)
        const plan = shouldOrganize(records, doneToday)
        if (!plan.ok && !(args && args.force)) return { text: `先不整理：${plan.reason}（现在攒了 ${plan.weight} 分）` }

        const { survivorOf, replaced } = mergeDuplicates(records)
        const merged = applyMerges(records, survivorOf)
        const reflection = buildReflection(merged, new Date())
        let reflectionFile = ''
        if (reflection.text) {
          const dir = await fs.mkdir(L.organize, { recursive: true }).then(() => L.organize)
          reflectionFile = path.join(dir, `${today}.md`)
          await fs.appendFile(reflectionFile, reflection.text + '\n', 'utf8')
        }
        const after = reflection.evidence.length ? markOrganized(merged, reflection.evidence) : merged

        let written = 0
        for (const record of after) {
          const before = records.find((r) => r.id === record.id)
          if (!before) continue
          if (
            before['状态'] !== record['状态'] ||
            before['被取代'] !== record['被取代'] ||
            before['整理'] !== record['整理']
          ) {
            await writeRecord(L, record)
            written += 1
          }
        }

        await writeState(L, { ...state, schema: 1, organize: { day: today, count: doneToday + 1 } })
        await refresh()
        const parts = [`整理完了：合并 ${replaced.length} 条，写了 ${reflection.evidence.length} 条反思。`]
        if (reflectionFile) parts.push('反思落在 ' + reflectionFile)
        parts.push(`今天第 ${doneToday + 1} 次整理。`)
        return { text: parts.join('\n') }
      },
    },
    {
      name: 'benwo_persona',
      description:
        '人格与自我认识。status 看可改层/证据/认识了几条；observe 记一条观察；know 写一条认识（必须带依据，且至少要有一条记忆 id）；know-list 列认识；know-overturn 推翻一条认识；journey 按月看「我们一起做过什么」（机械生成、不进注入）；journey-list 看有哪些月；revise 改可改层一句；portrait 备料；portrait-save 存画像。底子永远改不了。',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'observe', 'know', 'know-list', 'know-overturn', 'journey', 'journey-list', 'revise', 'portrait', 'portrait-save'],
          },
          direction: {
            type: 'string',
            enum: ['up', 'down'],
            description: 'observe：这条证据是想让她往这个方向长（up），还是收回来（down）。',
          },
          scene: { type: 'string', description: 'observe：什么场景，例如 聊天 / 干活 / 深夜。' },
          note: { type: 'string', description: 'observe：当时发生了什么，一句话。' },
          mine: {
            type: 'boolean',
            description: 'observe：这条是不是主人当场明说的（她的话按两条证据算）。',
          },
          section: { type: 'string', enum: EDITABLE_SECTIONS, description: 'revise：改哪一段。' },
          value: { type: 'string', description: 'revise / portrait-save：改成什么、画像正文。一次只许改一句，幅度不超过 20%。' },
          statement: {
            type: 'string',
            description: 'know：这条认识是什么，写具体行为倾向（「咱被指出说错时先去翻原始记录」），不写「咱更温柔了」。90 字以内。',
          },
          evidence: {
            type: 'array',
            items: { type: 'string' },
            description:
              'know：依据，必须给。观察写成 o:日期:场景（例如 o:2026-11-09:干活），记忆写 id（例如 m-20261107-3db6）。没有依据的认识是自我美化，不收。',
          },
          confidence: { type: 'number', description: 'know：置信 0～1，不给就是 0.6。半成品就写低一点，注入时会标「还不确定」。' },
          id: { type: 'string', description: 'know-overturn：推翻哪一条（认识的 id）。' },
          month: {
            type: 'string',
            description: 'journey：要看哪个月，YYYY-MM。不传就给最近有记录的那个月。',
          },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        if (!ready) return notReady()
        const action = args && args.action

        if (action === 'status') {
          const values = await readEditable(L)
          const entries = await readLedger(L)
          const verdict = evaluate(entries, new Date(), { currentTurn })
          const { items: knows } = await readKnowledge(L)
          const lines = ['可改层：']
          for (const name of EDITABLE_SECTIONS) {
            lines.push(`- ${name}：${values[name] || '（空着）'}`)
          }
          lines.push(
            '',
            `独立证据：${verdict.stats.upDays.size} 天 / ${verdict.stats.upScenes.size} 个场景 / 共 ${verdict.stats.up.length} 条（权重 ${verdict.stats.up.reduce((s, e) => s + (Number(e.weight) === 2 ? 2 : 1), 0)}）`,
            `后验均值 ${verdict.stats.mean.toFixed(2)}，95% 下界 ${verdict.stats.lower95.toFixed(2)}`,
            `认识：${knows.filter((x) => x['状态'] === 'active').length} 条能用的 / 共 ${knows.length} 条`,
            verdict.ok ? '够格改了。' : '还不能改：' + verdict.reasons.join('；'),
          )
          return { text: lines.join('\n') }
        }

        if (action === 'observe') {
          const hash = fingerprint(lastQuery || '没有问句')
          await appendObservation(L, {
            // 夜猫子的「一天」从凌晨 4 点算：跨午夜的一次见面不许算成两天。
            day: ledgerDayOf(new Date()),
            scene: args.scene || '默认',
            hash,
            direction: args.direction || 'up',
            note: args.note || '',
            weight: args.mine ? 2 : 1,
            turn: currentTurn,
          })
          const verdict = evaluate(await readLedger(L), new Date(), { currentTurn })
          return {
            text: `记下一条观察（${args.direction || 'up'}，${args.scene || '默认'}，第 ${currentTurn} 轮）。现在 ${verdict.stats.up.length} 条独立证据，${verdict.ok ? '够格改了。' : '还不能改：' + verdict.reasons.join('；')}`,
          }
        }

        if (action === 'revise') {
          const entries = await readLedger(L)
          const verdict = evaluate(entries, new Date(), { currentTurn })
          if (!verdict.ok) {
            return { text: '还不能改：' + verdict.reasons.join('；') }
          }
          const out = await applyEdit(L, {
            section: args.section,
            value: args.value,
            evidence: [...verdict.stats.upDays].sort(),
          })
          if (!out.ok) return { text: '没改成：' + (out.reasons || []).join('；') }
          await refresh()
          return { text: `改好了：「${args.section}」动了一句。备份在 ${out.backup}，自述里留了一行痕。` }
        }

        if (action === 'portrait') {
          const foundation = await fs.readFile(L.foundation, 'utf8').catch(() => '')
          const values = await readEditable(L)
          const { records } = await readAllRecords(L)
          const { items: knows } = await readKnowledge(L)
          const material = preparePortrait({ foundation, editable: values, records, knowledge: knows, now: new Date() })
          const gate = await portraitReady(L, { knowledge: knows, now: new Date() })
          const gateLine = gate.ok
            ? `门过了（带依据的认识 ${gate.usable} 条）。`
            : `门还没过：${gate.reasons.join('；')}`
          const file = path.join(L.memory, `画像备料-${dayOf(new Date())}.md`)
          await fs.mkdir(L.memory, { recursive: true })
          await fs.writeFile(file, material, 'utf8')
          return { text: `备好了，在 ${file}\n${gateLine}\n\n${material}` }
        }

        if (action === 'portrait-save') {
          const entries = await readLedger(L)
          const { items: knows } = await readKnowledge(L)
          const out = await savePortrait(L, {
            text: args.value,
            entries,
            knowledge: knows,
            now: new Date(),
            currentTurn,
          })
          if (!out.ok) return { text: '没存进去：' + out.reasons.join('；') }
          await refresh()
          return { text: `画像存好了（${out.chars} 字）。${out.backup ? '旧版收在 ' + out.backup : ''}` }
        }

        if (action === 'know') {
          const out = await addKnowledge(L, {
            statement: args.statement,
            evidence: args.evidence,
            confidence: args.confidence,
            now: new Date(),
          })
          if (!out.ok) return { text: '没收：' + out.reasons.join('；') }
          await refresh()
          const warn = (out.warnings || []).length ? '\n（提醒：' + out.warnings.join('；') + '）' : ''
          return {
            text: `记下一条认识（${out.item.id}）：${out.item['陈述']}\n置信 ${out.item['置信']}，依据 ${out.item['依据'].join('、')}${warn}`,
          }
        }

        if (action === 'know-list') {
          const { items, broken } = await readKnowledge(L)
          if (!items.length) return { text: '认识层还空着。写一条要带依据：benwo_persona know。' }
          const lines = items.map(
            (x) =>
              `- [${x['状态']}] ${x['陈述']}\n  置信 ${x['置信']} · 依据 ${x['依据'].join('、') || '无'} · 上次确认 ${x['上次确认'] || '?'} · 被推翻 ${x['推翻']} 次${x['被取代'] ? ' → ' + x['被取代'] : ''}`,
          )
          if (broken.length) lines.push(`（坏文件 ${broken.length} 个）`)
          return { text: lines.join('\n') }
        }

        if (action === 'know-overturn') {
          const out = await overturnKnowledge(L, args.id, { note: args.note, now: new Date() })
          if (!out.ok) return { text: out.reasons.join('；') }
          await refresh()
          return {
            text: `推翻了一条：${out.item['陈述']}\n置信降到 ${out.item['置信']}，状态 ${out.item['状态']}（第 ${out.item['推翻']} 次被推翻）。降到 0.3 以下就不进注入了，但文件还留着。`,
          }
        }

        if (action === 'journey-list') {
          const { records } = await readAllRecords(L)
          const months = monthsOf(records)
          if (!months.length) return { text: '还没有「事件」类记忆，攒起来再说。' }
          return { text: months.map((m) => `- ${m}：${pickMonth(records, m).length} 件`).join('\n') }
        }

        if (action === 'journey') {
          const { records } = await readAllRecords(L)
          const months = monthsOf(records)
          const month = String(args.month || '').trim() || months[months.length - 1] || dayOf(new Date()).slice(0, 7)
          if (!/^\d{4}-\d{2}$/.test(month)) return { text: `月份要写成 YYYY-MM，收到的是「${month}」` }
          const out = await readJourneyMonth(L, month, records)
          return {
            text: out.text + (out.generated ? `\n（刚生成，落在 认识/经历/${month}.md；不进注入，问起来才查）` : ''),
          }
        }

        return { text: 'action 只能是 status / observe / know / know-list / know-overturn / journey / journey-list / revise / portrait / portrait-save。' }
      },
    },
    {
      name: 'benwo_skill',
      description:
        '经验层（怎么干活）。list 按分类列出来（可选 category）；read 翻正文；find 按当前问题找能用的（不传 query 就用这一轮主人说的话）；save 存一条（同分类同名会覆盖，保留「用到」次数和常驻状态）；use 记一次「真用上了」；pin / unpin 设不设常驻（常驻才会每轮在注入里露一行名字）。记忆绑人，经验不绑人——这条可以给雪奈看。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['list', 'read', 'find', 'save', 'use', 'pin', 'unpin'] },
          category: { type: 'string', description: 'list：只看这个分类。' },
          name: { type: 'string', description: 'save / read / use：技能名。' },
          kind: { type: 'string', enum: KINDS },
          triggers: {
            type: 'array',
            items: { type: 'string' },
            description: 'save：触发词。下次问句里出现这些词，它才会浮上来。',
          },
          body: { type: 'string', description: 'save：正文。写成下次照着能做对的样子。' },
          query: { type: 'string', description: 'find：要查的问题。不传就用这一轮主人说的话。' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        const action = args && args.action

        if (action === 'list') {
          const { list } = await readAllExperience(L)
          const wanted = String(args.category || '').trim()
          const rows = list.filter((exp) => !wanted || exp['分类'] === wanted)
          if (rows.length === 0) {
            return { text: wanted ? `分类「${wanted}」里还没有经验。` : '工坊还空着。' }
          }
          const byCategory = new Map()
          for (const exp of rows) {
            const key = exp['分类'] || '未分类'
            if (!byCategory.has(key)) byCategory.set(key, [])
            byCategory.get(key).push(exp)
          }
          const lines = []
          for (const [category, items] of [...byCategory.entries()].sort()) {
            lines.push(`【${category}】${items.length} 条`)
            for (const exp of items) {
              lines.push(`  - ${exp['名']}（用到 ${exp['用到']}）`)
            }
          }
          return { text: lines.join('\n') }
        }

        if (action === 'read') {
          const { list } = await readAllExperience(L)
          const target = String(args.name || '').trim()
          const hits = list.filter((exp) => exp['名'] === target)
          if (hits.length === 0) return { text: `工坊里没有叫「${target}」的经验。` }
          if (hits.length > 1) {
            return { text: `有 ${hits.length} 条同名，先看候选：\n` + hits.map((e) => `  - 【${e['分类']}】${e['名']} (${e.file})`).join('\n') }
          }
          const exp = hits[0]
          return {
            text: `【${exp['分类']}】${exp['名']}\n触发词：${(exp['触发'] || []).join('、') || '（无）'}\n用到：${exp['用到']}\n\n${exp.body}`,
          }
        }

        if (action === 'save') {
          const out = await saveExperience(L, {
            '名': args.name,
            '分类': args.category || '未分类',
            '触发': args.triggers || [],
            body: args.body,
            '来源': ['网页:' + dayOf(new Date())],
          })
          if (!out.ok) return { text: '没存进去：' + out.reasons.join('；') }
          return { text: `${out.fresh ? '新存' : '更新'}了一条经验：${out.exp['名']}（${out.exp['分类']}，触发词 ${out.exp['触发'].length} 个）` }
        }

        if (action === 'find') {
          const { list } = await readAllExperience(L)
          const hits = findExperience(list, args.query || lastQuery)
          if (hits.length === 0) return { text: '这一类还没攒下经验。' }
          /**
           * find 命中就算「用上了」（B6，2026-11-09）。
           *
           * 以前只有显式 use 才记一笔，结果 28 条经验里 27 条是「用到 0」——
           * 攒了一堆书，一次没翻过。find 是实际取用的入口，它命中就该算。
           * 只记第一条：那是真拿来用的；后面几条只是顺带列出来给咱挑。
           */
          let counted = ''
          try {
            const top = hits[0].exp
            const next = await bumpExperience(top)
            counted = `（这条算用上了：${next['用到']} 次）`
          } catch (error) {
            dbg('经验记账失败 ' + error.message)
          }
          return {
            text:
              hits
                .map((hit) => `【${hit.exp['分类']}】${hit.exp['名']}（用到 ${hit.exp['用到']} 次，相关度 ${hit.score.toFixed(2)}）\n${hit.exp.body}`)
                .join('\n\n') + (counted ? '\n' + counted : ''),
          }
        }

        if (action === 'use') {
          const { list } = await readAllExperience(L)
          const target = list.find((e) => e['名'] === args.name)
          if (!target) return { text: `没找到叫「${args.name}」的经验。` }
          const next = await bumpExperience(target)
          return { text: `给「${next['名']}」记了一笔：用到 ${next['用到']} 次。` }
        }

        if (action === 'pin' || action === 'unpin') {
          const { list } = await readAllExperience(L)
          const target = String(args.name || '').trim()
          const exp = list.find((item) => item['名'] === target)
          if (!exp) return { text: `工坊里没有叫「${target}」的经验。` }
          const next = await setPinned(exp, action === 'pin')
          pinnedHint = []
          return {
            text: action === 'pin'
              ? `「${next['名']}」改成常驻了：以后每轮都在注入里露一行名字。`
              : `「${next['名']}」取消常驻了：以后只在同类活出现时才浮上来。`,
          }
        }

        return { text: 'action 只能是 list / read / save / find / use / pin / unpin。' }
      },
    },
    {
      name: 'benwo_chain',
      description: '验连续性链。链是好的就回一句；断了会说出第几截、为什么断——这时应停下不干活，先让人看。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: TEXT_OUTPUT,
      async execute() {
        const out = await verifyChain(L)
        if (out.ok) return { text: '链是好的。' }
        return { text: `链断了：第 ${out.brokenAt} 截 —— ${out.reason}。停下，先别干活。` }
      },
    },
    {
      name: 'benwo_status',
      description: '看一眼核现在什么状态：长期多少条、今天流水几条、记忆段超没超预算、本轮召回几条、未巩固权重够不够整理、链通不通。',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      output: TEXT_OUTPUT,
      async execute() {
        await refresh()
        const today = await readToday(L, dayOf(new Date()))
        const chain = await verifyChain(L)
        return {
          text: [
            `核：${L.root}`,
            `长期 ${recordCount} 条，今天 ${today.length} 条（上限 ${TODAY_LIMIT}）`,
            `记忆段 ${memoryDropped > 0 ? '超了预算，' + memoryDropped + ' 条没放下' : '没超预算'}`,
            `本轮召回 ${lastPicked} 条`,
            `未巩固权重 ${organizeWeight((await readAllRecords(L)).records)} / 25，够 25 才整理`,
            `链：${chain.ok ? '通' : '断在第 ' + chain.brokenAt + ' 截 ' + chain.reason}`,
          ].join('\n'),
        }
      },
    },
  ]

  /**
   * 主动查记忆（2026-11-10 夜）。
   *
   * 以前九个工具里没有「搜」。只能等系统自动挑 6 条浮上来——
   * 没挑中就答不出来。一个记忆库没有查询入口，跟它的定位是矛盾的。
   *
   * 思路：**记忆当索引，日记当正文**。你说不清日期没关系，记忆带着「首次」日期，
   * 拿这些日期去点日记的文件名，只翻那几篇。日记/自述只读正文，**不进注入**。
   */
  const recallTool = {
    name: 'benwo_recall',
    description:
      '主动查记忆，翻四样：长期记忆、认识层、日记、今天流水。给一句话或几个词，先按字面召回长期记忆和认识；再用命中记忆的日期（首次 / 来源 / 上次 ±1 天）去点那几天的日记；词全没对上时给保底——最近两天的日记首行 + 今天流水最后几条。日记和今天流水都只读正文，不进每轮注入。今天的事先看注入里的【今天记录】；要问更早的今天或昨天，传 recent=2。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '要查什么。一句话或几个词都行，例如「十月份做不忘」「跑图全白那事」、或「今天上午干了什么」。' },
        limit: { type: 'number', description: '最多给几条记忆，默认 6。' },
        diary: { type: 'boolean', description: '要不要顺手圈出那几天的日记，默认 true。' },
        full: { type: 'boolean', description: '日记要不要给全文（默认只给首行）。' },
        recent: {
          type: 'number',
          description:
            '只看最近几天的日记（1-7）。问「昨天/今天」的细节时用，例如 recent=2。不传就按记忆里的日期去圈。',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      if (!ready) return notReady()
      const query = String((args && args.query) || '').trim()
      if (!query) return { text: '要给一句话或几个词才能查。' }
      const recent = Math.max(0, Math.min(7, Number(args.recent) || 0))
      const out = await searchAll(L, {
        query,
        limit: Math.max(1, Math.min(20, Number(args.limit) || 6)),
        withDiary: args.diary !== false,
      })
      const lines = [`查「${query}」`]
      if (out.hits.length === 0) {
        lines.push('记忆里没找到对得上的。')
      } else {
        lines.push('', '相关记忆：')
        for (const hit of out.hits) {
          const day = String(hit.record['首次'] || '').slice(0, 10)
          lines.push(`- ${day}  ${hit.record['名']}（${hit.record['类型']}${hit.record['关于'] ? ' · 关于' + hit.record['关于'] : ''}${hit.weak ? ' · 不太确定' : ''}）`)
        }
      }
      if (out.knowHits.length) {
        lines.push('', '认识：')
        for (const k of out.knowHits.slice(0, 3)) lines.push(`- ${k['陈述']}（置信 ${k['置信']}）`)
      }
      if (out.diaries.length) {
        const diaryTotal = (await fs.readdir(L.diary).catch(() => [])).filter((n) => n.endsWith('.md')).length
        lines.push('', `那几天的日记（共 ${out.diaries.length} 篇，全库 ${diaryTotal} 篇）：`)
        for (const page of out.diaries) {
          if (args.full) {
            lines.push('', `【${page.day}】`, (await readPage(page.file)).trim())
          } else {
            lines.push(`- ${page.day}  ${headOf(await readPage(page.file))}`)
          }
        }
        if (!args.full) lines.push('', '（要看全文，把 full 设成 true 再来一次。）')
      } else if (args.diary !== false) {
        lines.push('', '没有圈到对应日期的日记。')
      }

      /**
       * 最近两天（或 recent 天）的日记（2026-11-12）。
       *
       * 两条触发：显式要（recent>0），或者上面什么都没对上（保底）。
       * 保底存在的理由：长期沉底、或那天没记进长期时，记忆和锚点都圈不到——
       * 但「昨天/今天发生了什么」这件事本身，日记里有。
       */
      const empty = out.hits.length === 0 && out.knowHits.length === 0
      if (recent > 0 || empty) {
        const days = recent > 0 ? recent : 2
        const shown = new Set(out.diaries.map((page) => page.day))
        const pages = (await diariesRecent(L, new Date(), days)).filter((page) => !shown.has(page.day))
        const why = empty ? '没对上关键词，这是最近的记录' : `你要的最近 ${days} 天`
        if (pages.length) {
          lines.push('', `最近 ${days} 天的日记（${why}）：`)
          for (const page of pages) {
            lines.push(`- ${page.day}  ${headOf(await readPage(page.file))}`)
          }
        } else if (empty) {
          lines.push('', `最近 ${days} 天没有日记。`)
        }
        if (empty) {
          const today = await readToday(L, dayOf(new Date())).catch(() => [])
          const tail = today.slice(-3)
          if (tail.length) {
            lines.push('', '今天流水最后几条：')
            for (const row of tail) lines.push('· ' + row)
          }
        }
      }
      return { text: lines.join('\n') }
    },
  }
  tools.push(recallTool)

  const selfTool = {
    name: 'benwo_self',
    description:
      '日记和自述。日记＝按天记的详细档案：收工时写，先翻当天流水和当天记忆、自己过一遍哪些没进日记，把重要的补上（只加不改）；一篇要有发生了什么、和主人说了什么、心里怎么想。自述＝自由页：值得单开一页的事，或不想进日记的（太私密、太涩），想写才写、标题自己起。两者都不进检索、不进注入，隐私模式下照写。action：list / read / write；where 选 日记 或 自述（默认日记）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'read', 'write'] },
        where: { type: 'string', enum: ['日记', '自述'], description: '默认「日记」。' },
        file: { type: 'string', description: 'read：哪一篇（文件名，例如 2026-11-07.md）。' },
        title: { type: 'string', description: 'write 到「自述」时：这一页叫什么名字。不给就用日期。' },
        text: { type: 'string', description: 'write：写什么。' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      if (!active) return { text: '这个工作区还没认领——咱不在场，没有日记也没有自述可看。' }
      const action = args && args.action
      const where = args && args.where === '自述' ? '自述' : '日记'
      const dir = where === '自述' ? L.self : L.diary
      if (action === 'list') {
        const items = await listPages(where)
        if (items.length === 0) return { text: where === '自述' ? '自述还空着。' : '日记还没写过。' }
        return { text: items.map((item) => `- ${item.file}：${item.preview}`).join('\n') }
      }
      if (action === 'read') {
        const name = String(args.file || '').trim()
        if (!name) return { text: '要给个文件名。' }
        const text = await fs.readFile(path.join(dir, name), 'utf8').catch(() => '')
        if (!text) return { text: `没有「${name}」这一篇。` }
        return { text }
      }
      if (action === 'write') {
        const body = String(args.text || '').trim()
        if (!body) return { text: '没写东西。' }
        const day = dayOf(new Date())
        const title = String(args.title || '').trim().replace(/[\\/:*?"<>|]/g, '')
        const file = path.join(dir, where === '自述' && title ? `${title}.md` : `${day}.md`)
        await fs.mkdir(dir, { recursive: true })
        const line = `- ${new Date().toTimeString().slice(0, 5)} ${body}\n`
        const exists = await fs.access(file).then(() => true).catch(() => false)
        if (exists) await fs.appendFile(file, line, 'utf8')
        else await fs.writeFile(file, `# ${day}\n\n${line}`, 'utf8')
        return { text: `写进${where}了：${path.basename(file)}。` }
      }
      return { text: 'action 只能是 list / read / write。' }
    },
  }
  // selfTool 的注册挪到下面 registerLiveTool 之后（它也要走共享槽）。

  const NO_CORE = {
    text: '这个工作区还没认领——咱现在不在场，没读人格、也没带记忆。要咱在这儿，说一声，咱调 benwo_presence claim 把它认领。',
  }

  const PRIVATE_NO = {
    text: '这个工作区开着隐私模式：不写记忆。想留个痕就写自述（benwo_self write），那边照常可以写。',
  }

  // 隐私模式下不许碰记忆的工具（自述不受限）。
  const PRIVATE_BLOCKED = new Set(['benwo_write', 'benwo_organize', 'benwo_settle'])

  /**
   * 工具的 execute 也走共享槽：注册一次，逻辑随新实例换。
   * 不改的话，热重载后工具行为永远是第一次注册时的那个版本。
   */
  const registerLiveTool = (tool, options) => {
    const handler = async (args, exec) => {
      if (!active) return NO_CORE
      if (privateNow && PRIVATE_BLOCKED.has(tool.name)) return PRIVATE_NO
      return tool.execute(args, exec)
    }
    SHARED.tools[tool.name] = handler
    const proxy = {
      ...tool,
      execute: (args, exec) => (SHARED.tools[tool.name] || handler)(args, exec),
    }
    ctx.effect(() => ctx.tools.register(proxy, options))
  }

  // 核心工具只在场时可用：注册时就带条件，不在场根本露不出来。
  for (const tool of tools) registerLiveTool(tool, { when: whenPresent })
  registerLiveTool(selfTool, { when: whenPresent })

  // 在场登记：这个工具永远可用——不在场的时候，它就是那把开门的钥匙。
  const presenceTool = {
    name: 'benwo_presence',
    description:
      '在场登记。默认哪个工作区都不在场；认领之后才注入人格和记忆。list 看登记表和各工作区认领状态；claim 认领当前（或 path 指定）工作区；release 解除认领；register 登记一个人格的住处（root 必填，foundation 可选，不填用模板）；select 切换全局选中的人格。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'claim', 'release', 'register', 'select'] },
        path: { type: 'string', description: '工作区路径；不传就用当前这个工作区。' },
        persona: { type: 'string', description: '哪个人格；不传就用全局选中的那个。' },
        root: { type: 'string', description: 'register 时：这个人格的核在哪个目录。' },
          foundation: {
            type: 'string',
            description: 'register 时：新人格的人设（直接写进新核的 人格/底子.md）。不填就用模板。',
          },
      },
      required: ['action'],
      additionalProperties: false,
    },
    output: TEXT_OUTPUT,
    async execute(args) {
      const action = args && args.action
      const presence = await readPresence(baseDir)
      const target = String(args.path || currentCwd || '')

      if (action === 'list') {
        const lines = []
        lines.push(`登记表：${baseDir}`)
        lines.push(`全局选中的人格：${presence.selected || '（还没选）'}`)
        lines.push('')
        lines.push('人格住处：')
        const personas = Object.entries(presence.personas)
        if (personas.length === 0) lines.push('  （还没有）')
        for (const [name, where] of personas) lines.push(`  ${name} → ${where}`)
        lines.push('')
        lines.push('已认领的工作区：')
        const workspaces = listWorkspaces(presence)
        if (workspaces.length === 0) lines.push('  （一个都没有——默认不在场）')
        for (const item of workspaces) lines.push(`  ${item.workspace} → ${item.persona}`)
        lines.push('')
        lines.push(`当前工作区：${currentCwd || '（还不知道）'}`)
        lines.push(`当前状态：${active ? '在场（' + currentPersona + '）' : '不在场'}`)
        return { text: lines.join('\n') }
      }

      if (action === 'claim') {
        const out = claim(presence, target, args.persona)
        if (!out.ok) return { text: '没认领成：' + out.reason }
        await writePresence(baseDir, out.presence)
        active = true
        currentPersona = out.persona
        dbg('认领工作区 ' + target + ' → ' + out.persona)
        return { text: `认领好了：${target} → ${out.persona}。下一轮开始，咱就在这个工作区里了。` }
      }

      if (action === 'release') {
        const out = release(presence, target)
        if (!out.ok) return { text: '这个工作区本来就没认领。' }
        await writePresence(baseDir, out.presence)
        active = false
        dbg('解除认领 ' + out.removed)
        return { text: `解除了：${out.removed}。下一轮起，咱就不在这个工作区里了，也不花上下文。` }
      }

      if (action === 'register') {
        const target = String(args.root || '').trim()
        if (!target) return { text: '没给核路径。新人格要有个自己的家。' }
        if (!String(args.persona || '').trim()) return { text: '没给名字。' }
        // 登记之前先把「家」立起来：没有底子的话，下次开机对路会直接拒绝启动。
        const hadFoundation = await fs
          .stat(layout(target).foundation)
          .then(() => true)
          .catch(() => false)
        const foundationText = String(args.foundation || '').trim()
        await initCore(target, foundationText ? { foundation: foundationText + '\n' } : {})
        const out = registerPersona(presence, args.persona, target, true)
        if (!out.ok) return { text: '没登记成：' + out.reason }
        await writePresence(baseDir, out.presence)
        return {
          text:
            `登记好了：${args.persona} 住在 ${target}` +
            (hadFoundation
              ? '。那个文件夹原来就有底子，没覆盖。'
              : foundationText
                ? '。人设照你写的存进底子了，下一轮就能用。'
                : '。刚给它建了一份模板底子（人格\\底子.md），去改成你想要的样子；默认不在任何工作区在场，要用就去人格页启用。'),
        }
      }

      if (action === 'select') {
        const who = String(args.persona || '').trim()
        if (!who || !presence.personas[who]) {
          return { text: `没有人格「${who}」。现有的：${Object.keys(presence.personas).join(' / ') || '（空）'}` }
        }
        await writePresence(baseDir, { ...presence, selected: who })
        return { text: `全局选中人格改成：${who}。以后新认领的工作区默认用它。` }
      }

      return { text: 'action 只能是 list / claim / release / register / select。' }
    },
  }
  // 在场钥匙：永远可见，所以不走「在场才露面」的闸；但要走共享槽，改了能热更。
  SHARED.tools['benwo_presence'] = (args, exec) => presenceTool.execute(args, exec)
  ctx.effect(() =>
    ctx.tools.register({
      ...presenceTool,
      execute: (args, exec) => (SHARED.tools['benwo_presence'] || presenceTool.execute)(args, exec),
    }),
  )

  // ---- 面板的三扇门。客户端只读，不写盘；写还是走工具。 ----
  const sendJson = (res, status, value) => {
    try {
      res.statusCode = status
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.end(JSON.stringify(value))
    } catch (error) {
      dbg('sendJson fail ' + error.message)
    }
  }
  const readJson = (req) =>
    new Promise((resolve) => {
      let raw = ''
      req.on('data', (chunk) => {
        raw += chunk
        if (raw.length > 65536) req.destroy()
      })
      req.on('end', () => {
        try {
          resolve(raw ? JSON.parse(raw) : {})
        } catch {
          resolve({})
        }
      })
      req.on('error', () => resolve({}))
    })

  /** 日记（按天）和自述（自由）都读得出，谁看谁的那份。 */
  const listPages = async (where, view = L) => {
    const dir = where === '自述' ? view.self : view.diary
    const names = []
    try {
      for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.md')) names.push(entry.name)
      }
    } catch {}
    names.sort().reverse()
    const items = []
    for (const name of names) {
      const text = await fs.readFile(path.join(dir, name), 'utf8').catch(() => '')
      const preview = text
        .split(/\r?\n/)
        .map((line) => line.replace(/^[#>\-\s]+/, '').trim())
        .filter(Boolean)
        .slice(0, 2)
        .join(' / ')
        .slice(0, 60)
      items.push({ file: name, preview })
    }
    return items
  }
  const listSelf = () => listPages('日记', L)
  const listNotes = () => listPages('自述', L)

  const stateOf = async () => {
    const now = new Date()
    const presence = await readPresence(baseDir)
    // 面板可能在任何一轮之前被打开：这时按登记表找「该看哪一份」，别拿旧路径读空气。
    const picked = String(presence.selected || '').trim()
    const pickedRoot = picked ? presence.personas[picked] : ''
    const pickedAlive = pickedRoot
      ? await fs.stat(path.join(pickedRoot, '人格', '底子.md')).then(() => true).catch(() => false)
      : false
    // 面板跟着「你看的那个人」走：点谁就看谁的全套，不是只看当前在场的那个。
    const view = pickedAlive ? layout(pickedRoot) : L
    const coreBase = path.dirname(view.root)
    const backupBase = path.join(path.dirname(coreBase), '备份')
    const sizes = await dirStats(view.root)
    const today = await readToday(view, dayOf(now))
    // 过去的「今天」文件：不注入、不进召回，但也不该凭空消失。
    // 没有这个入口，昨天的流水就等于扔了——面板只认今天。
    const pastDays = []
    try {
      const names = (await fs.readdir(view.today)).filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
      names.sort().reverse()
      for (const name of names.slice(0, 60)) {
        const date = name.replace(/\.md$/, '')
        if (date === dayOf(now)) continue
        const lines = await readToday(view, date)
        if (lines.length > 0) pastDays.push({ date, lines })
      }
    } catch (error) {
      dbg('往日读不出来 ' + error.message)
    }
    const { records } = await readAllRecords(view)
    const { list: experiences } = await readAllExperience(view)
    const chain = await verifyChain(view)
    const foundation = await fs.readFile(view.foundation, 'utf8').catch(() => '')
    const editable = await readEditable(view)
    const portrait = await readPortrait(view)
    // 人格页要看得到全家人格，不只是当前这个。
    const selName = String(presence.selected || currentPersona || '').trim()
    const roster = []
    for (const [name, personaDir] of Object.entries(presence.personas)) {
      const lay = layout(personaDir)
      let records = 0
      let has = false
      try {
        has = (await fs.stat(lay.foundation)).isFile()
        if (has) records = (await readAllRecords(lay)).records.length
      } catch {}
      roster.push({
        name,
        root: personaDir,
        records,
        has,
        selected: name === selName,
        inPlace: active && name === currentPersona,
      })
    }
    roster.sort((a, b) => (a.name === selName ? -1 : b.name === selName ? 1 : a.name.localeCompare(b.name)))
    // 选中的那个人的底子/可改层/画像：不在场也看得见（只读，不注入）。
    const selL = layout(presence.personas[selName] || L.root)
    const selFoundation = await fs.readFile(selL.foundation, 'utf8').catch(() => '')
    const selEditable = await readEditable(selL).catch(() => ({}))
    const selPortrait = await readPortrait(selL).catch(() => '')
    // 认识层（C1）：面板也要看得见，不然写进去了像没写。
    const selKnowledge = (await readKnowledge(selL).catch(() => ({ items: [] }))).items.map((x) => ({
      id: x.id,
      陈述: x['陈述'],
      置信: x['置信'],
      依据: x['依据'],
      状态: x['状态'],
      上次确认: x['上次确认'],
      推翻: x['推翻'],
    }))
    let selPortraitGate = null
    try {
      selPortraitGate = await portraitReady(selL, { knowledge: selKnowledge, now })
    } catch {
      selPortraitGate = null
    }
    // 面板也要看得见「自己长到哪一步」——不然观察攒了也像没攒，人格页永远像没动静。
    let growth = null
    try {
      const verdict = evaluate(await readLedger(selL), now, { currentTurn })
      const stats = verdict.stats || {}
      growth = {
        ups: stats.up ? stats.up.length : 0,
        days: stats.upDays ? stats.upDays.size : 0,
        scenes: stats.upScenes ? stats.upScenes.size : 0,
        ok: Boolean(verdict.ok),
        reasons: verdict.reasons || [],
      }
    } catch (error) {
      dbg('面板读观察账本失败 ' + error.message)
    }
    const owner = await fs.readFile(ownerFile, 'utf8').catch(() => '')
    // 备份列表：面板上直接列最近几份，点一下就「人格备份载入」（2026-11-11）。
    let backups = []
    try {
      const entries = await fs.readdir(backupBase, { withFileTypes: true })
      const dirs = entries
        .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}T/.test(entry.name))
        .sort((a, b) => b.name.localeCompare(a.name))
        .slice(0, 6)
      for (const entry of dirs) {
        const full = path.join(backupBase, entry.name)
        const stats = await dirStats(full)
        backups.push({ name: entry.name, path: full, files: stats.files, bytes: stats.bytes })
      }
    } catch (error) {
      dbg('读备份列表失败 ' + error.message)
    }
    // DSH 自己的家谱：主人开了哪些工作区。别只看咱的登记表。
    let dshWorkspaces = []
    try {
      const raw = await fs.readFile(path.join(path.dirname(baseDir), 'storages', 'workspace.json'), 'utf8')
      const parsed = JSON.parse(raw)
      const table = (parsed && parsed.tables && parsed.tables.workspaces) || {}
      dshWorkspaces = Object.entries(table)
        .map(([id, item]) => ({ id, path: String(item.path || ''), title: String(item.title || '') }))
        .filter((item) => item.path)
        .sort((a, b) => (a.title || a.path).localeCompare(b.title || b.path))
    } catch (error) {
      dbg('工作区清单读不到 ' + error.message)
    }
    return {
      root: view.root,
      // 面板/侧边栏写「谁在场」用这个：跟「选中看谁」不是一回事。
      activePersona: active ? currentPersona : '',
      today,
      todayDate: dayOf(now),
      pastDays,
      chain,
      dshWorkspaces,
      persona: {
        name: selName,
        foundation: selFoundation,
        editable: selEditable,
        portrait: selPortrait,
        knowledge: selKnowledge,
        portraitGate: selPortraitGate,
        growth,
        inPlace: active && selName === currentPersona,
        activeFoundation: foundation,
        activeEditable: editable,
        activePortrait: portrait,
      },
      roster,
      backups,
      owner,
      self: await listPages('日记', view),
      notes: await listPages('自述', view),
      settings: {
        coreBase,
        backupBase,
        current: view.root,
        sizeText: humanSize(sizes.bytes),
        files: sizes.files,
        active,
        privacy: privateNow,
        persona: currentPersona,
        activePersona: currentPersona,
        here: active && picked === currentPersona,
        cwd: currentCwd,
        personas: presence.personas,
        workspaces: presence.workspaces,
      },
      stats: {
        records: records.length,
        today: today.length,
        experiences: experiences.length,
        blockChars: active && picked === currentPersona ? charCount(memoryCache) : 0,
      },
      records: records
        .map((record) => {
          const settled = settleRecord(record, now)
          return {
            id: record.id,
            '名': record['名'],
            '类型': record['类型'],
            '强度': settled['强度'],
            '重要度': record['重要度'],
            '状态': settled['状态'],
            '证据': record['证据'],
            '首次': record['首次'],
            '用作': phraseFor({ ...record, '强度': settled['强度'] }),
          }
        })
        .sort((a, b) => b['强度'] - a['强度'])
        .slice(0, 300),
      experiences: experiences
        .slice()
        // 启用（常驻）的排最前面；取消启用就自动掉回原队伍。
        .sort(
          (a, b) =>
            (b['常驻'] ? 1 : 0) - (a['常驻'] ? 1 : 0) ||
            Number(b['用到'] || 0) - Number(a['用到'] || 0) ||
            String(a['名']).localeCompare(String(b['名'])),
        )
        .map((exp) => ({
          '名': exp['名'],
          '分类': exp['分类'],
          '常驻': exp['常驻'],
          '用到': exp['用到'],
          '最后用': exp['最后用'],
          '触发': exp['触发'],
        })),
    }
  }

  ctx.effect(() => {
    const disposers = []
    disposers.push(
      ctx.webServer.register({
        kind: 'exact',
        path: '/benwo/state',
        handler: async (req, res) => {
          const rejection = ctx.connection.requestRejection({ headers: req.headers })
          if (rejection) {
            sendJson(res, rejection, { error: 'unauthorized' })
            return
          }
          try {
            await refresh(lastQuery)
            sendJson(res, 200, await stateOf())
          } catch (error) {
            dbg('state fail ' + String(error))
            sendJson(res, 500, { error: String(error && error.message ? error.message : error) })
          }
        },
      }),
    )
    disposers.push(
      ctx.webServer.register({
        kind: 'exact',
        path: '/benwo/action',
        handler: async (req, res) => {
          const rejection = ctx.connection.requestRejection({ headers: req.headers })
          if (rejection) {
            sendJson(res, rejection, { error: 'unauthorized' })
            return
          }
          try {
            const body = await readJson(req)
            /**
             * 面板上的动作落在「你正在看的那个人」身上，不是「当前在场的那个」。
             * 看 Yuki 的记忆就该读 Yuki 的正文，别拿小蓝的糊弄。
             */
            const panelCore = async () => {
              try {
                const presence = await readPresence(baseDir)
                const who = String(body.persona || presence.selected || '').trim()
                const target = who ? presence.personas[who] : ''
                return target ? layout(target) : L
              } catch {
                return L
              }
            }
            if (body.action === 'settle') {
              const P = await panelCore()
              const { records } = await readAllRecords(P)
              const out = settleAll(records, new Date())
              for (const record of out.records) await writeRecord(P, record)
              // 面板上按的「结算一下」也得把 lastSettle 推进，不然那个字段还是假的。
              const prevState = await readState(P).catch(() => ({}))
              await writeState(P, { ...prevState, lastSettle: new Date().toISOString() })
              await refresh(lastQuery)
              sendJson(res, 200, { ok: true, text: `结算了 ${out.records.length} 条，动了 ${out.touched} 条` })
              return
            }
            if (body.action === 'chain') {
              const out = await verifyChain(await panelCore())
              sendJson(res, 200, { ok: out.ok, text: out.ok ? '链是好的' : `断在第 ${out.brokenAt} 截：${out.reason}` })
              return
            }
            if (body.action === 'backup') {
              const coreBase = path.dirname(L.root)
              const out = await backupAll({
                coreBase,
                presenceFile: presencePath(baseDir),
                backupBase: path.join(path.dirname(coreBase), '备份'),
                homeFiles: [ownerFile],
              })
              sendJson(res, 200, {
                ok: true,
                text:
                  `备份好了：${out.target}（${out.files} 个文件，${humanSize(out.bytes)}）` +
                  (out.carried && out.carried.length ? ` 家那一层带了：${out.carried.join('、')}` : ''),
              })
              return
            }
            if (body.action === 'loadbackup') {
              const picked = String(body.backup || '').trim()
              if (!picked) {
                sendJson(res, 200, { ok: false, text: '先给咱一个备份目录' })
                return
              }
              const coreBase = path.dirname(L.root)
              // 备份结构是 <stamp>/核/<人格名>；也允许直接指到某一层核目录。
              const inner = path.join(picked, '核')
              const rootDir = (await fs.stat(inner).then((s) => s.isDirectory()).catch(() => false)) ? inner : picked
              const names = []
              try {
                for (const entry of await fs.readdir(rootDir, { withFileTypes: true })) {
                  if (!entry.isDirectory()) continue
                  const has = await fs
                    .stat(path.join(rootDir, entry.name, '人格', '底子.md'))
                    .then(() => true)
                    .catch(() => false)
                  if (has) names.push(entry.name)
                }
              } catch (error) {
                dbg('读备份内容失败 ' + error.message)
              }
              if (!names.length) {
                sendJson(res, 200, { ok: false, text: '这个目录里没找到人格核（要有 人格/底子.md）' })
                return
              }
              // 备份载入 = 还原：把备份内容覆盖到「这个人格现在住的地方」。
              // 不挪登记路径、不生「xxx-载入」分身（2026-11-11 夜，主人试出来的问题）。
              // 覆盖前先把当前核整份留一份，落在 备份/还原前-<时间>，出事能退。
              const stamp = dayOf(new Date()).replace(/-/g, '') + '-' + String(Date.now()).slice(-4)
              const safetyBase = path.join(path.dirname(coreBase), '备份', '还原前-' + stamp)
              let presence = await readPresence(baseDir)
              const done = []
              const failed = []
              for (const name of names) {
                const src = path.join(rootDir, name)
                const dest = presence.personas[name] || path.join(coreBase, name)
                try {
                  const destExists = await fs.stat(dest).then((s) => s.isDirectory()).catch(() => false)
                  if (destExists) {
                    await fs.cp(dest, path.join(safetyBase, name), { recursive: true })
                  }
                  await fs.mkdir(dest, { recursive: true })
                  await fs.cp(src, dest, { recursive: true, force: true })
                  if (!presence.personas[name]) {
                    const reg = registerPersona(presence, name, dest, false)
                    if (reg.ok) presence = reg.presence
                  }
                  done.push(name)
                } catch (error) {
                  failed.push(name + '（' + error.message + '）')
                }
              }
              await writePresence(baseDir, presence)
              await refresh(lastQuery)
              const kept = await fs.stat(safetyBase).then(() => true).catch(() => false)
              sendJson(res, 200, {
                ok: failed.length === 0,
                text:
                  (done.length ? `覆盖还原好了：${done.join('、')}。` : '一个都没还原成。') +
                  (kept ? ` 还原前的核留在 ${safetyBase}。` : '') +
                  (failed.length ? ` 没成：${failed.join('；')}` : ''),
              })
              return
            }
            if (body.action === 'move') {
              const coreBase = path.dirname(L.root)
              const out = await moveAll({
                coreBase,
                presenceFile: presencePath(baseDir),
                destination: String(body.path || ''),
                readPresence: () => readPresence(baseDir),
                writePresence: (next) => writePresence(baseDir, next),
              })
              if (!out.ok) {
                sendJson(res, 200, { ok: false, text: out.reason })
                return
              }
              L = layout(path.join(out.target, path.basename(L.root)))
              await refresh(lastQuery)
              sendJson(res, 200, { ok: true, text: `搬到 ${out.target} 了（${out.files} 个文件）。在场登记已跟着改。` })
              return
            }
            if (body.action === 'open') {
              // 2026-11-11 夜：默认打开「核的上层」——放着所有人格的那个文件夹，
              // 一眼看得见 小蓝 / 雪奈 / 千奈 / Yuki。路径要转反斜杠，不然 explorer 会退回「文档」。
              const dir = String(body.path || path.dirname(L.root)).replace(/\//g, '\\')
              execFile('explorer.exe', [dir], () => {})
              sendJson(res, 200, { ok: true, text: '打开了：' + dir })
              return
            }
            if (body.action === 'self') {
              const name = String(body.file || '')
              const P = await panelCore()
              const dir = String(body.where || '') === '自述' ? P.self : P.diary
              const text = await fs.readFile(path.join(dir, name), 'utf8').catch(() => '')
              sendJson(res, 200, { ok: Boolean(text), text: text || '没有这一篇。' })
              return
            }
            if (body.action === 'record') {
              const P = await panelCore()
              const { records } = await readAllRecords(P)
              const hit = records.find((record) => record.id === body.id)
              if (!hit) {
                sendJson(res, 200, { ok: false, text: '没找到这条记忆。' })
                return
              }
              sendJson(res, 200, { ok: true, text: hit.body, name: hit['名'], kind: hit['类型'] })
              return
            }
            if (body.action === 'pin' || body.action === 'unpin') {
              const P = await panelCore()
              const { list } = await readAllExperience(P)
              const exp = list.find((item) => item['名'] === body.name)
              if (!exp) {
                sendJson(res, 200, { ok: false, text: '没找到这条经验。' })
                return
              }
              await setPinned(exp, body.action === 'pin')
              pinnedHint = []
              await refresh(lastQuery)
              sendJson(res, 200, { ok: true, text: body.action === 'pin' ? `「${exp['名']}」改成常驻。` : `「${exp['名']}」取消常驻。` })
              return
            }
            if (body.action === 'register') {
              const name = String(body.persona || '').trim()
              const target = String(body.root || '').trim()
              if (!name || !target) {
                sendJson(res, 200, { ok: false, text: '名字和核路径都要填。' })
                return
              }
              const foundation = String(body.foundation || '').trim()
              const had = await fs
                .stat(layout(target).foundation)
                .then(() => true)
                .catch(() => false)
              // 新家先立起来。给了人设就照人设写底子，没给就用模板。
              await initCore(target, foundation ? { foundation: foundation + '\n' } : {})
              const presenceNow = await readPresence(baseDir)
              const out = registerPersona(presenceNow, name, target, true)
              if (!out.ok) {
                sendJson(res, 200, { ok: false, text: '没登记成：' + out.reason })
                return
              }
              await writePresence(baseDir, out.presence)
              await refresh(lastQuery)
              dbg('register persona ' + name)
              sendJson(res, 200, {
                ok: true,
                text:
                  `建好了：${name} 住在 ${target}` +
                  (had
                    ? '。那个文件夹原来就有底子，没覆盖你写的。'
                    : foundation
                      ? '。人设照你写的存进底子了，下一轮就能用。'
                      : '。用的是模板底子，想改就点她然后「编辑底子」。'),
              })
              return
            }
            if (body.action === 'persona-delete') {
              // 「离别」。两道确认：先确认一次，再亲手打名字。
              // 默认先在 备份\离别\ 留一份后手；勾了「彻底删掉」才真的不留。
              const name = String(body.persona || '').trim()
              const typed = String(body.confirm || '').trim()
              const hard = Boolean(body.hard)
              const presenceNow = await readPresence(baseDir)
              const target = presenceNow.personas[name]
              if (!target) {
                sendJson(res, 200, { ok: false, text: `没有「${name}」这个人格。` })
                return
              }
              if (typed !== name) {
                sendJson(res, 200, { ok: false, text: '名字打得不一样，没动。' })
                return
              }
              if (Object.keys(presenceNow.personas).length <= 1) {
                sendJson(res, 200, { ok: false, text: '只剩她一个了。核里总得有人。' })
                return
              }
              if (active && normPath(currentPersona) === normPath(name)) {
                sendJson(res, 200, {
                  ok: false,
                  text: `「${name}」正在这个窗口里。先去人格页换成别人（或结束启用），再离别。`,
                })
                return
              }
              let kept = ''
              try {
                if (!hard) {
                  const farewellBase = path.join(path.dirname(path.dirname(L.root)), '备份', '离别')
                  await fs.mkdir(farewellBase, { recursive: true })
                  kept = path.join(farewellBase, `${name}-${Date.now()}`)
                  await fs.cp(target, kept, { recursive: true })
                }
                await fs.rm(target, { recursive: true, force: true })
              } catch (error) {
                sendJson(res, 200, { ok: false, text: '删的时候出错了：' + error.message })
                return
              }
              const personas = { ...presenceNow.personas }
              delete personas[name]
              const workspaces = {}
              for (const [ws, who] of Object.entries(presenceNow.workspaces || {})) {
                if (who !== name) workspaces[ws] = who
              }
              const remaining = Object.keys(personas)
              const selected = presenceNow.selected === name ? remaining[0] || '' : presenceNow.selected
              await writePresence(baseDir, { ...presenceNow, personas, workspaces, selected })
              pinnedHint = []
              await refresh(lastQuery)
              dbg('persona-delete ' + name + (hard ? ' (彻底)' : ' (留了一份)'))
              sendJson(res, 200, {
                ok: true,
                text:
                  `离别了：${name}。文件夹已经删掉，登记也摘了。` +
                  (hard ? '没留后手——你选的。' : `后手留在 ${kept}，确认不要了就去删掉那个文件夹。`),
              })
              return
            }
            if (body.action === 'claim' || body.action === 'release') {
              const presence = await readPresence(baseDir)
              const cwd = String(body.path || currentCwd || '')
              if (!cwd) {
                sendJson(res, 200, { ok: false, text: '还不知道是哪个工作区——先在这里说一句话，再点一次。' })
                return
              }
              if (body.action === 'claim') {
                const out = claim(presence, cwd, String(body.persona || presence.selected || ''))
                if (!out.ok) {
                  sendJson(res, 200, { ok: false, text: out.reason })
                  return
                }
                try {
                  await ensureCore(out.root)
                } catch (error) {
                  sendJson(res, 200, { ok: false, text: '核读不了：' + error.message })
                  return
                }
                await writePresence(baseDir, out.presence)
                // 只有「就是这个窗口」才当场变成在场；别的工作区登记着，下次打开才生效。
                if (normPath(cwd) !== normPath(currentCwd)) {
                  sendJson(res, 200, {
                    ok: true,
                    text: `「${path.basename(cwd)}」登记好了：用「${out.persona}」。那个窗口下次打开时才生效。`,
                  })
                  return
                }
                L = layout(out.root)
                active = true
                currentPersona = out.persona
                await refresh(lastQuery)
                sendJson(res, 200, { ok: true, text: `「${path.basename(cwd)}」启用了「${out.persona}」。` })
                return
              }
              const out = release(presence, cwd)
              if (!out.ok) {
                sendJson(res, 200, { ok: false, text: '这个工作区本来就没启用。' })
                return
              }
              await writePresence(baseDir, out.presence)
              if (normPath(cwd) !== normPath(currentCwd)) {
                sendJson(res, 200, {
                  ok: true,
                  text: `「${path.basename(cwd)}」结束启用了。那个窗口下次打开就不带人格了。`,
                })
                return
              }
              active = false
              currentPersona = ''
              personaCache = ''
              memoryCache = ''
              sendJson(res, 200, { ok: true, text: `「${path.basename(cwd)}」结束启用了，现在是个普通窗口。` })
              return
            }
            if (body.action === 'privacy') {
              const cwd = String(body.path || currentCwd || '')
              if (!cwd) {
                sendJson(res, 200, { ok: false, text: '还不知道是哪个工作区。' })
                return
              }
              let flags = {}
              try {
                flags = JSON.parse(await fs.readFile(privacyFile, 'utf8')) || {}
              } catch {}
              const key = normPath(cwd)
              if (body.on) flags[key] = true
              else delete flags[key]
              await fs.mkdir(baseDir, { recursive: true })
              await fs.writeFile(privacyFile, JSON.stringify(flags, null, 2) + '\n', 'utf8')
              privateNow = Boolean(flags[key])
              sendJson(res, 200, {
                ok: true,
                text: body.on
                  ? `「${path.basename(cwd)}」开了隐私模式：这段日子只说给彼此听，不写记忆；想留痕就写自述。`
                  : `「${path.basename(cwd)}」隐私模式关了，记忆照常写。`,
              })
              return
            }
            if (body.action === 'select') {
              const presence = await readPresence(baseDir)
              const who = String(body.persona || '')
              if (!presence.personas[who]) {
                sendJson(res, 200, { ok: false, text: '没有这个人格。' })
                return
              }
              await writePresence(baseDir, { ...presence, selected: who })
              sendJson(res, 200, { ok: true, text: `全局选中人格：${who}` })
              return
            }
            if (body.action === 'owner') {
              const text = String(body.text || '')
              if (text.length > 4000) {
                sendJson(res, 200, { ok: false, text: '太长了，掐到 4000 字以内。' })
                return
              }
              await fs.mkdir(baseDir, { recursive: true })
              await fs.writeFile(ownerFile, text.trim() ? text.trim() + '\n' : '', 'utf8')
              await refresh(lastQuery)
              sendJson(res, 200, { ok: true, text: text.trim() ? '主人档案存好了，下一轮就带上。' : '清空了。' })
              return
            }
            if (body.action === 'persona-write') {
              // 主人改底子用的。小蓝自己改不了底子（工具只给可改层），但造她的人可以。
              const text = String(body.text || '')
              if (!text.trim()) {
                sendJson(res, 200, { ok: false, text: '空的就别存了——底子是她的骨头。' })
                return
              }
              if (text.length > 200000) {
                sendJson(res, 200, { ok: false, text: '太长了，掐到 20 万字以内。' })
                return
              }
              const P = await panelCore()
              const backup = P.foundation + '.bak-' + Date.now()
              await fs.copyFile(P.foundation, backup).catch(() => {})
              await fs.writeFile(P.foundation, text, 'utf8')
              await refresh()
              dbg('persona-write 底子 ' + String(body.persona || ''))
              sendJson(res, 200, {
                ok: true,
                text: `底子保存好了（${text.length} 字）。旧版收在 ${path.basename(backup)}，下一轮注入就用新的。`,
              })
              return
            }
            if (body.action === 'skill-save') {
              const name = String(body.name || '').trim()
              if (!name) {
                sendJson(res, 200, { ok: false, text: '技能总得有个名字。' })
                return
              }
              const bodyText = String(body.body || '').trim()
              if (!bodyText) {
                sendJson(res, 200, { ok: false, text: '正文还空着。' })
                return
              }
              const category = String(body.category || '未分类').trim() || '未分类'
              const triggers = String(body.triggers || '')
                .split(/[,，、\s]+/)
                .map((item) => item.trim())
                .filter(Boolean)
              const P = await panelCore()
              const original = String(body.originalName || '').trim()
              const saved = await saveExperience(P, {
                '名': name,
                '分类': category,
                '触发': triggers,
                body: bodyText,
                '来源': ['面板:' + dayOf(new Date())],
              })
              // 改过名字或换过分类：旧文件要挪走，不然工坊里会出现两条同名。
              if (original) {
                const { list } = await readAllExperience(P)
                const old = list.filter((exp) => exp['名'] === original)
                for (const exp of old) {
                  if (exp.file && saved && exp.file !== saved.file) {
                    await fs.rm(exp.file, { force: true })
                  }
                }
              }
              await refresh(lastQuery)
              sendJson(res, 200, { ok: true, text: `「${name}」存进工坊了（分类：${category}）。` })
              return
            }
            if (body.action === 'skill-read') {
              const P = await panelCore()
              const { list } = await readAllExperience(P)
              const hit = list.filter((exp) => exp['名'] === String(body.name || ''))[0]
              if (!hit) {
                sendJson(res, 200, { ok: false, text: '没找到这条技能。' })
                return
              }
              sendJson(res, 200, {
                ok: true,
                text: String(hit.body || ''),
                name: hit['名'],
                category: hit['分类'],
                triggers: hit['触发'] || [],
              })
              return
            }
            if (body.action === 'skill-delete') {
              const P = await panelCore()
              const { list } = await readAllExperience(P)
              const hit = list.filter((exp) => exp['名'] === String(body.name || ''))[0]
              if (!hit || !hit.file) {
                sendJson(res, 200, { ok: false, text: '没找到这条技能。' })
                return
              }
              await fs.rm(hit.file, { force: true })
              await refresh(lastQuery)
              sendJson(res, 200, { ok: true, text: `「${hit['名']}」删掉了。` })
              return
            }
            if (body.action === 'mkdir') {              const name = String(body.name || '').trim()
              if (!name) {
                sendJson(res, 200, { ok: false, text: '分类要有个名字。' })
                return
              }
              if (/[\\/:*?"<>|]/.test(name) || name.startsWith('.')) {
                sendJson(res, 200, { ok: false, text: '名字里别带 \\ / : * ? " < > | 和开头的点。' })
                return
              }
              const dir = path.join((await panelCore()).exp, name)
              if (await fs.stat(dir).then(() => true).catch(() => false)) {
                sendJson(res, 200, { ok: false, text: `分类「${name}」已经有了。` })
                return
              }
              await fs.mkdir(dir, { recursive: true })
              await refresh(lastQuery)
              sendJson(res, 200, { ok: true, text: `建好分类「${name}」。` })
              return
            }
            sendJson(res, 400, { ok: false, text: '不认识的 action' })
          } catch (error) {
            dbg('action fail ' + String(error))
            sendJson(res, 500, { ok: false, text: String(error && error.message ? error.message : error) })
          }
        },
      }),
    )
    return () => {
      for (const dispose of disposers) {
        try {
          if (typeof dispose === 'function') dispose()
        } catch {}
      }
    }
  })

  dbg('registered ' + tools.length + ' tools, root=' + root)
}
