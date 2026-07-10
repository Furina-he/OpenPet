# openpet 角色包格式（F-PL-01）

一个角色包 = **一个文件夹** 或 **一个 `.dspack` 文件**（zip 改后缀，包根含 `manifest.json`）。
导入入口：**Hub → 角色 → 角色库 → 「导入 .dspack」/「导入文件夹」**。

## 目录结构

```
<id>/                    目录名必须等于 manifest.id
  manifest.json          必需，包描述（schema 见 @openpet/protocol CharacterManifestSchema）
  model.vrm              模型文件（manifest.model 指向的包内相对路径）
  img/card.png           可选立绘（manifest.preview 指向）
  …                      其余资产（贴图/动作等），运行时经 asset://<id>/<相对路径> 引用
```

## manifest 字段

| 字段 | 类型 | 作用 | 可省 |
| --- | --- | --- | --- |
| `id` | string | 包标识（小写字母/数字/连字符，= 目录名 = asset:// host） | 否 |
| `name` | string | 显示名（角色库卡片/详情） | 否 |
| `version` | string | 包版本（如 `1.0.0`） | 否 |
| `engine` | `"vrm"` \| `"live2d"` | 渲染引擎（live2d = Cubism 4/5 moc3） | 否 |
| `model` | string | 模型文件的包内相对路径（live2d 须指向 `.model3.json`） | 否 |
| `preview` | string | 卡片立绘的包内相对路径；缺省用名称首字占位 | 是 |
| `emotions` | object | 情绪名 → VRM expression 权重组合；缺省用运行时内置表（live2d 忽略） | 是 |
| `actions` | string[] | 动作词表；缺省 DEFAULT_ACTIONS（live2d 忽略） | 是 |
| `cues` | Cue[] | 交互 cue 覆盖表（按 `on` 与内置 DEFAULT_CUES 合并，包优先，F-IT-07） | 是 |
| `persona` | object | 包声明人设 `{ systemPrompt, beginDialogs }`；生效序 = 用户绑定 > 包声明 > 用户默认 > 内置 | 是 |
| `live2dEmotions` | object | Live2D：情绪名 → 表情名（`.exp3.json` 的 `Name`）；未映射的情绪 no-op | 是 |
| `live2dMotions` | object | Live2D：动作名 → `{ group, index? }` motion 组(+序号)；缺表项时尝试同名组 | 是 |

> 所有相对路径禁止 `..`/`\`/盘符/绝对路径；`persona.beginDialogs` 条数须为偶数（用户/角色交替）。

## 最小 manifest 示例

```json
{
  "id": "miko",
  "name": "巫女",
  "version": "1.0.0",
  "engine": "vrm",
  "model": "model.vrm",
  "preview": "img/card.png",
  "persona": {
    "systemPrompt": "你是神社的巫女，说话轻柔带一点古风。",
    "beginDialogs": ["你来啦", "欢迎回来，今天也辛苦了呢。"]
  },
  "cues": [
    { "on": "tap.head", "say": ["呀，头饰要歪掉了啦。"], "emotion": "shy" }
  ]
}
```

## Live2D 角色包（F-CH-02）

`engine: "live2d"`，`model` 指向 `.model3.json` 设置文件；`.moc3`/贴图/motions/
expressions 等按 model3.json 内的相对引用放进包里即可。眨眼/呼吸/物理（physics3.json）
由运行时原生驱动；`live2dEmotions`/`live2dMotions` 把行为标签词表映射到模型的
表情名 / motion 组——`listEmotions/listActions` 返回这两张表的键，LLM 标签直接驱动。

**前置**：Live2D Cubism Core 需手动下载放入 `apps/desktop/src/renderer/public/`
（专有许可不入 git，指引见该目录 README.md）；缺失时切换 Live2D 角色降级 fallback 脸。

最小示例（文件名/表情名/组名以所用模型实际内容为准调整，官方免费样例如 Hiyori）：

```json
{
  "id": "hiyori",
  "name": "Hiyori",
  "version": "1.0.0",
  "engine": "live2d",
  "model": "hiyori_free_t08.model3.json",
  "live2dEmotions": { "happy": "exp_01", "sad": "exp_02" },
  "live2dMotions": { "wave": { "group": "TapBody" }, "nod": { "group": "Tap" } }
}
```

## 开发注意（内置 default 包）

VRM 模型二进制不入 git（见 `../.gitignore`）。本地开发时把示例模型复制进来：

    cp apps/desktop/public/models/sample.vrm apps/desktop/characters/default/model.vrm

模型缺失时 Character 窗口自动降级为 DOM 情绪脸（行为通道契约不变），CI / e2e 不依赖模型。
情绪/动作词表与 `persona-prompt-template.ts` 的 `DEFAULT_EMOTIONS` / `DEFAULT_ACTIONS`
对齐——模板教给 LLM 的标签必须全部可被运行时消费。
