// goapp-demo-word：一个最小 goapp。自带界面与自己的状态，只借 DSH 引擎跑逻辑；
// 它不注册聊天位置，所以能和 dsh-go 的聊天界面完全无关。
//
// VERSION 必须和 package.json 的 version 一致（tools/test/pack.test.js 会比对）：
// 面板上那行 `v0.2.2 · 7` 是真机验证「商店升级」时唯一能看出跑的是哪一版的标记。
const VERSION = '0.2.2'

const DECK = [
  { word: 'ephemeral', meaning: '短暂的；朝生暮死的', note: 'ephemeral fame' },
  { word: 'serendipity', meaning: '意外发现珍奇事物的运气', note: 'a serendipity moment' },
  { word: 'ubiquitous', meaning: '无处不在的', note: 'ubiquitous computing' },
  { word: 'candid', meaning: '坦率的；直言的', note: 'a candid answer' },
  { word: 'resilient', meaning: '有韧性的；能恢复的', note: 'a resilient system' },
  { word: 'meticulous', meaning: '一丝不苟的；极仔细的', note: 'meticulous notes' },
  { word: 'pragmatic', meaning: '务实的；讲求实际的', note: 'a pragmatic choice' },
]

const WORDS = {
  zh: { streak: '连续答对', left: '剩余', reveal: '看释义', known: '认识', again: '不认识', done: '这一轮过完了', tip: '点「认识」换下一张' },
  en: { streak: 'Streak', left: 'Left', reveal: 'Show meaning', known: 'Knew it', again: 'Not yet', done: 'Deck finished', tip: 'Tap "Knew it" for the next card' },
}

const words = (locale) => (typeof locale === 'string' && locale.toLowerCase().startsWith('en') ? WORDS.en : WORDS.zh)

/** One deck cursor per conversation; panels without a session share one. */
const state = new Map()
function cursorOf(scope) {
  const key = typeof scope?.sessionId === 'string' ? scope.sessionId : '-'
  if (!state.has(key)) state.set(key, { index: 0, streak: 0, revealed: false })
  return state.get(key)
}

export const name = 'goapp-demo-word'

/** @param {any} ctx */
export function apply(ctx) {
  ctx.inject(['dshGo'], (ctx) => {
    ctx.dshGo.panel('word', {
      view: (scope, caps) => {
        const w = words(caps?.locale)
        return {
          type: 'stack',
          children: [
            {
              type: 'row',
              children: [
                { type: 'metric', label: w.streak, value: { $: 'data.streak' }, tone: 'good' },
                { type: 'metric', label: w.left, value: { $: 'data.left' } },
              ],
            },
            { type: 'text', text: { $: 'data.word' }, size: 'large', weight: 'bold' },
            { type: 'callout', text: { $: 'data.meaning' }, tone: 'info' },
            { type: 'text', text: { $: 'data.note' }, tone: 'muted' },
            { type: 'text', text: w.tip, tone: 'muted' },
            { type: 'text', text: `v${VERSION} · ${DECK.length}`, tone: 'muted' },
            {
              type: 'actions',
              items: [
                { label: w.reveal, action: 'reveal', style: 'plain' },
                { label: w.again, action: 'again', style: 'plain' },
                { label: w.known, action: 'known', style: 'primary' },
              ],
            },
          ],
        }
      },
      data: (scope, emit) => {
        const push = () => {
          const c = cursorOf(scope)
          const card = DECK[c.index]
          emit({
            streak: String(c.streak),
            left: String(Math.max(0, DECK.length - c.index)),
            word: card === undefined ? '—' : card.word,
            meaning: card === undefined ? '' : c.revealed ? card.meaning : '••••••',
            note: card === undefined ? '' : c.revealed ? card.note : '',
          })
        }
        push()
        return () => {}
      },
      actions: {
        reveal: (scope) => {
          cursorOf(scope).revealed = true
          return [{ type: 'refresh' }]
        },
        known: (scope) => {
          const c = cursorOf(scope)
          c.index = Math.min(DECK.length, c.index + 1)
          c.streak += 1
          c.revealed = false
          return [{ type: 'refresh' }]
        },
        again: (scope) => {
          const c = cursorOf(scope)
          c.index = Math.min(DECK.length, c.index + 1)
          c.streak = 0
          c.revealed = false
          return [{ type: 'refresh' }]
        },
      },
    })
  })
}
