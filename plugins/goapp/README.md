# goapp

**goapp 有两层意思**：

1. **goapp（管理器）** —— `plugins/goapp-manager/`。它本身就是一个 dsh-go 插件，导入后提供一个「goapp 管理」面板：列出已安装的 goapp、开关、删除（连同它的会话）、打开。
2. **goapp（应用包）** —— 例：`plugins/goapp-demo-word/`。每个 goapp 是一个普通插件包，只是清单里声明了自己的面板，界面与 dsh-go 的聊天界面无关。

## 现状

| 能力 | 状态 |
|---|---|
| 安装 / 列表 / 开关 / 删除（连带会话记录） | 已实现（管理器面板 + `~/.dsh/goapps/registry.json`） |
| goapp 自带独立界面 | 已实现（插件自己的面板，任意组件组合） |
| 商店（market） | 未接；管理器已预留「商店」入口位 |
| 桌面快捷方式直达 | **未实现**：需要 App 侧（`ShortcutsPlugin` + 启动路由），纯插件做不到 |
| 每 goapp 独立会话命名空间 | **未实现**：现在只记录「这个 goapp 开过哪些 session」，供删除时清理 |

## 安装与验证

```bash
# 校验（离线，不需要设备）
node sdk/plugin-kit/bin/check.mjs plugins/goapp-manager --load
node sdk/plugin-kit/bin/check.mjs plugins/goapp-demo-word --load

# 装进本机引擎的 profile
dsh plugin --profile web add <仓库路径>/plugins/goapp-manager
```

装完在 App 里：设置 › 插件 › 已安装 › 重启内核以重载；然后从「全部功能 › 插件」打开 goapp 管理。

## 注册表格式

`~/.dsh/goapps/registry.json`（`$DSH_HOME` 优先）：

```json
{
  "version": 1,
  "goapps": [
    {
      "id": "goapp-demo-word",
      "name": "go单词",
      "version": "0.1.0",
      "kind": "native",
      "enabled": true,
      "installedAt": 1763000000000,
      "sessions": ["ses_..."]
    }
  ]
}
```

写入走临时文件 + rename，中途被杀不会截断。删除 goapp 时把登记的 `sessions` 一并从注册表移除（会话本身的删除由 App/引擎侧接口承担，见上表「未实现」）。
