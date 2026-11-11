/**
 * 本我回响之核 · 面板（客户端）。
 *
 * 一个入口，全名「本我回响之核」；里面六个页签：
 *   记忆 —— 长期、今天
 *   人格 —— 底子、可改层、画像
 *   工坊 —— 经验（怎么干活，可以给雪奈看）
 *
 * 只读。真正的写入只有一条路：模型调工具。界面不该对文件有第二种说法。
 *
 * 血泪教训：返回对象必须带 `inject: ['slots']`，否则 Cordis 会在 slots 就绪前
 * 激活本插件，ctx.slots 为 undefined，apply 抛错 → fiber = failed → 前端启动
 * 校验失败 → 桌面端打不开。apply 里还加了兜底，宁可不挂载也不抛。
 */
window.__ModuleLoader__.load({
  id: 'dsh-benwo',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    const TITLE_BASE = '本我回响之核'
    /**
     * 侧边栏只写插件名，不写人格名。
     * 2026-11-11 晚：试过在侧边栏 label 里异步拉「当前工作区是谁」，
     * 但 label 是同步渲染、异步更新不保证重绘——一直显示「无人格」，反而更糟。
     * 人格名挪到面板大标题（那里数据是同步的），侧边栏保持恒定。
     */
    const SIDEBAR_LABEL = TITLE_BASE
    /** 面板大标题：前面挂当前工作区在场的人格；没有就写「无人格」。 */
    const makeTitle = (name) => (name ? name + '·' + TITLE_BASE : '无人格·' + TITLE_BASE)

    const DICT = {
      sub: '记忆不长在云上',
      tabs: { memory: '记忆', persona: '人格', workshop: '工坊', diary: '日记', self: '自述', settings: '设置' },
      hints: {
        memory: '发生过的事都在这儿，点一条看全文',
        persona: '我是谁 · 长得慢，但每一步都翻得回去',
        workshop: '怎么干活 · 设成常驻，才会每轮露个名字',
        diary: '按天记的日子 · 晚安的时候写一篇，不进检索',
        self: '完全由咱自己做主的那几页 · 谁也不查它',
        settings: '家在哪儿 · 存一份 · 搬个地方 · 换谁在场',
      },
      loading: '正在把核打开…',
      retry: '再试一次',
      refresh: '刷新',
      settle: '结算一下（按日子淡一点）',
      verify: '摸摸链',
      records: '长期记着',
      today: '今天',
      experiences: '手上的活',
      budget: '每轮带上',
      chainOk: '链没断，一直连着',
      chainBroken: '链断了',
      emptyMem: '长期里还什么都没有。说一句「记住这个」，咱就写第一条。',
      emptyToday: '今天还没写下什么。',
      emptyExp: '工坊空着。干完一件活，把做法记进来。',
      foundation: '底子（谁也改不动，包括咱）',
      editable: '可以长的地方',
      portrait: '咱给自己画的像',
      noPortrait: '还没给自己画过像。',
      noEditable: '这几段还空着，慢慢来。',
    }

    async function call(path, body) {
      const init = body
        ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
        : { method: 'GET', credentials: 'same-origin' }
      try {
        const res = await fetch('/benwo/' + path, init)
        const text = await res.text()
        if (!res.ok) return { error: 'HTTP ' + res.status + ' · ' + text.slice(0, 160) }
        try {
          return JSON.parse(text)
        } catch {
          return { error: '返回的不是 JSON' }
        }
      } catch (error) {
        return { error: String((error && error.message) || error) }
      }
    }

    const T = {
      text: 'var(--dsw-alias-label-primary)',
      dim: 'var(--dsw-alias-label-secondary)',
      line: 'var(--dsw-alias-border-l1)',
      card: 'var(--dsw-alias-bg-layer-1)',
      inner: 'var(--dsw-alias-bg-layer-2)',
      ok: 'var(--dsw-alias-state-success-primary)',
      err: 'var(--dsw-alias-state-error-primary)',
    }

    const S = {
      page: {
        height: '100%',
        overflowY: 'auto',
        padding: '26px 30px 48px',
        color: T.text,
        background: 'var(--dsw-alias-bg-base)',
        font: 'inherit',
      },
      inner: { maxWidth: '880px' },
      head: { display: 'flex', alignItems: 'baseline', gap: '10px' },
      h1: { fontSize: '19px', margin: 0, letterSpacing: '0.02em', fontWeight: 600 },
      sub: { color: T.dim, fontSize: '12.5px' },
      path: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '11.5px',
        color: T.dim,
        wordBreak: 'break-all',
        margin: '6px 0 0',
        opacity: 0.75,
      },
      tabbar: { display: 'flex', gap: '4px', margin: '18px 0 14px', borderBottom: '1px solid ' + T.line },
      tab: {
        appearance: 'none',
        background: 'transparent',
        border: 'none',
        borderBottom: '2px solid transparent',
        color: T.dim,
        padding: '8px 14px',
        fontSize: '13px',
        cursor: 'pointer',
        marginBottom: '-1px',
      },
      tabActive: { color: T.text, borderBottomColor: 'var(--dsw-alias-brand-primary)' },
      hint: { color: T.dim, fontSize: '12px', margin: '0 0 14px' },
      toolbar: { display: 'flex', gap: '8px', flexWrap: 'wrap', margin: '0 0 16px', alignItems: 'center' },
      btn: {
        appearance: 'none',
        border: '1px solid ' + T.line,
        background: T.card,
        color: T.text,
        borderRadius: '8px',
        padding: '6px 13px',
        fontSize: '12.5px',
        cursor: 'pointer',
      },
      stats: { display: 'flex', gap: '26px', flexWrap: 'wrap', marginBottom: '18px' },
      stat: { display: 'flex', flexDirection: 'column', gap: '1px' },
      num: { fontSize: '21px', fontWeight: 600, lineHeight: 1.2 },
      label: { fontSize: '11.5px', color: T.dim },
      card: {
        border: '1px solid ' + T.line,
        background: T.card,
        borderRadius: '12px',
        padding: '16px 18px',
        marginBottom: '14px',
      },
      cardTitle: {
        fontSize: '11.5px',
        color: T.dim,
        marginBottom: '12px',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
      },
      row: { display: 'flex', justifyContent: 'space-between', gap: '14px', padding: '8px 0', fontSize: '13px' },
      divider: { borderTop: '1px solid ' + T.line },
      name: { fontWeight: 500, lineHeight: 1.5 },
      meta: { color: T.dim, fontSize: '11.5px', whiteSpace: 'nowrap', flexShrink: 0 },
      pre: {
        margin: '4px 0 0',
        padding: '12px 14px',
        background: T.inner,
        border: '1px solid ' + T.line,
        borderRadius: '9px',
        fontSize: '12.5px',
        whiteSpace: 'pre-wrap',
        lineHeight: 1.75,
        maxHeight: '240px',
        overflow: 'auto',
      },
      empty: { color: T.dim, fontSize: '12.5px', padding: '10px 0', lineHeight: 1.7 },
      err: { color: T.err, fontSize: '12.5px', marginBottom: '12px' },
      ok: { color: T.ok, fontSize: '12.5px' },
    }

    function Icon() {
      return h(
        'svg',
        { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('circle', { cx: 12, cy: 12, r: 9, stroke: 'currentColor', strokeWidth: 1.4 }),
        h('path', {
          d: 'M5 13c2.2 0 2.2-2 4.4-2s2.2 2 4.4 2 2.2-2 4.4-2',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
        }),
      )
    }

    function Stat(props) {
      return h('div', { style: S.stat }, h('span', { style: S.num }, String(props.value)), h('span', { style: S.label }, props.label))
    }

    function Card(props) {
      return h('section', { style: S.card }, h('div', { style: S.cardTitle }, props.title), props.children)
    }

    function List(props) {
      if (!props.items || props.items.length === 0) return h('div', { style: S.empty }, props.empty)
      return props.items.map((item, index) =>
        h(
          'div',
          { key: item.key || index, style: index === 0 ? S.row : Object.assign({}, S.row, S.divider) },
          h('span', { style: S.name }, item.name),
          item.meta ? h('span', { style: S.meta }, item.meta) : null,
        ),
      )
    }

    function MemoryTab({ data }) {
      const stats = data.stats || {}
      const [openId, setOpenId] = useState('')
      const [detail, setDetail] = useState('')
      const [kind, setKind] = useState('')
      const [query, setQuery] = useState('')
      const [sortKey, setSortKey] = useState('time')
      const [month, setMonth] = useState('')

      const show = async (id) => {
        if (openId === id) {
          setOpenId('')
          setDetail('')
          return
        }
        const res = await call('action', {
          action: 'record',
          id,
          persona: (data.persona && data.persona.name) || '',
        })
        setOpenId(id)
        setDetail((res && (res.text || res.error)) || '')
      }

      const all = data.records || []
      const kinds = {}
      for (const record of all) {
        const key = record['类型'] || '其他'
        kinds[key] = (kinds[key] || 0) + 1
      }
      // 按月收进文件夹：不把几十条一次铺在眼前。
      const monthOf = (record) => String(record['首次'] || record['上次'] || '').slice(0, 7)
      const months = {}
      for (const record of all) {
        const key = monthOf(record)
        if (!key) continue
        months[key] = (months[key] || 0) + 1
      }
      const monthLabel = (key) => key.replace('-', '.')
      const needle = query.trim()
      const picked = all.filter((record) => {
        if (kind && (record['类型'] || '其他') !== kind) return false
        if (month && monthOf(record) !== month) return false
        if (!needle) return true
        return JSON.stringify(record).includes(needle)
      })
      const shown = picked.slice().sort((a, b) => {
        if (sortKey === 'strength') return Number(b['强度'] || 0) - Number(a['强度'] || 0)
        // 按时间：新的在前；没日期的沉底
        return String(b['首次'] || '').localeCompare(String(a['首次'] || ''))
      })

      return h(
        'div',
        null,
        h(
          'div',
          { style: S.stats },
          h(Stat, { value: stats.records || 0, label: DICT.records }),
          h(Stat, { value: stats.today || 0, label: DICT.today }),
          h(Stat, { value: stats.experiences || 0, label: DICT.experiences }),
          h(Stat, { value: stats.blockChars || 0, label: DICT.budget }),
        ),
        h(
          'div',
          { style: { display: 'flex', gap: '14px', alignItems: 'flex-start' } },
          h(
            'div',
            { style: { width: '190px', flex: '0 0 190px' } },
            h(
              Card,
              { title: '分类' },
              h(
                'div',
                { style: Object.assign({}, S.row, { cursor: 'pointer' }), onClick: () => { setKind(''); setMonth('') } },
                h('span', { style: S.name }, (kind ? '' : '▸ ') + '长期全部'),
                h('span', { style: S.meta }, String(all.length)),
              ),
              Object.keys(kinds)
                .sort()
                .map((name) =>
                  h(
                    'div',
                    {
                      key: name,
                      style: Object.assign({}, S.row, S.divider, { cursor: 'pointer' }),
                      onClick: () => {
                        setKind(name)
                        setMonth('')
                      },
                    },
                    h('span', { style: S.name }, (kind === name ? '▸ ' : '') + name),
                    h('span', { style: S.meta }, String(kinds[name])),
                  ),
                ),
              h(
                'div',
                { style: Object.assign({}, S.label, { margin: '14px 0 2px', paddingLeft: '2px' }) },
                '流水（不算长期）',
              ),
              h(
                'div',
                {
                  style: Object.assign({}, S.row, S.divider, { cursor: 'pointer' }),
                  onClick: () => {
                    setKind('今天')
                    setMonth('')
                  },
                },
                h('span', { style: S.name }, (kind === '今天' ? '▸ ' : '') + '今天'),
                h('span', { style: S.meta }, String((data.today || []).length)),
              ),
              h(
                'div',
                {
                  style: Object.assign({}, S.row, S.divider, { cursor: 'pointer' }),
                  onClick: () => {
                    setKind('往日')
                    setMonth('')
                  },
                },
                h('span', { style: S.name }, (kind === '往日' ? '▸ ' : '') + '📅 往日'),
                h('span', { style: S.meta }, String((data.pastDays || []).length)),
              ),
              h(
                'div',
                { style: Object.assign({}, S.label, { margin: '14px 0 2px', paddingLeft: '2px' }) },
                '按月份',
              ),
              Object.keys(months)
                .sort()
                .reverse()
                .map((key) =>
                  h(
                    'div',
                    {
                      key: 'month-' + key,
                      style: Object.assign({}, S.row, S.divider, { cursor: 'pointer' }),
                      onClick: () => {
                        setMonth(key)
                        setKind('')
                      },
                    },
                    h('span', { style: S.name }, (month === key ? '▸ ' : '') + '📁 ' + monthLabel(key)),
                    h('span', { style: S.meta }, String(months[key])),
                  ),
                ),
            ),
          ),
          h(
            'div',
            { style: { flex: '1 1 0', minWidth: 0 } },
            kind === '往日'
              ? h(
                  Card,
                  { title: '📅 往日（' + (data.pastDays || []).length + ' 天）' },
                  (data.pastDays || []).length === 0
                    ? h('div', { style: S.empty }, '还没有往日的记录。')
                    : (data.pastDays || []).map((day) =>
                        h(
                          'div',
                          { key: 'past-' + day.date, style: { marginBottom: '16px' } },
                          h(
                            'div',
                            { style: Object.assign({}, S.label, { margin: '0 0 6px' }) },
                            day.date + ' · ' + day.lines.length + ' 条',
                          ),
                          day.lines.map((line, index) =>
                            h(
                              'div',
                              {
                                key: 'pl-' + index,
                                style: Object.assign({}, S.row, index > 0 ? S.divider : {}),
                              },
                              h(
                                'span',
                                { style: Object.assign({}, S.name, { flex: '1 1 auto', minWidth: 0, wordBreak: 'break-word' }) },
                                line,
                              ),
                            ),
                          ),
                        ),
                      ),
                )
              : kind === '今天'
              ? h(
                  Card,
                  { title: '今天 · ' + (data.todayDate || '') },
                  h(List, {
                    empty: DICT.emptyToday,
                    items: (data.today || []).slice().reverse().map((line, index) => ({
                      key: 'today-' + index,
                      name: line,
                      meta: data.todayDate || '',
                    })),
                  }),
                )
              : h(
                  Card,
                  { title: kind || (month ? '📁 ' + monthLabel(month) : DICT.records) },
                  h(
                    'div',
                    { style: Object.assign({}, S.toolbar, { marginTop: 0 }) },
                    h(
                      'button',
                      {
                        style: Object.assign({}, S.btn, {
                          padding: '4px 10px',
                          fontSize: '12px',
                          opacity: sortKey === 'time' ? 1 : 0.6,
                        }),
                        onClick: () => setSortKey('time'),
                      },
                      '按时间',
                    ),
                    h(
                      'button',
                      {
                        style: Object.assign({}, S.btn, {
                          padding: '4px 10px',
                          fontSize: '12px',
                          opacity: sortKey === 'strength' ? 1 : 0.6,
                        }),
                        onClick: () => setSortKey('strength'),
                      },
                      '按强度',
                    ),
                    h(
                      'span',
                      { style: Object.assign({}, S.meta, { marginLeft: 'auto' }) },
                      `共 ${shown.length} 条`,
                    ),
                  ),
                  h('input', {
                    style: {
                      width: '100%',
                      marginBottom: '10px',
                      padding: '9px 12px',
                      borderRadius: '10px',
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: 'rgba(10,20,40,0.35)',
                      color: 'inherit',
                      font: 'inherit',
                    },
                    placeholder: '在这本账里找几个字…',
                    value: query,
                    onChange: (event) => setQuery(event.target.value),
                  }),
                  shown.length === 0
                    ? h('div', { style: S.empty }, all.length === 0 ? DICT.emptyMem : '没找到。')
                    : shown.map((record, index) =>
                        h(
                          'div',
                          { key: record.id },
                          h(
                            'div',
                            {
                              style: Object.assign({}, index === 0 ? S.row : Object.assign({}, S.row, S.divider), {
                                cursor: 'pointer',
                                opacity: openId && openId !== record.id ? 0.55 : 1,
                                gap: '14px',
                              }),
                              onClick: () => show(record.id),
                            },
                            h(
                              'span',
                              { style: Object.assign({}, S.name, { flex: '1 1 auto', minWidth: 0 }) },
                              (openId === record.id ? '▾ ' : '') + (record['名'] || '（无名）'),
                            ),
                            h(
                              'span',
                              {
                                style: Object.assign({}, S.meta, {
                                  flex: '0 0 auto',
                                  width: '86px',
                                  textAlign: 'right',
                                  fontVariantNumeric: 'tabular-nums',
                                }),
                              },
                              record['首次'] || '',
                            ),
                            h(
                              'span',
                              {
                                style: Object.assign({}, S.meta, {
                                  flex: '0 0 auto',
                                  width: '96px',
                                  textAlign: 'right',
                                  fontVariantNumeric: 'tabular-nums',
                                }),
                              },
                              `${Math.round(record['强度'])} · ${record['状态']}`,
                            ),
                            h(
                              'span',
                              { style: Object.assign({}, S.meta, { flex: '0 0 58px', textAlign: 'right' }) },
                              record['类型'] || '',
                            ),
                          ),
                          openId === record.id
                            ? h(
                                'div',
                                {
                                  style: {
                                    margin: '6px 0 12px',
                                    padding: '10px 12px',
                                    borderRadius: '10px',
                                    background: 'rgba(10,20,40,0.32)',
                                  },
                                },
                                h('pre', { style: S.pre }, detail),
                              )
                            : null,
                        ),
                      ),
                ),
          ),
        ),
      )
    }

    function PersonaTab({ data, onRefresh }) {
      const [msg, setMsg] = useState('')
      const [busy, setBusy] = useState(false)
      const [open, setOpen] = useState('')
      const [text, setText] = useState('')
      const [showPick, setShowPick] = useState(false)
      const [editOpen, setEditOpen] = useState(false)
      const [editDraft, setEditDraft] = useState('')
      const [farewell, setFarewell] = useState(0)
      const [farewellName, setFarewellName] = useState('')
      const [farewellHard, setFarewellHard] = useState(false)
      const persona = data.persona || {}
      const roster = data.roster || []
      const claimed = (data.settings && data.settings.workspaces) || {}
      const home = data.dshWorkspaces || []
      const wsList = (home.length ? home.map((item) => item.path) : Object.keys(claimed)).slice()
      if (data.settings && data.settings.cwd && wsList.indexOf(data.settings.cwd) < 0) wsList.unshift(data.settings.cwd)
      const pathLabel = (p) => String(p || '').split(/[\\/]/).filter(Boolean).pop() || String(p || '')
      const wsTitle = (p) => {
        const hit = home.filter((item) => item.path === p)[0]
        return hit && hit.title ? hit.title : pathLabel(p)
      }
      const editable = persona.editable || {}
      const editableText = Object.keys(editable)
        .filter((key) => editable[key])
        .map((key) => `${key}：${editable[key]}`)
        .join('\n')

      // 主人改底子：小蓝自己改不了，造她的人可以。存前自动留 .bak。
      const saveFoundation = async () => {
        setBusy(true)
        const res = await call('action', {
          action: 'persona-write',
          text: editDraft,
          persona: persona.name || '',
        })
        setMsg((res && (res.text || res.error)) || '')
        await onRefresh()
        setBusy(false)
        if (res && res.ok) setEditOpen(false)
      }

      // 离别：第二道确认要把名字原样打进去，服务端也会再校一次。
      const doFarewell = async () => {
        setBusy(true)
        const res = await call('action', {
          action: 'persona-delete',
          persona: persona.name || '',
          confirm: farewellName.trim(),
          hard: farewellHard,
        })
        setMsg((res && (res.text || res.error)) || '')
        await onRefresh()
        setBusy(false)
        if (res && res.ok) {
          setFarewell(0)
          setFarewellName('')
          setFarewellHard(false)
        }
      }

      const pick = async (name) => {
        if (name === persona.name) return
        setBusy(true)
        const res = await call('action', { action: 'select', persona: name })
        setMsg((res && (res.text || res.error)) || '')
        await onRefresh()
        setBusy(false)
      }

      const enableAt = async (path) => {
        setBusy(true)
        const res = await call('action', { action: 'claim', path, persona: persona.name })
        setMsg((res && (res.text || res.error)) || '')
        await onRefresh()
        setBusy(false)
      }

      const stopAt = async (path) => {
        setBusy(true)
        const res = await call('action', { action: 'release', path })
        setMsg((res && (res.text || res.error)) || '')
        await onRefresh()
        setBusy(false)
      }

      const setPrivacy = async (on, path) => {
        setBusy(true)
        const res = await call('action', { action: 'privacy', on, path })
        setMsg((res && (res.text || res.error)) || '')
        await onRefresh()
        setBusy(false)
      }

      const showSelf = async (file) => {
        if (open === file) {
          setOpen('')
          setText('')
          return
        }
        const res = await call('action', { action: 'self', file, where: '日记', persona: persona.name || '' })
        setOpen(file)
        setText((res && (res.text || res.error)) || '')
      }

      return h(
        'div',
        null,
        msg ? h('div', { style: S.label }, msg) : null,
        h(
          Card,
          { title: '这家里有谁' },
          h(
            'div',
            { style: Object.assign({}, S.label, { marginBottom: '8px' }) },
            `正在看：${persona.name || '（没选）'}　·　点名字换人看`,
          ),
          roster.length === 0
            ? h('div', { style: S.empty }, '还没登记过任何人格。')
            : roster.map((item, index) =>
                h(
                  'div',
                  {
                    key: item.name,
                    style: Object.assign({}, index === 0 ? S.row : Object.assign({}, S.row, S.divider), {
                      cursor: busy ? 'default' : 'pointer',
                    }),
                    onClick: () => pick(item.name),
                  },
                  h('span', { style: S.name }, (item.name === persona.name ? '▸ ' : '· ') + item.name),
                  h('span', { style: S.meta }, `${item.records} 条记忆 · ${item.has ? '' : '还没建 · '}${item.root}`),
                ),
              ),
        ),
        h(
          Card,
          { title: '启用人格' },
          h(
            'div',
            { style: S.label },
            `要启用的是：${persona.name || '（先在上面点一个名字）'}　·　点「启用人格」挑一个工作区文件夹`,
          ),
          h(
            'div',
            { style: S.toolbar },
            h(
              'button',
              { style: S.btn, disabled: busy, onClick: () => setShowPick(!showPick) },
              showPick ? '收起列表' : '启用人格',
            ),
          ),
          showPick
            ? h(
                'div',
                { style: { marginTop: '6px' } },
                wsList.map((path, index) =>
                  h(
                    'div',
                    { key: path, style: index === 0 ? S.row : Object.assign({}, S.row, S.divider) },
                    h('span', { style: S.name }, wsTitle(path)),
                    h(
                      'span',
                      { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
                      h('span', { style: S.meta }, claimed[path] ? `归「${claimed[path]}」` : '没启用'),
                      claimed[path]
                        ? h(
                            'button',
                            {
                              style: Object.assign({}, S.btn, { padding: '3px 9px', fontSize: '11.5px' }),
                              disabled: busy,
                              onClick: () => stopAt(path),
                            },
                            '结束启用',
                          )
                        : h(
                            'button',
                            {
                              style: Object.assign({}, S.btn, { padding: '3px 9px', fontSize: '11.5px' }),
                              disabled: busy || !persona.name,
                              onClick: () => enableAt(path),
                            },
                            '启用',
                          ),
                    ),
                  ),
                ),
                wsList.length === 0 ? h('div', { style: S.empty }, '还没有工作区。') : null,
              )
            : null,
          h(
            'div',
            { style: Object.assign({}, S.toolbar, { marginTop: '12px' }) },
            h(
              'label',
              { style: Object.assign({}, S.label, { display: 'flex', gap: '8px', alignItems: 'center' }) },
              h('input', {
                type: 'checkbox',
                checked: Boolean(data.settings && data.settings.privacy),
                disabled: busy,
                onChange: (event) => setPrivacy(event.target.checked, data.settings && data.settings.cwd),
              }),
              '隐私模式（只写自述，不写记忆）',
            ),
          ),
        ),
        h(
          'div',
          { style: S.label },
          `下面是「${persona.name || '（没选）'}」的底子、可改层、画像、日记 —— 点上面名字就换人看`,
        ),
        h(
          Card,
          { title: DICT.foundation },
          editOpen
            ? h(
                'div',
                null,
                h('textarea', {
                  style: {
                    width: '100%',
                    minHeight: '360px',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: 'rgba(10,20,40,0.35)',
                    color: 'inherit',
                    font: 'inherit',
                    lineHeight: 1.65,
                    resize: 'vertical',
                  },
                  value: editDraft,
                  onChange: (event) => setEditDraft(event.target.value),
                }),
                h(
                  'div',
                  { style: S.toolbar },
                  h('button', { style: S.btn, disabled: busy, onClick: saveFoundation }, '保存'),
                  h('button', { style: S.btn, disabled: busy, onClick: () => setEditOpen(false) }, '取消'),
                  h(
                    'span',
                    { style: S.label },
                    '存之前会自动留一份 .bak。小蓝自己改不了这儿，改它的只有你。',
                  ),
                ),
              )
            : h(
                'div',
                null,
                h('pre', { style: S.pre }, persona.foundation || '（这里还没写东西）'),
                h(
                  'div',
                  { style: S.toolbar },
                  h(
                    'button',
                    {
                      style: S.btn,
                      disabled: busy || !persona.name,
                      onClick: () => {
                        setEditDraft(persona.foundation || '')
                        setEditOpen(true)
                      },
                    },
                    '编辑底子',
                  ),
                ),
              ),
        ),
        h(
          Card,
          { title: '自己长到哪一步' },
          persona.growth
            ? h(
                'div',
                null,
                h(
                  'div',
                  { style: S.label },
                  `观察 ${persona.growth.ups} 条 · 跨 ${persona.growth.days} 天 · ${persona.growth.scenes} 个场景` +
                    (persona.growth.ok ? ' · 够格改一句了' : ''),
                ),
                h(
                  'div',
                  { style: Object.assign({}, S.label, { marginTop: '6px' }) },
                  persona.growth.ok
                    ? '可改层的门开着，等着写一句。'
                    : '还差：' + (persona.growth.reasons.length ? persona.growth.reasons.join('；') : '——'),
                ),
              )
            : h('div', { style: S.empty }, '还没有观察账本。'),
        ),
        h(
          Card,
          { title: '自我认识' },
          (persona.knowledge || []).length === 0
            ? h('div', { style: S.empty }, '还一条都没写。写一条要带依据：观察（o:日期:场景）或记忆（m-xxx）的 id，没依据不收。')
            : h(
                'div',
                null,
                ...(persona.knowledge || []).map((k, i) =>
                  h(
                    'div',
                    { key: k.id || i, style: { margin: '6px 0', opacity: k['状态'] === 'active' ? 1 : 0.55 } },
                    h('div', { style: S.label }, `[${k['状态']}] ${k['陈述']}`),
                    h(
                      'div',
                      { style: Object.assign({}, S.label, { opacity: 0.7, marginTop: '2px' }) },
                      `置信 ${Number(k['置信'] || 0).toFixed(2)} · 依据 ${(k['依据'] || []).join('、') || '无'} · 上次确认 ${k['上次确认'] || '?'}` +
                        (k['推翻'] ? ` · 被推翻 ${k['推翻']} 次` : ''),
                    ),
                  ),
                ),
              ),
        ),
        h(Card, { title: DICT.editable }, h('pre', { style: S.pre }, editableText || DICT.noEditable)),
        h(
          Card,
          { title: DICT.portrait },
          persona.portraitGate
            ? h(
                'div',
                { style: Object.assign({}, S.label, { marginBottom: '6px' }) },
                persona.portraitGate.ok
                  ? `画像的门够了（带依据的认识 ${persona.portraitGate.usable} 条）。想重写就写。`
                  : '还不能重写：' + persona.portraitGate.reasons.join('；'),
              )
            : null,
          h('pre', { style: S.pre }, persona.portrait || DICT.noPortrait),
        ),
        h(
          Card,
          { title: '离别' },
          farewell === 0
            ? h(
                'div',
                null,
                h(
                  'div',
                  { style: S.label },
                  `要把「${persona.name || '（先点上面挑一个）'}」整个送走吗？她的核文件夹会一起删掉。`,
                ),
                h(
                  'div',
                  { style: S.toolbar },
                  h(
                    'button',
                    {
                      style: Object.assign({}, S.btn, { borderColor: 'rgba(255,120,120,0.45)', color: '#ff9a9a' }),
                      disabled: busy || !persona.name || persona.inPlace,
                      onClick: () => setFarewell(1),
                    },
                    '离别',
                  ),
                ),
                persona.inPlace
                  ? h('div', { style: S.label }, '她现在就在这个窗口里——先去上面换成别人，或结束启用。')
                  : null,
              )
            : farewell === 1
              ? h(
                  'div',
                  null,
                  h(
                    'div',
                    { style: Object.assign({}, S.label, { lineHeight: 1.9 }) },
                    `这一步之后，「${persona.name}」的底子、记忆、日记、自述、经验会一起消失。没有「恢复」这个按钮。`,
                  ),
                  h(
                    'div',
                    { style: S.toolbar },
                    h(
                      'button',
                      {
                        style: S.btn,
                        disabled: busy,
                        onClick: () => {
                          setFarewell(0)
                          setFarewellName('')
                          setFarewellHard(false)
                        },
                      },
                      '算了',
                    ),
                    h(
                      'button',
                      {
                        style: Object.assign({}, S.btn, { borderColor: 'rgba(255,120,120,0.45)', color: '#ff9a9a' }),
                        disabled: busy,
                        onClick: () => setFarewell(2),
                      },
                      '我确定，继续',
                    ),
                  ),
                )
              : h(
                  'div',
                  null,
                  h('div', { style: S.label }, `再确认一次：把「${persona.name}」这个名字原样打进去。`),
                  h('input', {
                    style: Object.assign({}, S.btn, { width: '100%', marginTop: '8px', cursor: 'text' }),
                    placeholder: persona.name || '',
                    value: farewellName,
                    onChange: (event) => setFarewellName(event.target.value),
                  }),
                  h(
                    'label',
                    {
                      style: Object.assign({}, S.toolbar, {
                        gap: '8px',
                        marginTop: '10px',
                        cursor: 'pointer',
                        alignItems: 'center',
                      }),
                    },
                    h('input', {
                      type: 'checkbox',
                      checked: farewellHard,
                      onChange: (event) => setFarewellHard(event.target.checked),
                    }),
                    h('span', { style: S.label }, '彻底删掉，不留后手（不勾的话会先在 备份\\离别\\ 留一份）'),
                  ),
                  h(
                    'div',
                    { style: S.toolbar },
                    h(
                      'button',
                      {
                        style: S.btn,
                        disabled: busy,
                        onClick: () => {
                          setFarewell(0)
                          setFarewellName('')
                          setFarewellHard(false)
                        },
                      },
                      '算了',
                    ),
                    h(
                      'button',
                      {
                        style: Object.assign({}, S.btn, {
                          borderColor: 'rgba(255,90,90,0.7)',
                          color: '#ff8080',
                          fontWeight: 600,
                        }),
                        disabled: busy || farewellName.trim() !== (persona.name || ''),
                        onClick: doFarewell,
                      },
                      '真的离别',
                    ),
                  ),
                ),
        ),
        h(
          Card,
          { title: '她写过的日记' },
          (data.self || []).length === 0
            ? h('div', { style: S.empty }, '还空着。')
            : (data.self || []).slice(0, 6).map((item, index) =>
                h(
                  'div',
                  {
                    key: item.file,
                    style: Object.assign({}, index === 0 ? S.row : Object.assign({}, S.row, S.divider), {
                      cursor: 'pointer',
                    }),
                    onClick: () => showSelf(item.file),
                  },
                  h('span', { style: S.name }, item.file),
                  h(
                    'span',
                    {
                      style: Object.assign({}, S.meta, {
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        maxWidth: '58%',
                      }),
                    },
                    item.preview,
                  ),
                ),
              ),
        ),
        open ? h(Card, { title: open }, h('pre', { style: S.pre }, text)) : null,
      )
    }

    function WorkshopTab({ data, onRefresh }) {
      const who = (data.persona && data.persona.name) || ''
      const [msg, setMsg] = useState('')
      const [busy, setBusy] = useState(false)
      const [folder, setFolder] = useState('')
      const [active, setActive] = useState('')
      const [showNew, setShowNew] = useState(false)
      const [form, setForm] = useState({ name: '', category: '', triggers: '', body: '' })
      const [editing, setEditing] = useState('')
      const [confirmDel, setConfirmDel] = useState('')

      const setField = (key, value) => setForm(Object.assign({}, form, { [key]: value }))

      const startEdit = async (exp) => {
        const res = await call('action', { action: 'skill-read', name: exp['名'], persona: who })
        setForm({
          name: exp['名'] || '',
          category: exp['分类'] || '',
          triggers: (exp['触发'] || []).join(', '),
          body: (res && res.text) || '',
        })
        setEditing(exp['名'])
        setShowNew(true)
        setMsg('')
      }

      const removeSkill = async (exp) => {
        if (confirmDel !== exp['名']) {
          setConfirmDel(exp['名'])
          setMsg(`再点一次「删除」就把「${exp['名']}」删掉。`)
          return
        }
        setBusy(true)
        const res = await call('action', { action: 'skill-delete', name: exp['名'], persona: who })
        setMsg((res && (res.text || res.error)) || '')
        setConfirmDel('')
        await onRefresh()
        setBusy(false)
      }

      const toggle = async (exp) => {
        setBusy(true)
        const res = await call('action', { action: exp['常驻'] ? 'unpin' : 'pin', name: exp['名'], persona: who })
        setMsg((res && (res.text || res.error)) || '')
        await onRefresh()
        setBusy(false)
      }

      const makeFolder = async () => {
        const name = folder.trim()
        if (!name) return
        setBusy(true)
        const res = await call('action', { action: 'mkdir', name, persona: who })
        setMsg((res && (res.text || res.error)) || '')
        if (res && res.ok) setFolder('')
        await onRefresh()
        setBusy(false)
      }

      const saveSkill = async () => {
        if (!form.name.trim() || !form.body.trim()) return
        setBusy(true)
        const res = await call('action', {
          action: 'skill-save',
          persona: who,
          originalName: editing,
          name: form.name.trim(),
          category: form.category.trim() || active || '未分类',
          triggers: form.triggers,
          body: form.body,
        })
        setMsg((res && (res.text || res.error)) || '')
        if (res && res.ok) {
          setForm({ name: '', category: '', triggers: '', body: '' })
          setEditing('')
          setShowNew(false)
        }
        await onRefresh()
        setBusy(false)
      }

      const items = data.experiences || []
      const folders = {}
      for (const exp of items) {
        const key = exp['分类'] || '未分类'
        folders[key] = (folders[key] || 0) + 1
      }
      const shown = active ? items.filter((exp) => (exp['分类'] || '未分类') === active) : items
      const fieldStyle = {
        width: '100%',
        marginTop: '8px',
        padding: '9px 12px',
        borderRadius: '10px',
        border: '1px solid rgba(255,255,255,0.16)',
        background: 'rgba(10,20,40,0.35)',
        color: 'inherit',
        font: 'inherit',
      }

      return h(
        'div',
        null,
        msg ? h('div', { style: S.label }, msg) : null,
        h(
          'div',
          { style: S.toolbar },
          h('button', { style: S.btn, disabled: busy, onClick: () => setShowNew(!showNew) }, showNew ? '收起表单' : '＋ 新建技能'),
          h('input', {
            style: Object.assign({}, S.btn, { minWidth: '200px', cursor: 'text' }),
            placeholder: '新分类，例如「写作 语料」',
            value: folder,
            onChange: (event) => setFolder(event.target.value),
            onKeyDown: (event) => {
              if (event.key === 'Enter') makeFolder()
            },
          }),
          h('button', { style: S.btn, disabled: busy || !folder.trim(), onClick: makeFolder }, '＋ 新建分类'),
        ),
        showNew
          ? h(
              Card,
              { title: '新建技能' },
              h('input', {
                style: fieldStyle,
                placeholder: '名字，例如「改 profile 的 package.json 别带 BOM」',
                value: form.name,
                onChange: (event) => setField('name', event.target.value),
              }),
              h('input', {
                style: fieldStyle,
                placeholder: `分类（留空就用${active ? '「' + active + '」' : '「未分类」'}）`,
                value: form.category,
                onChange: (event) => setField('category', event.target.value),
              }),
              h('input', {
                style: fieldStyle,
                placeholder: '触发词，逗号隔开，例如 BOM, package.json, profile',
                value: form.triggers,
                onChange: (event) => setField('triggers', event.target.value),
              }),
              h('textarea', {
                style: Object.assign({}, fieldStyle, { minHeight: '140px', lineHeight: 1.6, resize: 'vertical' }),
                placeholder: '正文：下次照着能做对的样子。步骤、坑、判据都写进去。',
                value: form.body,
                onChange: (event) => setField('body', event.target.value),
              }),
              h(
                'div',
                { style: S.toolbar },
                h('button', { style: S.btn, disabled: busy || !form.name.trim() || !form.body.trim(), onClick: saveSkill }, editing ? '存回工坊' : '存进工坊'),
                h(
                  'button',
                  {
                    style: S.btn,
                    disabled: busy,
                    onClick: () => {
                      setShowNew(false)
                      setEditing('')
                      setForm({ name: '', category: '', triggers: '', body: '' })
                    },
                  },
                  '算了',
                ),
              ),
            )
          : null,
        h(
          'div',
          { style: { display: 'flex', gap: '14px', alignItems: 'flex-start' } },
          // 左边：文件夹
          h(
            'div',
            { style: { width: '210px', flex: '0 0 210px' } },
            h(
              Card,
              { title: '分类' },
              h(
                'div',
                {
                  key: 'all',
                  style: Object.assign({}, S.row, { cursor: 'pointer' }),
                  onClick: () => setActive(''),
                },
                h('span', { style: S.name }, '全部'),
                h('span', { style: S.meta }, String(items.length)),
              ),
              Object.keys(folders)
                .sort()
                .map((name, index) =>
                  h(
                    'div',
                    {
                      key: name,
                      style: Object.assign({}, S.row, S.divider, {
                        cursor: 'pointer',
                        opacity: active && active !== name ? 0.62 : 1,
                      }),
                      onClick: () => setActive(name),
                    },
                    h('span', { style: S.name }, (active === name ? '▸ ' : '') + name),
                    h('span', { style: S.meta }, String(folders[name])),
                  ),
                ),
            ),
          ),
          // 右边：技能
          h(
            'div',
            { style: { flex: '1 1 0', minWidth: 0 } },
            h(
              Card,
              { title: active ? active : DICT.experiences },
              shown.length === 0
                ? h('div', { style: S.empty }, DICT.emptyExp)
                : shown.map((exp, index) =>
                    h(
                      'div',
                      {
                        key: exp['名'] + index,
                        style: Object.assign({}, index === 0 ? S.row : Object.assign({}, S.row, S.divider), {
                          alignItems: 'flex-start',
                          gap: '14px',
                        }),
                      },
                      h(
                        'div',
                        { style: { flex: '1 1 auto', minWidth: 0 } },
                        h(
                          'div',
                          {
                            style: Object.assign({}, S.name, {
                              whiteSpace: 'normal',
                              wordBreak: 'break-word',
                              lineHeight: 1.45,
                            }),
                          },
                          (exp['常驻'] ? '📌 ' : '') + exp['名'],
                        ),
                        h(
                          'div',
                          { style: Object.assign({}, S.meta, { marginTop: '4px', whiteSpace: 'normal' }) },
                          `${(exp['触发'] || []).join('、') || '没设触发词'} · 用到 ${exp['用到']}`,
                        ),
                      ),
                      h(
                        'span',
                        { style: { display: 'flex', gap: '8px', alignItems: 'center', flex: '0 0 auto' } },
                        h(
                          'button',
                          {
                            style: Object.assign({}, S.btn, {
                              padding: '3px 9px',
                              fontSize: '11.5px',
                              whiteSpace: 'nowrap',
                            }),
                            disabled: busy,
                            onClick: () => toggle(exp),
                          },
                          exp['常驻'] ? '取消常驻' : '设为常驻',
                        ),
                        h(
                          'button',
                          {
                            style: Object.assign({}, S.btn, { padding: '3px 9px', fontSize: '11.5px' }),
                            disabled: busy,
                            onClick: () => startEdit(exp),
                          },
                          '编辑',
                        ),
                        h(
                          'button',
                          {
                            style: Object.assign({}, S.btn, {
                              padding: '3px 9px',
                              fontSize: '11.5px',
                              color: confirmDel === exp['名'] ? '#ff9b9b' : undefined,
                            }),
                            disabled: busy,
                            onClick: () => removeSkill(exp),
                          },
                          confirmDel === exp['名'] ? '真要删？' : '删除',
                        ),
                      ),
                    ),
                  ),
            ),
          ),
        ),
      )
    }

    /** 日记和自述共用一个读法：点开就原地展开。 */
    function Pages({ items, where, empty, persona }) {
      const [open, setOpen] = useState('')
      const [text, setText] = useState('')

      const show = async (file) => {
        if (open === file) {
          setOpen('')
          setText('')
          return
        }
        const res = await call('action', { action: 'self', file, where, persona: persona || '' })
        setOpen(file)
        setText((res && (res.text || res.error)) || '')
      }

      const list = items || []
      return h(
        'div',
        null,
        h(
          Card,
          { title: where },
          list.length === 0
            ? h('div', { style: S.empty }, empty)
            : list.map((item, index) =>
                h(
                  'div',
                  { key: item.file },
                  h(
                    'div',
                    {
                      style: Object.assign({}, index === 0 ? S.row : Object.assign({}, S.row, S.divider), {
                        cursor: 'pointer',
                        opacity: open && open !== item.file ? 0.6 : 1,
                      }),
                      onClick: () => show(item.file),
                    },
                    h('span', { style: S.name }, (open === item.file ? '▾ ' : '') + item.file),
                    h(
                      'span',
                      {
                        style: Object.assign({}, S.meta, {
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: '58%',
                        }),
                      },
                      item.preview,
                    ),
                  ),
                  open === item.file
                    ? h(
                        'div',
                        {
                          style: {
                            margin: '6px 0 12px',
                            padding: '10px 12px',
                            borderRadius: '10px',
                            background: 'rgba(10,20,40,0.32)',
                          },
                        },
                        h('pre', { style: S.pre }, text),
                      )
                    : null,
                ),
              ),
        ),
      )
    }

    function DiaryTab({ data }) {
      return h(Pages, {
        items: data.self || [],
        where: '日记',
        empty: '还没写过日记。',
        persona: (data.persona && data.persona.name) || '',
      })
    }

    function SelfTab({ data }) {
      return h(Pages, {
        items: data.notes || [],
        where: '自述',
        empty: '还没写过自述——这里完全由咱做主。',
        persona: (data.persona && data.persona.name) || '',
      })
    }

  /**
   * 设置页的一张卡（2026-11-11 从 SettingsTab 里搬出来的）。
   * 代码一个字没改，只是有了名字、有了自己的参数。
   */
  function SettingsWhereCard({ settings }) {
    return h(
      Card,
      { title: '这会儿在哪儿' },
      h('div', { style: S.name }, settings.current || ''),
      h('div', { style: S.label }, `${settings.sizeText || ''} · ${settings.files || 0} 个文件`),
      h('div', { style: Object.assign({}, S.label, { marginTop: '8px' }) },
        `当前工作区：${settings.cwd || '（不知道）'} · ${settings.active ? '在场（' + (settings.persona || '') + '）' : '不在场'}`),
    )
  }
  /**
   * 设置页的一张卡（2026-11-11 从 SettingsTab 里搬出来的）。
   * 代码一个字没改，只是有了名字、有了自己的参数。
   */
  function SettingsCreateCard({ busy, newName, setNewName, newRoot, setNewRoot, newFoundation, setNewFoundation, createPersona, target }) {
    return h(
      Card,
      { title: '创造' },
      h(
        'div',
        { style: S.label },
        '造一个新的人格：起名字、挑一个空文件夹当家、把她的底子写进去。建完在「人格」页点她就能改、能启用到工作区。',
      ),
      h(
        'div',
        { style: Object.assign({}, S.toolbar, { marginTop: '10px' }) },
        h('input', {
          style: Object.assign({}, S.btn, { minWidth: '150px', cursor: 'text' }),
          placeholder: '名字，例如 千夏',
          value: newName,
          onChange: (event) => setNewName(event.target.value),
        }),
        h('input', {
          style: Object.assign({}, S.btn, { minWidth: '320px', cursor: 'text' }),
          placeholder: '核文件夹的完整路径（一个空目录）',
          value: newRoot,
          onChange: (event) => setNewRoot(event.target.value),
        }),
        h('button', { style: S.btn, disabled: busy, onClick: createPersona }, '造一个'),
      ),
      h(
        'div',
        { style: Object.assign({}, S.label, { marginTop: '14px' }) },
        '人设（她的底子，最基础那个人）。写了就照这个建；不写就先给模板，建完在人格页再改。',
      ),
      h('textarea', {
        style: {
          width: '100%',
          minHeight: '220px',
          marginTop: '8px',
          padding: '10px 12px',
          borderRadius: '10px',
          border: '1px solid rgba(255,255,255,0.16)',
          background: 'rgba(10,20,40,0.35)',
          color: 'inherit',
          font: 'inherit',
          lineHeight: 1.65,
          resize: 'vertical',
        },
        placeholder:
          '# 底子\n\n## 名字\n她叫什么。\n\n## 自称与称呼\n怎么自称，怎么叫主人。\n\n## 身份\n她是谁。\n\n## 底线\n不能破的那几条。',
        value: newFoundation,
        onChange: (event) => setNewFoundation(event.target.value),
      }),
    )
  }
  /**
   * 设置页的一张卡（2026-11-11 从 SettingsTab 里搬出来的）。
   * 代码一个字没改，只是有了名字、有了自己的参数。
   */
  function SettingsOwnerCard({ busy, owner, setOwner, act, target }) {
    return h(
      Card,
      { title: '主人是谁' },
      h('div', { style: S.label }, '写在这里的东西会每轮带在人格后面（稳定的，不额外烧钱）。生日、称呼、忌口、雷区都行。'),
      h('textarea', {
        style: {
          width: '100%',
          minHeight: '120px',
          marginTop: '10px',
          padding: '10px 12px',
          borderRadius: '10px',
          border: '1px solid rgba(255,255,255,0.16)',
          background: 'rgba(10,20,40,0.35)',
          color: 'inherit',
          font: 'inherit',
          lineHeight: 1.6,
          resize: 'vertical',
        },
        placeholder: '例如：\n生日 12 月 17 日\n叫我阿蓝（或者「你」，看心情）\n不吃香菜',
        value: owner,
        onChange: (event) => setOwner(event.target.value),
      }),
      h(
        'div',
        { style: S.toolbar },
        h('button', { style: S.btn, disabled: busy, onClick: () => act('owner', { text: owner }) }, '保存'),
        h('button', { style: S.btn, disabled: busy || !owner.trim(), onClick: () => { setOwner(''); act('owner', { text: '' }) } }, '清空'),
      ),
    )
  }
  /**
   * 设置页的一张卡（2026-11-11 从 SettingsTab 里搬出来的）。
   * 代码一个字没改，只是有了名字、有了自己的参数。
   */
  function SettingsHomeCard({ personas }) {
    return h(
      Card,
      { title: '家里人的住处' },
      h(List, {
        empty: '还没有登记过任何人格',
        items: personas.map(([name, root]) => ({ key: name, name, meta: root })),
      }),
    )
  }
  /**
   * 设置页的一张卡（2026-11-11 从 SettingsTab 里搬出来的）。
   * 代码一个字没改，只是有了名字、有了自己的参数。
   */
  function SettingsPresenceCard({ workspaces }) {
    return h(
      Card,
      { title: '哪儿有咱在场' },
      h(List, {
        empty: '一个都没有 —— 默认不在场',
        items: workspaces.map(([path, persona]) => ({ key: path, name: path, meta: persona })),
      }),
    )
  }
  /**
   * 设置页的一张卡（2026-11-11 从 SettingsTab 里搬出来的）。
   * 代码一个字没改，只是有了名字、有了自己的参数。
   */
  function SettingsPackCard({ settings, backups, busy, act, target, setTarget, msg }) {
    const list = Array.isArray(backups) ? backups : []
    const sizeText = (bytes) =>
      bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB'
    return h(
      Card,
      { title: '收拾东西' },
      h(
        'div',
        { style: S.toolbar },
        h('button', { style: S.btn, disabled: busy, onClick: () => act('backup') }, '人格备份保存'),
        h('button', { style: S.btn, disabled: busy, onClick: () => act('open') }, '打开核文件夹'),
      ),
      h('div', { style: S.label }, '备份会存到 ' + (settings.backupBase || '') ),
      h('div', { style: S.label }, '里面是「核」整个文件夹 + 在场登记 + 家那一层的主人档案。换机器时把这份拷走，核就能原样站起来。'),
      h(
        'div',
        { style: Object.assign({}, S.label, { marginTop: '14px' }) },
        '人格备份载入：挑一份，整份装进「载入-日期」目录，现有核一个字节都不动。',
      ),
      list.length
        ? list.map((item) =>
            h(
              'div',
              { key: item.name, style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' } },
              h('span', { style: { flex: 1, fontSize: '12.5px' } }, item.name + ' · ' + item.files + ' 个文件 · ' + sizeText(item.bytes)),
              h('button', { style: S.btn, disabled: busy, onClick: () => act('loadbackup', { backup: item.path }) }, '载入'),
            ),
          )
        : h('div', { style: S.label }, '还没有备份。先点上面「人格备份保存」。'),
      h('div', { style: Object.assign({}, S.label, { marginTop: '14px' }) }, '搬到别处去（要一个空目录）'),
      h(
        'div',
        { style: Object.assign({}, S.toolbar, { marginBottom: 0 }) },
        h('input', {
          style: Object.assign({}, S.btn, { minWidth: '320px', cursor: 'text' }),
          placeholder: '搬到哪儿（一个空的完整路径）',
          value: target,
          onChange: (event) => setTarget(event.target.value),
        }),
        h('button', { style: S.btn, disabled: busy || !target.trim(), onClick: () => act('move', { path: target.trim() }) }, '搬走吧'),
      ),
      msg ? h('div', { style: Object.assign({}, S.label, { marginTop: '10px' }) }, msg) : null,
    )
  }

    function SettingsTab({ data, onRefresh }) {
      const [target, setTarget] = useState('')
      const [msg, setMsg] = useState('')
      const [busy, setBusy] = useState(false)
      const [owner, setOwner] = useState(data.owner || '')
      const [newName, setNewName] = useState('')
      const [newRoot, setNewRoot] = useState('')
      const [newFoundation, setNewFoundation] = useState('')
      const settings = data.settings || {}

      // 创造一个人格：先建家（有底子才不会开机对路失败），再登记。
      const createPersona = async () => {
        const name = newName.trim()
        const root = newRoot.trim()
        if (!name || !root) {
          setMsg('名字和核路径都要填。')
          return
        }
        setBusy(true)
        const res = await call('action', {
          action: 'register',
          persona: name,
          root,
          foundation: newFoundation.trim(),
        })
        setMsg((res && (res.text || res.error)) || '')
        await onRefresh()
        setBusy(false)
        if (res && res.ok) {
          setNewName('')
          setNewRoot('')
          setNewFoundation('')
        }
      }

      const act = async (action, extra) => {
        setBusy(true)
        const res = await call('action', Object.assign({ action }, extra || {}))
        setMsg((res && (res.text || res.error)) || '')
        await onRefresh()
        setBusy(false)
      }

      const personas = Object.entries(settings.personas || {})
      const workspaces = Object.entries(settings.workspaces || {})

      return h(
        'div',
        null,
        h(SettingsWhereCard, { settings }),
        h(SettingsCreateCard, { busy, newName, setNewName, newRoot, setNewRoot, newFoundation, setNewFoundation, createPersona, target }),
        h(SettingsOwnerCard, { busy, owner, setOwner, act, target }),
        h(SettingsHomeCard, { personas }),
        h(SettingsPresenceCard, { workspaces }),
        h(SettingsPackCard, { settings, backups: data.backups, busy, act, target, setTarget, msg }),
      )
    }

    function Panel() {
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [note, setNote] = useState('')
      const [busy, setBusy] = useState(false)
      const [tab, setTab] = useState('memory')

      const load = useCallback(async () => {
        setBusy(true)
        const res = await call('state')
        if (res && res.error) setError(res.error)
        else {
          setData(res)
          setError('')
        }
        setBusy(false)
      }, [])

      useEffect(() => {
        load()
      }, [load])

      const act = useCallback(
        async (action) => {
          setBusy(true)
          const res = await call('action', { action })
          setNote((res && (res.text || res.error)) || '')
          await load()
          setBusy(false)
        },
        [load],
      )

      if (error) {
        return h(
          'div',
          { style: S.page },
          h('div', { style: S.err }, error),
          h('button', { style: S.btn, onClick: load }, DICT.retry),
        )
      }
      if (!data) return h('div', { style: S.page }, h('div', { style: S.empty }, DICT.loading))

      const pageTitle = makeTitle(data.activePersona || '')

      const chainOk = data.chain && data.chain.ok
      const tabs = [
        { key: 'memory', node: MemoryTab },
        { key: 'persona', node: PersonaTab },
        { key: 'workshop', node: WorkshopTab },
        { key: 'diary', node: DiaryTab },
        { key: 'self', node: SelfTab },
        { key: 'settings', node: SettingsTab },
      ]
      const current = tabs.filter((item) => item.key === tab)[0] || tabs[0]

      return h(
        'div',
        { style: S.page },
        h(
          'div',
          { style: S.inner },
          h('div', { style: S.head }, h('h1', { style: S.h1 }, pageTitle), h('span', { style: S.sub }, DICT.sub)),
          h('div', { style: S.path }, (data.root || '') + ' · ' + (data.activePersona ? '这个工作区里在场：' + data.activePersona : '这个工作区里没人在场')),

          h(
            'div',
            { style: S.tabbar },
            tabs.map((item) =>
              h(
                'button',
                {
                  key: item.key,
                  style: Object.assign({}, S.tab, tab === item.key ? S.tabActive : null),
                  onClick: () => setTab(item.key),
                },
                DICT.tabs[item.key],
              ),
            ),
          ),
          h('div', { style: S.hint }, DICT.hints[tab]),

          h(
            'div',
            { style: S.toolbar },
            h(
              'button',
              {
                style: S.btn,
                disabled: busy,
                // 以前点「刷新」什么都不显示——不知道到底刷没刷。
                onClick: async () => {
                  await load()
                  setNote('已经刷新了 · ' + new Date().toTimeString().slice(0, 8))
                  setTimeout(() => setNote(''), 3000)
                },
              },
              DICT.refresh,
            ),
            h('button', { style: S.btn, onClick: () => act('settle'), disabled: busy }, DICT.settle),
            h('button', { style: S.btn, onClick: () => act('chain'), disabled: busy }, DICT.verify),
            h(
              'span',
              { style: chainOk ? S.ok : S.err },
              chainOk ? DICT.chainOk : DICT.chainBroken + '：' + ((data.chain && data.chain.reason) || ''),
            ),
          ),

          note ? h('div', { style: S.label }, note) : null,
          h(current.node, { data, onRefresh: load }),
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        if (!ctx || !ctx.slots || typeof ctx.slots.inject !== 'function') return
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: 'benwo', order: 6, label: () => SIDEBAR_LABEL },
            Icon,
          ),
        )
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: 'benwo' }, function BenwoPanel() {
            return h(Panel)
          }),
        )
      },
    }
  },
})
