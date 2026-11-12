# goapp 规范 v0.1（自用实现基线）

> 状态：管理器与示例 goapp 已按本规范实现，并通过 `plugin-kit check --load`。
> 未实现部分在每节末尾用 **⛔ 未实现** 标出，并写明卡在 App 侧还是引擎侧。

## 1. 分层

```
DSH 引擎（同一个 Node + proot，所有 goapp 共享）
   └─ goapp 包（插件形态：package.json + lib/ + 可选 web/）
        └─ goapp 管理器（也是插件）：注册表、开关、删除、商店、快捷入口
App 侧容器（全屏宿主、桌面直达、会话命名空间）—— ⛔ 未实现，需改 fork
```

**关键约束**：goapp 的代码跑在引擎里，App 只画它声明的界面。所以「界面完全不同」有两条实现路线：声明式组件（16 个，够用但受预算限制）或网页岛（WebView，能跑任意 HTML/JS）。本规范两者都允许，由 goapp 作者选 `kind`。

## 2. 包格式

```
my-goapp/
├── package.json      # 标准 dsh 插件字段 + dshGo 清单 + dshGo.goapp 扩展
├── cordis.patch.yml  # 挂载（insert id/name）
├── lib/index.js      # 宿主半侧：apply(ctx) → ctx.inject(['dshGo'])
└── web/              # kind = "web" 时：自己的 HTML/JS，供网页岛加载
```

`package.json` 的扩展字段：

```jsonc
"dshGo": {
  "v": 1,
  "title": { "zh": "go单词", "en": "go words" },
  "icon": "school",
  "contributes": { "panels": [{ "id": "word", "title": {...}, "icon": "school", "placement": ["features"] }] },
  "goapp": {
    "id": "goapp-demo-word",        // 全局唯一，注册表主键
    "kind": "native",                // native | web
    "entry": "panel:word",           // native: panel:<id>；web: web/index.html
    "permissions": ["model", "files"]// 见 §7
  }
}
```

> `dshGo.goapp` 是**本 fork 新增**的保留字段。上游 App 不认识它，会当未知字段忽略——所以同一个包在上游 App 里仍是一个普通插件，不会崩。

## 3. 安装（两条入口，一个结果）

| 入口 | 做法 | 状态 |
|---|---|---|
| 商店 | 读 market 索引 JSON，下载包 | ⛔ 未接；管理器面板已留入口位 |
| 本地导入 | 目录 / zip，落到 `~/.dsh/goapps/<id>/` | 半实现：注册表能写，导入动作待接 `pickFile` |

两条路都收敛为一次 **注册**：写入注册表 + 挂到 profile（`dsh plugin add` 由引擎侧完成，管理器只负责登记与呈现）。

## 4. 注册表（已实现）

`$DSH_HOME/goapps/registry.json`（默认 `~/.dsh/goapps/registry.json`）：

```json
{ "version": 1, "goapps": [
  { "id": "goapp-demo-word", "name": "go单词", "version": "0.1.0", "kind": "native",
    "enabled": true, "installedAt": 1763000000000, "sessions": ["ses_x"] } ] }
```

- 写：临时文件 + `rename`（原子）。
- 读：解析失败 = 空注册表，不抛异常（坏文件不会让面板变白）。
- 实现：`plugins/goapp/manager/lib/registry.js`（`load/save/upsert/remove/setEnabled/noteSession`）。

## 5. 生命周期

| 动作 | 语义 | 实现位置 |
|---|---|---|
| 启用/禁用 | 写 `enabled`；禁用后不打开（是否真的不加载插件由 profile 决定） | `setEnabled` |
| 删除 | 从注册表移除 + 丢弃 `sessions` 记录 | `remove`，面板 action `remove` |
| 打开 | 渲染该 goapp 的入口 | 面板 action `open`（当前只提示） |

**⛔ 未实现**：删除时真正删除会话本体。需要 `packages/dsh_client` 的删除 API 或桥接的会话删除路由；注册表目前只是「欠账清单」，先保证不丢账。

## 6. 桌面快捷方式（协议已定，未实现）

```
Intent: action=VIEW, component=dsh-go 的启动 alias, extras: { "goapp": "<id>" }
ShortcutInfo: id = "goapp:<id>", shortLabel = goapp 名, icon = goapp 图标
```

- 复用 `app/android/.../shortcuts/ShortcutsPlugin.kt` 的 `publish()` / `rebind()`：
  快捷方式要跟着当前启用的桌面图标 alias 重绑，否则换主题后点不动。
