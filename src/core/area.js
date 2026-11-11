/**
 * 领域（2026-11-10 夜，主人定的 C）。
 *
 * 类型回答「是什么」（事件/事实/要求…），领域回答「哪一摊事」（核/绘图/QQ/桌面/生活）。
 * 它们正交：一条「要求」可以既是绘图规矩，也是核的规矩。
 *
 * 干什么：问什么翻什么。问 QQ 不该把绘图参数翻出来；
 * 项目多了以后，新项目也不会被老项目的记忆挤掉位置。
 *
 * 猜法：问句里出现哪个领域的关键词，就把那个领域的记录往上抬一点。
 * 猜不出来就不抬——宁可平均，也不要瞎猜。
 */
export const AREAS = ['核', '绘图', 'QQ', '桌面', '生活']

const HINTS = {
  核: ['核', '记忆', '人格', '插件', '备份', '注入', '认识', '脾性', '自己长', '打包'],
  绘图: ['图', '画', '生图', '出图', 'ComfyUI', '千问', 'denoise', '工作流', '提示词', '参数', '三视图'],
  QQ: ['QQ', '群', '桥接', 'snowluma', '雪奈'],
  桌面: ['桌面', '2D', 'Live2D', '身体', '立绘', '语音', 'TTS'],
  生活: ['游戏', '原神', '吃', '睡', '床', '日常', '火锅', '旅行'],
}

/** 从一句话猜领域。猜不出返回 ''（不硬猜）。 */
export function guessArea(text = '') {
  const t = String(text || '')
  let best = ''
  let bestHits = 0
  for (const [area, words] of Object.entries(HINTS)) {
    let hits = 0
    for (const w of words) if (t.includes(w)) hits += 1
    if (hits > bestHits) {
      best = area
      bestHits = hits
    }
  }
  return bestHits > 0 ? best : ''
}
