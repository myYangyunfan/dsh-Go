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
| 商店 | 读 market 索引 JSON；条目带 `url` + `sha256` 时下载 `.tar.gz`、校验、解包进 inbox | 已实现（`manager/lib/download.js`） |
| 本地导入 | 目录落进 `~/.dsh/goapps/inbox/`，管理器扫描登记 | 已实现（`manager/lib/import.js`） |

商店条目没有 `url` 时 `install` 退化为「登记 inbox 里已有的那份」，不会假装下载。`sha256` 在给了 `url` 时是**必需**的：没有校验就写可执行界面代码是供应链漏洞，缺校验、校验不符、非 2xx、非 tar.gz、路径越界（`..`、绝对路径）一律拒绝并给出稳定原因码（`no-checksum` / `checksum` / `http-<status>` / `not-tar-gz` / `unsafe-path` / `too-large` / `network`）。解包先写 inbox 下的临时目录再 `rename`，中断不会留下半成品被 `scanInbox` 读到；大小上限 32 MiB。

两条路都收敛为一次 **注册**：写入注册表 + 挂到 profile（`dsh plugin add` 由引擎侧完成，管理器只负责登记与呈现）。

商店包的发布约定：归档是 `.tar.gz`，条目放在**归档根**（`package.json` 在顶层，不再套一层目录），文件落到 `plugins/goapp/store/<package>-<version>.tar.gz`，索引条目写它的 raw URL 与 sha256。`go单词` 就是按这个约定发布的，索引里的 URL 匿名可下载、sha256 与实际字节一致——所以商店的第一次安装是真下载，不是本地登记。仓库里现在同时存着 `goapp-demo-word-0.1.0.tar.gz` 与 `goapp-demo-word-0.2.2.tar.gz`：索引指向 0.2.2，旧包留给「安装同时是更新」这条路做真机验证（先用旧包导入，再从商店升级）。

**打包不是手工活**（`tools/pack.mjs`）：`node plugins/goapp/tools/pack.mjs <包目录> --base-url <商店 raw 前缀> --json` 直接产出归档与索引条目。归档是**字节稳定**的——条目按路径排序、mtime 固定 0、权限 0644、gzip 头不带时间戳，所以同一份源码在任何机器上都得到同一个 sha256；不这样的话，每次换机器打包都要改索引，而索引里的 sha256 是安装时唯一的信任锚。工具同时把住清单门槛（无 `dshGoGoapp.id`、版本号不是 `x.y.z[-pre]`、缺 `package.json` 一律拒绝）与容量上限（超过 32 MiB 的安装上限直接拒绝）。`tools/test/pack.test.js` 把两件事钉成测试：已发布归档 == 由源码打出来的字节，索引 sha256 == 已发布字节——改了 `demo-word` 却忘了重打商店包，测试会红而不是等用户装到一个 sha 校验失败。发布的版本号是**不可变**的：内容变了就发新版本号，不要改同一个版本的字节——`raw.githubusercontent.com` 有分钟级缓存，同一个路径改字节会产生「索引指向新 sha、下载回来还是旧包」的窗口，用户看到的是 `Download failed: checksum`。0.2.0 就这么踩过一次，最后改名 0.2.1 重新发。

**安装同时是更新**（`manager/lib/store.js:versionNewer`）：`install` 先看 inbox 里已有的那份，只在商店版本**更新**时才下载覆盖；版本相同或商店更旧则不动，不降级。比较按点分数字核心（`1.0.10 > 1.0.9`，缺位算 0），正式版压过自己的预发布（`1.0.0 > 1.0.0-beta.2`），但预发布之间不排序——那是发布方的调用，管理器不猜。更新沿用同一个 id，`registry.upsert` 保留 `enabled` 与 `sessions` 两个属于用户的字段：装新版本不会把一个被关掉的 goapp 悄悄打开，也不会丢掉删除时清会话用的 IOU 清单。下载失败时**不动**已装的那份，只在提示里说清原因——升级失败不该把应用从用户手里拿走。

**删除连包体一起删**（`manager/lib/download.js:removeUnpacked`）：注册表里删掉一条之外，它在 inbox 里的目录也一并删除——目录名用的是登记时记下的 `folder`，以及所有同包名/同 id 的兄弟目录（见下下条）。这不是清理洁癖：`scanInbox` 读的正是这些目录，留着的话点一次「导入」就能把用户刚删掉的 goapp 复活；顺带也省掉最多 32 MiB 的解包内容。

为什么记 `folder` 而不是用包名倒推：商店安装的目录名是清洗过的包名，但**手工放进 inbox 的包保留用户解压出来的目录名**（`my-word/` 里装着 `goapp-demo-word`）。只按包名删，删的是一个不存在的路径，真正的目录留着——正好回到上面那个「删了又活」的毛病。所以 `import.readPackage` 把 `path.basename(dir)` 记进注册表，`remove` 原样使用。这个字段来自磁盘、又会直接用于删除，`registry.parse` 只接受单段安全名（`[A-Za-z0-9._-]+`，且不是 `.`/`..`），其余一律丢弃并回落到 `folderFor(package)`——手改注册表写 `"../../keep"` 删不到 inbox 之外的东西（`test/goapp.test.js` 有用例钉住）。

