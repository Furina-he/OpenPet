# @openpet/plugin-sdk

openpet Desktop 插件作者 SDK——纯类型 + 恒等函数，零运行时依赖。插件在独立
worker 线程中运行（崩溃自动重启、3 次不健康自动禁用），能力由 manifest 权限声明
+ 安装时用户确认 + 宿主能力门三层把守。

## 快速开始

一个插件 = 一个目录（或打成 zip 改后缀 `.dsplug`），根下两个文件：

```
my-plugin/
  plugin.json     # manifest（见下）
  main.js         # 打包后的单文件 ESM（entry，默认名 main.js）
```

### plugin.json

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "author": "you",
  "description": "示例",
  "engine": "desktop",
  "entry": "main.js",
  "permissions": ["tools", "cues", "say", "fetch"],
  "configSchema": {
    "greeting": { "type": "string", "label": "问候语", "hint": "桌宠打招呼用" }
  }
}
```

- `id`：小写字母开头，仅 `[a-z0-9_-]`，2–64 位（即安装目录名）。
- `permissions`：**未声明即拒**。`tools`=注册 LLM 函数工具；`cues`=注册桌宠反应；
  `say`=桌面台词气泡；`fetch`=经宿主代理的网络请求。
- `configSchema`：可缺省。形状为 `{ 配置键: 配置项元数据 }`（AstrBot `_conf_schema.json`
  风格），声明后 Hub 插件页出现「配置」按钮，动态渲染表单；值经 `ctx.config()` 读、
  变更回调 `onConfigChanged`。

### main.js

```js
import { definePlugin } from '@openpet/plugin-sdk';
// （只用类型时不 import 也行——默认导出形状对即可；宿主动态 import 默认导出。）

export default definePlugin({
  tools: [
    {
      name: 'weather',
      description: '查询城市天气',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
      async execute(args, ctx) {
        const r = await ctx.fetch(`https://wttr.in/${args.city}?format=j1`);
        return { raw: r.body.slice(0, 500) };
      },
    },
  ],
  cues: [
    // CueEntry 形状（@openpet/protocol CueSchema，宿主侧校验，不合法的静默丢弃）。
    // 注意：内置/角色包同事件优先——插件 cue 只在该事件无内置表项时生效。
    { on: 'greet.morning', say: ['早上好，今天也要加油！'] },
  ],
  activate(ctx) {
    ctx.log('activated');
    ctx.say('插件上线啦'); // 须声明 'say' 权限，否则静默丢弃
  },
  onConfigChanged(config) {
    // Hub 配置表单保存后推送
  },
});
```

工具注册名在 LLM 侧自动加前缀：`p_<pluginId>_<toolName>`（折叠非法字符、总长 ≤64），
与 MCP 工具并列注入对话。`execute` 抛错会作为工具错误回灌给 LLM，不会杀掉插件。

### PluginCtx

| 方法 | 权限 | 说明 |
| --- | --- | --- |
| `say(text)` | `say` | 桌宠台词气泡（未声明权限时静默丢弃） |
| `fetch(url, init?)` | `fetch` | 宿主代理请求，返回 `{ status, body }`（未声明即 reject） |
| `config()` | — | 当前配置值（`configSchema` 声明后 Hub 可编辑） |
| `log(msg)` | — | 打到主进程日志（`[plugin:<id>]` 前缀） |

## 约束与生命周期

- entry 必须是**自包含单文件 ESM**（作者侧自行 esbuild/rollup 打包；worker 内不装依赖）。
- worker 无环境变量（密钥隔离铁律）、128MB 堆上限；崩溃自动退避重启，连续 3 次
  不健康 → 状态 error 并停用（插件页可见），修好后点「重载」。
- 安装：Hub → 插件 → 「安装 .dsplug / 从文件夹安装」；安装前弹出权限清单确认。
  卸载即删目录。启停走 `plugins.disabled` prefs（重启保留）。
- 热重载（F-PL-06）：插件页「重载」= 停 worker → 重读目录 → 起新 worker。

## 旧接口

`defineTool / defineSkill / defineProvider / installFetchProxy / parseSseStream`
是 provider/skill worker 的既有接口，与 Desktop 插件无关，维持原样。
