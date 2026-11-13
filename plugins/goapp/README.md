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
| 商店更新（同 id 覆盖旧版本） | 已实现（`install` 只在商店版本更新时覆盖，保留 `enabled` 与会话 IOU；下载失败保留已装版本） |
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

# 装进本机引擎的 profile
dsh plugin --profile web add <仓库路径>/plugins/goapp/manager
dsh plugin --profile web add <仓库路径>/plugins/goapp/demo-word
```

装完在 App 里：设置 › 插件 › 已安装 › 重启内核以重载；然后从「全部功能 › 插件」打开 goapp 管理。

商店里的 `go单词` 指向 `plugins/goapp/store/goapp-demo-word-0.1.0.tar.gz`（raw URL + sha256 写在 `manager/data/index.json`），点「安装」会真下载、校验、解包进 `$DSH_HOME/goapps/inbox/` 再登记——不需要先手动放包。

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
      "version": "0.1.0",
      "package": "goapp-demo-word",
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
写入走临时文件 + rename，中途被杀不会截断。删除 goapp 时把登记的 `sessions` 一并从注册表移除
（会话本身的删除由 App/引擎侧接口承担，见上表「未实现」）。