- 入口收到 `goapp` extra → Dart 侧路由到全屏宿主，而不是 `HomeShell`。
- **⛔ 未实现**，且**纯插件做不到**：`ShortcutInfo` 只能由 App 进程发布。必须改 fork 的两处：`ShortcutsPlugin` 增加 goapp 条目、`MainActivity`/Dart 路由识别 `goapp` extra。

## 7. 权限

声明在 `dshGo.goapp.permissions`，与本规范的默认档：

| 权限 | 含义 | 默认 |
|---|---|---|
| `model` | 调用引擎的模型 | 允许 |
| `files` | 读写工作区文件 | 首次使用时确认 |
| `clipboard` | 读写剪贴板 | 首次使用时确认 |
| `phone` | 手机操控（读屏/点按/输入） | **禁用**，需单独开启并逐次确认 |

**⛔ 未实现**：授权状态存储与校验。当前 App 的插件能力是「声明即用」，没有 goapp 级授权层——这是 P2 的一部分。

## 8. 分期与验收

| 期 | 交付 | 验收 |
|---|---|---|
| P0（已完成） | 管理器面板、注册表、示例 goapp | `check.mjs --load` 双语言双位置全绿；真机：能装、能开关、能删 |
| P1 | 商店读 market 索引 + 导入动作 | 面板能列出远端包并安装 |
| P2 | 全屏宿主 + 桌面直达 + 会话命名空间 | 点桌面图标 3 秒内进 goapp，返回键回桌面；删 goapp 后其会话不残留 |
| P3 | 权限层 | `phone` 权限默认关，开启后每次操作需确认 |

P2 起必须改 fork 的 Dart/Kotlin，且**必须真机验证**（CONTRIBUTING 的同款要求：写明 ABI、Android 版本、启动方式、设备）。

## 9. P2 落地锚点（已对照 fork 源码核对）

**跨包打开面板目前被 App 限制在同一个插件内**，这是 P2 的第一个真正门槛：

- 解析：`app/lib/plugins/native/native_effects.dart:214-226` 接受 `{panel: "<id>"}` 或 `"panel:<id>"`，
  非面板页要求落在 `UiSchema.pages` 里。
- 执行：`app/lib/ui/plugins/native/native_taps.dart:685-691` 用
  `plugin.panels.where((p) => p.id == panel)` 只在**当前插件**里找目标，找不到就报
  `plugslotsIssueUnknownPage('panel:<id>')`。
- 结论：管理器的 `open` 动作打不开别的 goapp 的面板。最小改法是让 `panel` 允许
  `"<package>/<id>"` 形式，解析时改走插件注册表按 package 取面板。

**已完成（fork `main`）**：`app/lib/ui/plugins/native/native_taps.dart` 新增
`_panelNamed(ref, plugin, name)` —— 先在当前插件里按 id 找，找不到再按**最后一个**斜杠
拆成 `package` / `id`，从 `nativePanelsProvider`（只含已启用插件）里取；包名可能带 scope
（`@scope/name`），所以不能用第一个斜杠。解析层 `native_effects.dart` 不需要改：它本来就把
`{panel: "<任意字符串>"}` 原样交给执行层。管理器侧 `open` 现在返回
`{ type: 'open', panel: '<package>/<id>' }`（`panelRef()` 由注册表条目的 `package` 与
`entry: "panel:<id>"` 拼出），拿不到原生面板时才退回 toast + callout。

**goapp 标记放在 `package.json` 顶层的 `dshGoGoapp`，不放 `dshGo.goapp`**：桥对 `dshGo`
里的未知键只是忽略并**记一条警告**，而 `check.mjs` 会把每个未知键报成 issue —— 放在 `dshGo`
里等于让每个 goapp 永久带一条警告。`readPackage()` 先读 `dshGoGoapp`，再兼容旧的
`dshGo.goapp`。注册表条目相应多了 `package` 与 `entry` 两个字段（`registry.js` 的 `parse`
原来把它们过滤掉了，这两个字段是跨包打开面板所必需的）。

**全屏宿主已经存在，不用新写**：

- `app/lib/ui/plugins/native/native_panel.dart:155` 的 `NativePanelPage`，
  配套 `NativePanelPage.route({required NativePanel panel, String? sessionId})`，
  内部就是 `AppPage.list`；拿到 `NativePanel` 就能全屏打开。

**桌面直达（P2 剩余部分）必须改 App**：

- `app/android/app/src/main/kotlin/**/shortcuts/ShortcutsPlugin.kt`：
  `publish(recents)` :87、`chat(...)`（`ShortcutInfo` 构造）:193、`rebind(context, entry)` :215。
  goapp 快捷方式要走同一套 `rebind`，否则切换桌面图标 alias 后点不动。
