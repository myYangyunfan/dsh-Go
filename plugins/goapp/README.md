# goapp

**goapp 有两层意思**：

1. **goapp（管理器）** —— `plugins/goapp/manager/`。它本身就是一个 dsh-go 插件，导入后提供一个「goapp 管理」面板：列出已安装的 goapp、开关、删除（连同它的会话）、打开、从商店登记、从 inbox 导入。
2. **goapp（应用包）** —— 例：`plugins/goapp/demo-word/`。每个 goapp 是一个普通插件包，只是清单里声明了自己的面板，界面与 dsh-go 的聊天界面无关。

## 一个包怎样才算 goapp

`package.json` 顶层写一个 `dshGoGoapp`：

```json
"dshGoGoapp": { "id": "word", "kind": "native", "entry": "panel:word" }
```

放在 `dshGo` **外面**是有原因的：桥对 `dshGo` 里的未知键只是忽略，但每个未知键都会被
`check.mjs` 记一条警告 —— 写在里面等于让每个 goapp 永久带一条警告。`readPackage()` 仍兼容
旧的 `dshGo.goapp`。

- `id`：必填，管理器与注册表用它认人（**不是**包名）。
- `kind`：`native` 走插件面板；`web` 的 `entry` 是 `web/index.html`。
- `entry`：原生 goapp 写 `panel:<面板 id>`，与 `dshGo.contributes.panels[].id` 对应。

## 现状

| 能力 | 状态 |
|---|---|
| 安装 / 列表 / 开关 / 删除（连带会话记录） | 已实现（管理器面板 + `$DSH_HOME/goapps/registry.json`） |
| goapp 自带独立界面、全屏打开 | 已实现（插件自己的面板；管理器 `open` 走跨包 `panel` 引用） |
| 商店列表 + 下载安装 | 已实现（条目带 `url` + `sha256` 时由 `manager/lib/download.js` 下载校验解包；索引在 `manager/data/index.json`，可被 `$DSH_HOME/goapps/store/index.json` 覆盖） |
| 商店更新（同 id 覆盖旧版本） | 已实现（`install` 只在商店版本更新时覆盖，保留 `enabled` 与会话 IOU；下载失败保留已装版本；商店列表会把已装且有新版的条目显示为 `旧 → 新`） |
| 从 App 外直达（`dshgo://` 链接） | 已实现（`dshgo://open/panel/<package>/<id>`） |
| 桌面快捷方式图标 | 已实现（App 侧 `ShortcutManager`：启用的 goapp 发布为动态快捷方式，intent 回到同一条 `dshgo://` 链接） |
| 每 goapp 独立会话命名空间 | 已实现（App 侧 `app/lib/state/goapp_sessions.dart`；goapp 内可新建 / 切换 / 删除会话，卸载时清理） |

## 安装与验证

```bash
# 校验（离线，不需要设备）
node sdk/plugin-kit/bin/check.mjs plugins/goapp/manager --load
node sdk/plugin-kit/bin/check.mjs plugins/goapp/demo-word --load

# 单元测试（Node 自带 test runner）
(cd plugins/goapp/manager && node --test test/goapp.test.js test/store.test.js test/download.test.js)
(cd plugins/goapp/tools && node --test test/pack.test.js)

# 装进本机引擎的 profile
dsh plugin --profile web add <仓库路径>/plugins/goapp/manager
dsh plugin --profile web add <仓库路径>/plugins/goapp/demo-word
```

装完在 App 里：设置 › 插件 › 已安装 › 重启内核以重载；然后从「全部功能 › 插件」打开 goapp 管理。

桌面端只能验证到「逻辑对」这一层：快捷方式、深链、PRoot 启动都必须在真机上过一遍。照 [DEVICE-CHECK.md](DEVICE-CHECK.md) 走一遍，把表头和结果随 PR 一起贴出来——`CONTRIBUTING.md` 要求的 ABI / Android 版本 / 启动方式 / 机型缺一项，结论就不可复现。

商店里的 `go单词` 指向 `plugins/goapp/store/goapp-demo-word-0.2.2.tar.gz`（raw URL + sha256 写在 `manager/data/index.json`），点「安装」会真下载、校验、解包进 `$DSH_HOME/goapps/inbox/` 再登记——不需要先手动放包。`0.1.0` 那个包留在仓库里，用来走「先装旧版、再从商店升级」这条真机路径。

## 发布一个 goapp

包目录就是全部真相，`.tar.gz` 由工具生成，不手搓：

```bash
# 打包 + 打印索引条目（默认输出到 plugins/goapp/store/）
node plugins/goapp/tools/pack.mjs plugins/goapp/demo-word \
  --base-url https://raw.githubusercontent.com/<you>/dsh-Go/main/plugins/goapp/store --json

# 校验仓库里已发布的包和源码是否还一致（sha 不符就退出码 1）
node plugins/goapp/tools/pack.mjs plugins/goapp/demo-word --check <索引里的 sha256>
```

五条约定，工具会替你把住：