**同一个 id 被两个不同的包抢**（`registry.upsert` + `index.js:dropDisplaced`）：id 是普通单词（`word`），不是带限定名的标识，两个作者撞车是能发生的。此时按「换了一个应用」处理：`enabled`/`sessions` 这些属于用户的字段**不继承**（否则新装的那个可能一上来就是被停用状态，还背着别人的会话欠账）。两个目录同时躺在 inbox 里时新的那个赢（见下条），旧的那个不动——它可能正是用户手工解压进来准备对比的版本；但**删除时两个都删**（`inboxFoldersFor` 按 id 收集目录），删掉 `word` 之后抢过这个 id 的另一份包也不会被「导入」复活。

**同一个包在 inbox 里有两份**（`import.scanInboxDetailed`）：商店装上的是清洗过的包名目录，用户手工解压的是他自己的目录名，两者可以同时存在。`scanInbox` 若不过滤，`install`/`import` 会在两份之间来回跳，`remove` 只删登记的那份，剩下的立刻被「导入」复活。规则：**一个包（包名，无名时退化成 id）只算一份，目录 mtime 最新的代表它**（mtime 相同按目录名排序，跨平台结果一致）；输的那份**只计数不删除**（提示写「跳过重复 N」），删用户手工放进去的文件不归这个函数管。再按 id 折一次，两份不同的包抢同一个 id 时 `find(id)` 也不歧义。

**写不进去要有稳定原因，不能把异常抛给宿主**（`index.js:tryWrite`）：注册表可能因为只读 home、磁盘满、`goapps` 被换成文件（`ENOTDIR`）而写不进去。四个 action 都走 `tryWrite`，失败回一条 `保存失败: <err.code> — <goapp 名>` 的 toast，不静默、不冒充成功。顺序也有讲究：`remove` 先存盘再删文件（存不进去一个字节都不删，注册表里还列着它，用户仍能打开）；`install` 相反，包体已经落进 inbox 才写注册表，写失败只丢登记，点一次「导入」就回来，不必重下。

## 4. 注册表（已实现）

`$DSH_HOME/goapps/registry.json`（默认 `~/.dsh/goapps/registry.json`）：

```json
{ "version": 1, "goapps": [
  { "id": "word", "name": "go单词", "version": "0.2.2", "package": "goapp-demo-word",
    "folder": "goapp-demo-word", "entry": "panel:word", "kind": "native",
    "enabled": true, "installedAt": 1763000000000, "sessions": ["ses_x"] } ] }
```

- `package` / `entry` / `folder`：跨包打开面板（`<package>/<panel id>`）、以及删除时定位 inbox 目录，都靠这三个字段；老注册表没有时按空处理，不会崩。
- 写：临时文件 + `rename`（原子）；写不进去（只读 home、磁盘满、`ENOTDIR`）由 action 层回 `保存失败: <code>` 的 toast，不抛异常给宿主。
- 读：解析失败 = 空注册表，不抛异常（坏文件不会让面板变白）。
- 实现：`plugins/goapp/manager/lib/registry.js`（`load/save/upsert/remove/setEnabled/noteSession`）。

## 5. 生命周期

| 动作 | 语义 | 实现位置 |
|---|---|---|
| 启用/停用 | 写 registry 的 `enabled`，并让管理器的「打开」直接拒绝它（toast「已停用」）。**不**改变 Host 侧插件的加载状态：协议里没有「让 A 插件停用 B 插件」的能力，真停用要去 App 的插件开关（设置 › 插件）。管理器的开关管的是「这个商店/管理器还推不推它」，不是「引擎还加不加载它」 | `setEnabled` + `open` |
| 删除 | 从注册表移除 + 丢弃 `sessions` 记录 + 删掉登记的 inbox 目录 | `remove`，面板 action `remove` |
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
  按 package+id 找面板，拿到就渲染 `NativePanelPage`，找不到显示「未知页面」而不是白屏。
- 于是任何能发出 `dshgo://` 的入口（链接、ADB `am start -a android.intent.action.VIEW -d ...`、
  浏览器「添加到主屏」）都能直达 goapp，**不需要经过桌面/HomeShell**。

**还差 Kotlin 半边**：把 goapp 做成 `ShortcutManager` 动态快捷方式（图标 + intent
`ACTION_VIEW` 指向上面那个链接）。这一步必须改 `app/android` 并**真机验证**，本环境无法编译，
所以留作 P2 的下一步；`shortcuts/ShortcutsPlugin.kt` 的 `rebind`/`publish` 就是现成的投放点。

### 每个 goapp 自己的会话（已做）

`app/lib/state/goapp_sessions.dart` 按 package 存两份东西：会话列表（新的在前，上限
`goappSessionLimit = 20`）和「下次默认打开哪个」。存在 `SharedPreferences` 的
`goapp_sessions_v1` 里，写入按 400ms 防抖，读不出来就当空——一份坏掉的偏好不该让 goapp 打不开。

- `GoappPanelPage` 在 `initState` 里 `resolve(package, mint)` 一次，结果交给
  `NativePanelPage(sessionId:)`。所以点桌面图标进来的是**这个 goapp 上次那场对话**，
  而不是聊天页停在哪儿就跟到哪儿。
- `mint()` 由调用方给，store 里没有时钟也没有随机数：测试才能断言具体 id。
- 删除默认会话时回落到最新的一场；删光了下次打开就新起一场，不会「恢复一个已经被删的东西」。

**还没做**：goapp 内的会话管理界面（新建/切换/删除），以及 goapp 被关掉或删掉时
连带清掉它的会话——后者需要接上插件启停的钩子，现在 `GoappSessions` 只提供
`forget` 这一层能力，没有调用点。