- 入口 `goapp` extra 由 `MainActivity`（`take(intent)` / `onNewIntent`）读，之后 Dart 侧
  直接 push `NativePanelPage.route(...)`，不进 `HomeShell`。
- 会话隔离：`NativePanelPage` 的 `sessionId` 就是 goapp 自己的会话命名空间。
  这套 id 由 App 生成并保管（`app/lib/state/goapp_sessions.dart`），不是 DSH 会话 id——
  goapp 是插件界面，Host 根本不知道它们，所以在这里删掉一个也不可能动到 Host 的会话。
  注册表里的 `sessions[]` 因此只记「欠账」，不是真相。

**构建**：`.github/workflows/build-apk.yml` 产 `dsh-go-<版本>-<flavor>.apk` +
`SHA256SUMS.txt`；`vendor` 里的 `runtime/build-runtime.sh` 需要 live 的 Termux pin
（proot 已随 termux-main 更新到 5.1.107.102）。
### 从 App 外打开一个 goapp（已做 Dart 半边）

链接形式：`dshgo://open/panel/<package>/<id>`，package 可以带 scope（`@scope/name`），
所以规则是「`panel` 之后、最后一段之前全是 package，最后一段是面板 id」。

- `app/lib/links/page_links.dart` 新增 `panelLinkTarget(uri)`；`registerPageLinks` 先查面板
  链接再查页面链接（页面链接要求恰好一段，两者不冲突）。
- `app/lib/ui/plugins/native/goapp_page.dart` 新增 `GoappPanelPage`：`ref.watch(nativePanelsProvider)`
  按 package+id 找面板，拿到就渲染 `NativePanelView`（外面是页面自己的 `AppPage`，
  因为全屏 goapp 的顶栏要放会话按钮）；找不到显示「未知页面」而不是白屏。
- 于是任何能发出 `dshgo://` 的入口（链接、ADB `am start -a android.intent.action.VIEW -d ...`、
  浏览器「添加到主屏」）都能直达 goapp，**不需要经过桌面/HomeShell**。

**还差 Kotlin 半边**：把 goapp 做成 `ShortcutManager` 动态快捷方式（图标 + intent
`ACTION_VIEW` 指向上面那个链接）。这一步必须改 `app/android` 并**真机验证**，本环境无法编译，
所以留作 P2 的下一步；`shortcuts/ShortcutsPlugin.kt` 的 `rebind`/`publish` 就是现成的投放点。

### 每个 goapp 自己的会话（已做）

`app/lib/state/goapp_sessions.dart` 按 package 存两份东西：会话列表（新的在前，上限
`goappSessionLimit = 20`）和「下次默认打开哪个」。存在 `SharedPreferences` 的
`goapp_sessions_v1` 里，每次改动都按顺序落盘（写入串在一条 future 链上，没有防抖定时器），
读不出来就当空——一份坏掉的偏好不该让 goapp 打不开。

- `GoappPanelPage` 在 `initState` 里 `resolve(package, mint)` 一次，结果作为
  `NativePanelView(sessionId:)` 的作用域。所以点桌面图标进来的是**这个 goapp 上次那场对话**，
  而不是聊天页停在哪儿就跟到哪儿。
- `mintGoappSession()` 是顶层函数，store 里没有时钟也没有随机数：测试才能断言具体 id。
- 删除默认会话时回落到最新的一场；删光了下次打开就新起一场，不会「恢复一个已经被删的东西」。

**goapp 内的会话管理（已做）**：页面自己的 `AppPage` 顶栏有一个 `history` 按钮
（`IconButton` 的 key 是 `goapp-conversations`），弹出的 `_GoappConversations`
列出这个 goapp 的会话：

- 新建：`startNew(package, mintGoappSession())` 并切过去；
- 切换：`select` 之后页面换 key（`goapp|<package>|<session>`）重建，`nativeSurfaceProvider`
  是 `autoDispose`，旧会话的界面状态随之释放——这正是「死会话不占内存」的落点；
- 删除：`forget`；删的是当前这场时，回落到最新一场（`resolve`）而不是留在空白页。

界面文案全部复用既有键（`shellChatList` / `commonNewChat` / `commonDelete` / `commonMonthDay`），
没有新增 ARB —— 本机没有 Flutter SDK，跑不了 `l10n_merge.py` 的 `gen-l10n` 这一步，
手写生成物是硬规则禁止的。

**还没做**：goapp 被关掉或删掉时连带清掉它的会话——需要接上插件启停的钩子，
`GoappSessionsStore.forget` 现在只有会话面板这一个调用点；以及桌面图标/会话切换的真机验证。