- **归档根就是包根**：`package.json` 在顶层，不套 `goapp-xxx/` 目录——`scanInbox` 按文件夹读清单，多一层就装不上。
- **同一份源码必须得到同一份字节**：条目按路径排序、mtime 固定为 0、权限 0644、gzip 头不带时间戳。否则两台机器打出来的 sha 不同，每次都要改索引。
- **清单不全就不给打**：没有 `dshGoGoapp.id`、版本号不是 `x.y.z[-pre]`、缺 `package.json`，直接拒绝；超过 32 MiB（管理器的安装上限）也拒绝。
- **写出去的包必须能打开**：`entry` 不是摆设，别让它打错字。`panel:<id>` 必须对得上本包 `dshGo.contributes.panels[].id` 里的某一项，`web` 的 `entry` 必须是包里真实存在的文件，`native` 只能写 `panel:`、`web` 只能写页面路径——否则包打得出来、装得上，只在用户点图标那一刻失败。
- **发出去的版本号不换字节**：内容变了就升版本号。`raw.githubusercontent.com` 有分钟级缓存，同一个路径改字节会出现「索引已经指向新 sha、下载回来的还是旧包」的窗口，用户看到的是校验失败（这个坑是真踩过的：0.2.0 连同字节一起改，索引先落地、CDN 还在发旧包，只好改名成 0.2.1 重新发）。

`tools/test/pack.test.js` 把「已发布的包 == 源码打出来的字节」和「索引 sha == 已发布字节」钉成测试，所以改了 `demo-word` 却忘了重打商店包，CI 会红。

## 一条命令验完

```bash
node plugins/goapp/tools/verify.mjs
```

依次跑管理器测试、打包测试、`sdk/plugin-kit` 对两个插件的 `--load` 校验，最后一行是 `all 4 steps passed` 或失败清单；任一步红了退出码就是 1，适合挂到任何 CI 上。这个 fork 的 GitHub Actions 目前是停的，所以「记得跑哪四条命令」不是流程，这条命令才是。

其中一组测试是**跨语言接缝**（`tools/test/contract.test.js`）：插件侧是纯 JS，App 侧是 Dart + Kotlin，两边没有任何一个编译器同时看见。它按名字钉住 `_panelNamed`、`GoappEntry`、`KIND_GOAPP`、`goapps` 载荷键这些接口，任一端改名就红，并直接指出「哪个文件不再包含哪个标识」。只在 `plugins/goapp` 里改而端点没跟上，就是靠这组测试拦住的。只有 `plugins/goapp` 的 checkout 会把它标成 skip，skip 不算通过。

只在本地放了 `plugins/goapp`、没有整仓的情况下，用 `--check` 指到另一份 checkout 的校验器：

```bash
node plugins/goapp/tools/verify.mjs --check ../dsh-Go/sdk/plugin-kit/bin/check.mjs
```

## 从 App 外直达一个 goapp

```
dshgo://open/panel/goapp-demo-word/word
```

最后一段是面板 id，`panel` 与它之间全是包名（所以 `@scope/name` 这种带斜杠的包名也成立）。
在手机上可以用浏览器「添加到主屏」，或用 ADB 验证：

```bash
adb shell am start -a android.intent.action.VIEW -d "dshgo://open/panel/goapp-demo-word/word"
```

## 注册表格式

`$DSH_HOME/goapps/registry.json`：

```json
{
  "version": 1,
  "goapps": [
    {
      "id": "word",
      "name": "go单词",
      "version": "0.2.2",
      "package": "goapp-demo-word",
      "folder": "goapp-demo-word",
      "entry": "panel:word",
      "kind": "native",
      "enabled": true,
      "installedAt": 1763000000000,
      "sessions": ["ses_..."]
    }
  ]
}
```

`package` 与 `entry` 是能「全屏打开」的前提：管理器用它们拼出 `<package>/<panel id>`。
`folder` 是它在 inbox 里的目录名——手工放进 inbox 的包保留用户解压出来的目录名，所以删除时不能拿包名
去猜目录。这个字段会直接用于删除，因此只接受单段安全名（`[A-Za-z0-9._-]+`，不是 `.`/`..`），
其余丢弃并回落到清洗过的包名，手改注册表删不到 inbox 之外。
写入走临时文件 + rename，中途被杀不会截断。写不进去时（只读 home、磁盘满、`goapps` 被换成文件）
四个 action 都回一条 `保存失败: <err.code>` 的 toast，不把异常抛给宿主；`remove` 是先存盘再删文件，
存不进去就一个字节都不删，注册表里还列着它，用户仍然打得开。删除 goapp 时把它的 inbox 目录一并删除
（目录留着的话，点一次「导入」就能把刚删掉的 goapp 复活）——不止登记的那个目录，同包名或同 id 的兄弟目录
也一起删。`sessions` 记录同样从注册表移除（会话本身的删除由 App/引擎侧接口承担，见上表「未实现」）。

同一个 id 被两个不同的包声明时按「换了一个应用」处理：`enabled`/`sessions` 不继承。
两个目录同时躺在 inbox 里时 mtime 新的那个赢，旧的先不动（可能是用户手工解压来对比的版本），
但删除该 id 时两个目录一起清掉，不会被「导入」抢回来。

同一个包在 inbox 里有两份（商店目录名 + 手工解压目录名）时只算一个 goapp：mtime 最新的代表它，
mtime 相同按目录名排序，跨平台结果一致；输的那份只计数不删除，导入提示里写「跳过重复 N」。
