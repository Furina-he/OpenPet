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
| `engine` | `"vrm"` \| `"live2d"` \| `"sprite"` | 渲染引擎（live2d = Cubism 4/5 moc3；sprite = 2D 帧动画图集，见下文） | 否 |
| `model` | string | 模型文件的包内相对路径（live2d 须指向 `.model3.json`；sprite 须指向 `.png` / `.webp` 图集） | 否 |
| `preview` | string | 卡片立绘的包内相对路径；缺省用名称首字占位 | 是 |
| `emotions` | object | 情绪名 → VRM expression 权重组合；缺省用运行时内置表（live2d 忽略） | 是 |
| `actions` | string[] | 动作词表；缺省 DEFAULT_ACTIONS（live2d 忽略） | 是 |
| `cues` | Cue[] | 交互 cue 覆盖表（按 `on` 与内置 DEFAULT_CUES 合并，包优先，F-IT-07） | 是 |
| `persona` | object | 包声明人设 `{ systemPrompt, beginDialogs }`；生效序 = 用户绑定 > 包声明 > 用户默认 > 内置 | 是 |
| `live2dEmotions` | object | Live2D：情绪名 → 表情名（`.exp3.json` 的 `Name`）；未映射的情绪 no-op | 是 |
| `live2dMotions` | object | Live2D：动作名 → `{ group, index? }` motion 组(+序号)；缺表项时尝试同名组 | 是 |
| `sprite` | object | 帧动画：图集描述（engine = sprite 时必填，见「帧动画角色包」） | 是 |

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

## 帧动画角色包（sprite）

`engine: "sprite"`：一张逐帧精灵图集就是一个形象。图集按「格」切分，**一个状态 = 同一行里连续的若干格**，
按逐帧时长播放；行为标签照常驱动——映射到行的情绪 / 动作播那一行，没映射的走程序化 2D 动作
（呼吸、点头、歪头、跳跃……），所以默认词表里的每个情绪和动作都有表现。
形象包（`.dsbody`）同样可以是帧动画，换形象时记忆 / 会话 / 人设原地保留。

### `sprite` 字段

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `layout` | `"codex"` \| `"custom"` | `"custom"` | `codex` = Codex 宠物图集契约，自动展开九个状态（下表）；`custom` 必须给 `cell` + `states` + `slots.idle` |
| `cell` | `{ width, height }` | codex：图尺寸 ÷ (8, 9) | 每格像素尺寸（8–1024 的整数） |
| `states` | `{ 状态名: { row, col?, frames, durationsMs, loop? } }` | codex 九行 | `durationsMs` 写单个数 = 每帧均匀，写数组 = 逐帧（长度须等于 `frames`，每帧 16–5000 ms）；`loop: false` = 播一轮；同名覆盖预设 |
| `emotions` | `{ 情绪: { loop?, enter?, speed? } \| null }` | codex 默认映射 | `loop` = 情绪期间循环的行；`enter` = 进入时先播一轮；`speed` 0.25–4；写 `null` 删除预设映射 |
| `actions` | `{ 动作: 状态名 \| null }` | codex 默认映射 | 映射到行 = 播该行；未映射 = 程序化动作；`null` 删除预设 |
| `slots` | `{ idle, idleLow?, idleHigh?, talk?, dragLeft?, dragRight? }` | codex：idle / running-left / running-right | 空闲、低 / 高能量空闲、说话、向左 / 向右拖拽时播的行 |
| `smoothing` | `"pixel"` \| `"smooth"` | `"smooth"` | `pixel` = 最近邻缩放 + 原生分辨率变换，像素画放大后边缘锐利、呼吸时不「像素蠕动」 |
| `fit` | `"contain"` \| `"integer"` | `"contain"` | `integer` = 放大到整数倍（像素风更锐利） |
| `facing` | `"front"` \| `"left"` \| `"right"` | `"front"` | 素材朝向 |
| `flipToCursor` | boolean | `false` | 仅朝左 / 朝右素材：鼠标在背后一侧时水平翻转（建议只对左右对称的形象开启） |
| `proceduralLife` | boolean | `true` | 程序化呼吸与重心；帧里已有明显 idle 动作的形象可以关掉 |

engine = sprite 时 `emotions` / `actions` / `actionClips` / `live2d*` 顶层字段被忽略；
映射里指向不存在的状态会在导入时被拒绝。

### codex 预设（与 Codex 宠物官方契约一致）

8 列 × 9 行，标准图集 1536×1872（格 192×208；2× 高清图集按比例自动求格）：

| 行 | 状态 | 帧数 | 逐帧时长（ms） | 循环 |
| --- | --- | --- | --- | --- |
| 0 | idle | 6 | 280, 110, 110, 140, 140, 320 | 是 |
| 1 | running-right | 8 | 120 ×7，末帧 220 | 是 |
| 2 | running-left | 8 | 120 ×7，末帧 220 | 是 |
| 3 | waving | 4 | 140 ×3，末帧 280 | 否 |
| 4 | jumping | 5 | 140 ×4，末帧 280 | 否 |
| 5 | failed | 8 | 140 ×7，末帧 240 | 是 |
| 6 | waiting | 6 | 150 ×5，末帧 260 | 是 |
| 7 | running | 6 | 120 ×5，末帧 220 | 是 |
| 8 | review | 6 | 150 ×5，末帧 280 | 是 |

默认映射：思考（thinking）→ review；调用工具（searching）→ running；sad → 循环 failed；出错
（confused / droop）→ failed 一下后回落；curious → waiting；happy / surprised → 跳一下（jumping）；
sleepy → idle 放慢到 0.6 倍；wave → waving；jump → jumping；拖拽 → running-left / running-right。
其余（nod / shake / tilt / fidget / stretch / sigh，angry / shy / relaxed）走程序化 2D 动作。

### 示例

```json
{
  "id": "pixel-cat",
  "name": "像素猫",
  "version": "1.0.0",
  "engine": "sprite",
  "model": "spritesheet.webp",
  "sprite": {
    "layout": "codex",
    "smoothing": "pixel",
    "emotions": { "angry": { "enter": "failed" }, "sleepy": null },
    "actions": { "nod": "waiting" }
  }
}
```

### 把 Codex 宠物转成形象包

用 Codex 的 `hatch-pet` 孵出的宠物（`~/.codex/pets/<名字>/` 下的 `pet.json` + 图集）可以离线转换：

    node scripts/codex-pet-to-body.mjs ~/.codex/pets/<名字> --license "CC-BY-4.0" [--pixel] [--preview art.png]
    node scripts/codex-pet-to-body.mjs --codex-home          # 一次转换 ~/.codex/pets 下的全部宠物

产物在 `./bodies-out/<id>.dsbody`，到 Hub → 角色库 → 形象 → 导入即可。
**只转换你自己孵化或已获授权的宠物；Codex 内置宠物属于 OpenAI，未获授权不得再分发。**

## 开发注意（内置 default 包）

VRM 模型二进制不入 git（见 `../.gitignore`）。本地开发时把示例模型复制进来：

    cp apps/desktop/public/models/sample.vrm apps/desktop/characters/default/model.vrm

模型缺失时 Character 窗口自动降级为 DOM 情绪脸（行为通道契约不变），CI / e2e 不依赖模型。
情绪/动作词表与 `persona-prompt-template.ts` 的 `DEFAULT_EMOTIONS` / `DEFAULT_ACTIONS`
对齐——模板教给 LLM 的标签必须全部可被运行时消费。
