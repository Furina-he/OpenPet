# M4 渲染层 CharacterRuntime 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Character 窗口从 spike 形态（写死 `/models/sample.vrm` + 仅 applyEmotion）升级为 tech-design §7 的完整 CharacterRuntime：load/dispose/applyEmotion/playAction/setLookAt/setIdle 全接口、`asset://` 安全资产加载、LookAt 30Hz 节流 + 平滑插值、Idle 动画池 + intent 子集 + 90s 主动行为事件、性能预算监控、D4 缩放 50–200% 能力。

**Architecture:** 协议侧新增 `CharacterManifest` Zod schema 与 4 个 method（`character.current/setScale/idleTimeout` + `behavior.lookAt` 通知）。Main 侧新增 asset 自定义协议（manifest 路径校验 + 越级 404）、CharacterService（manifest 加载）、CursorPublisher（30Hz 光标→character 窗口直发，不过 chat 背压队列）、IdleResponder（主动行为决策 stub）。Renderer 侧把 `vrm-stage.ts` 演进为 `runtime.ts`（CharacterRuntime 实现），程序化动作库/LookAt 数学/Idle 池/FPS 表/性能预算全部拆成无 DOM 依赖的纯模块单测，WebGL 集成路径靠 e2e + 手测。

**Tech Stack:** TypeScript strict 全开（注意 `exactOptionalPropertyTypes` + `verbatimModuleSyntax`）、Zod、Three.js 0.180 + @pixiv/three-vrm 3.4、Electron 30 `protocol.handle`、Vitest 1.6（fake timers）。

---

## 背景与现状

**M4 规格**（`docs/plans/2026-05-01-desksoul-impl-plan.md` L1300-1312）：

> **范围：** tech-design §7 完整 CharacterRuntime 接口
> - VRM 引擎实现（Three.js + three-vrm）：load / dispose / applyEmotion / playAction / setLookAt / setIdle
> - 资产加载安全：Main 校验 manifest 路径不越级 + 注册 `protocol.handle('asset', ...)` 生成 `asset://` URL
> - LookAt 30Hz 节流 + 平滑插值
> - Idle 动画池 + intent 子集选择 + 90s 主动行为事件
> - 性能预算：单角色 ≤8 万三角面、≤64MB 纹理；FPS 监控
>
> **验收：** 跑 D4 缩放 50–200% 不掉帧（≥30 FPS）；8 种基础 emotion 切换流畅；内置 1 个角色包能完整加载

**现状差距**（M3 后逐一核实源码）：

| 要求 | 现状 | 差距 |
| --- | --- | --- |
| CharacterRuntime 接口 | `vrm-stage.ts` 只有 `applyEmotion`/`dispose`/`renderer` | playAction/setLookAt/setIdle/listEmotions/listActions 全缺 |
| 角色包 + manifest | 无；模型路径写死 `/models/sample.vrm`（vite public） | CharacterManifest schema、`characters/default/` 内置包、`character.current` RPC |
| asset:// 安全加载 | 无（走 vite publicDir，打包后 file:// 直读） | `protocol.handle('asset')` + 路径越级校验 + CSP |
| playAction | fallback 脸显示文字；VRM 端 console.log（`main.ts:33` 注释指给 M4） | 程序化动作库（无 VRMA 资产，8 动作全程序化） |
| LookAt | 无 | Main 30Hz 光标轮询 + `behavior.lookAt` 通知 + 渲染端阻尼插值 |
| Idle | 固定眨眼 + 呼吸 | 变体池 + intent 子集选择 + 90s 主动行为事件回路 |
| 性能预算 | 无监控 | 三角面/纹理量测量 + FPS 30s 滚动平均 |
| D4 缩放 | 窗口固定 320×480 | `character.setScale` RPC + 底边锚定 resize + 渲染端自适应 |
| 情绪词表 | stage 实现 `thinking/confused`，persona 模板宣告 `curious/sleepy` | 对齐：运行时补 curious/sleepy 组合，manifest 可覆盖 |

**M1–M3 已就位、本计划直接依赖的事实**（已核实）：

- 通知通路：Main 广播 `desksoul:notify:<channel>` 到三窗口；character 端 `window.desksoul.on('behavior.*'|'chat.done')` 订阅（`ipc-router.ts:27-31`、`character/main.ts:25-50`）。
- `ConversationCore` 已产出 `behavior.applyEmotion/playAction/setIntent` 三类通知（`conversation-core.ts:31-48`），M4 渲染端只管消费，**双轨拆分零改动**。
- `createRouter` 以 `Methods` 表做 Zod 校验 + 分发，新 method 只需注册 schema + 加 handler（`router.ts:31-49`）。
- character 窗口 `sandbox:false`（透明窗口与 sandbox 冲突，S1 实证）+ `contextIsolation:true`；preload 暴露 `rpc/on`（`windows.ts:46-64`）。
- `desksoul.d.ts` 的 `rpc/on` 类型由 `Methods` 表推导——methods.ts 注册后渲染端自动强类型。
- vitest 无独立配置，node 环境直跑 `test/*.test.ts`；renderer 纯模块可直接 import 单测（`hysteresis.test.ts` 先例）。three 的 BufferGeometry/Object3D 在 node 下可构造（perf-budget 可单测）。
- e2e：`test/e2e-smoke.mjs` 加载真实构建产物，`executeJavaScript` 驱动；CI 不跑 e2e（本地跑）。**CI/file:// 下无 VRM 模型 → fallback 脸**，e2e 判据不依赖渲染形态。
- mock provider 脚本含 `<act:fidget dur=1500/>`（`mock-provider.ts` MOCK_SCRIPT）——e2e 现有断言可继续用。
- persona 模板词表：`DEFAULT_EMOTIONS = happy/sad/angry/surprised/relaxed/shy/curious/sleepy`、`DEFAULT_ACTIONS = wave/nod/shake/fidget/stretch/sigh/jump/tilt`（`persona-prompt-template.ts:20-40`）——运行时必须全部可消费。
- `apps/desktop/public/models/sample.vrm` 已 gitignore、本地存在（S3 下载）；内置角色包模型从它复制。
- protocol 现有 `PROTOCOL_VERSION = '0.3.0'`，测试基线全绿。

---

## 关键决策

**D1 — CharacterManifest 进 protocol 包（单一真源）。** `packages/protocol/src/character-manifest.ts`：id 限 `^[a-z0-9][a-z0-9-]*$`（即 asset URL host，标准 scheme 会小写化 host，故禁大写）；`engine: 'vrm'` 字面量（live2d V1+ 再扩枚举）；`model` 必须过 `isSafeRelPath`（禁 `..` 段、绝对路径、反斜杠、空段）；`emotions` 可选 map（情绪名 → VRM expression 权重组合，缺省用运行时内置表）；`actions` 可选列表（缺省 DEFAULT_ACTIONS）。Main 校验 + Renderer 类型共享同一 schema。

**D2 — asset:// 自定义协议，路径解析纯函数化。** `registerSchemesAsPrivileged` 必须在 app ready 前（index.ts 模块顶层）调用，privileges `{ standard, secure, supportFetchAPI, stream, corsEnabled }`（GLTFLoader 走 fetch，必须 supportFetchAPI）。`protocol.handle('asset', ...)` 内部委托 `resolveAssetPath(charactersRoot, url)` 纯函数：host=characterId 正则校验 → pathname decode 后拒 `..`/`\`/空段 → `path.resolve` 后强制前缀在 `charactersRoot/<id>/` 内，否则 null → 404。响应统一加 `Access-Control-Allow-Origin: *`（dev 时 renderer origin 是 localhost、打包后是 file://，对 asset:// 都是跨源 fetch）。纯函数部分 Vitest 全覆盖，handle 接线靠 e2e。

**D3 — CharacterService 在 Main、`character.current` 拉取。** 读 `charactersRoot/<id>/manifest.json` → JSON.parse → Zod parse → `manifest.id === 目录名` 一致性校验 → 缓存。charactersRoot：dev = `apps/desktop/characters/`（`out/main` 的 `../../characters`），打包 = `process.resourcesPath/characters`（electron-builder `extraResources`，M9 打包验证）。失败直接 throw（renderer catch → fallback 脸，与现有 VRM 加载失败路径汇合）。

**D4 — 内置角色包：manifest 入 git，模型不入。** `apps/desktop/characters/default/manifest.json` 声明 8 基础情绪 = persona `DEFAULT_EMOTIONS`（含 curious/sleepy）+ 8 动作 = `DEFAULT_ACTIONS`。`model.vrm` 走 `.gitignore`（与 S3 同策略），README 指引从 `public/models/sample.vrm` 复制；模型缺失 → fallback 脸（CI/e2e 不需要二进制模型，"内置角色包完整加载"为本地手测验收项）。运行时内置情绪表在 thinking/confused 基础上**补 curious/sleepy 组合**（curious≈surprised0.35+happy0.25、sleepy≈relaxed0.85），消除模板↔运行时词表漂移。

**D5 — LookAt：Main 推、渲染端平滑。** Main `cursor-publisher.ts` 以 33ms（≈30Hz）轮询 `screen.getCursorScreenPoint()`，值不变不发、首拍必发，**只发 character 窗口**且不过 NotificationQueue（那是 per-session chat 背压队列，光标流是常驻无 session 流，混入会被 dropSession 误伤）。通知仍走 `desksoul:notify:behavior.lookAt` 命名约定 + methods.ts 注册 schema（渲染端 `on` 自动强类型）。渲染端纯数学：屏幕坐标→窗口归一化（clamp ±2，窗外仍可远望）→ 头前方目标平面世界坐标；每帧对归一化值做指数阻尼（`1-exp(-λ·dt)`，帧率无关）。`runtime.setLookAt(x,y)` 按 §7 签名收屏幕坐标。D4 的开关/强度设置 M7 接，M4 常开。

**D6 — 动作全程序化（无 VRMA 资产）。** `actions.ts` 纯函数库：`sampleAction(name, phase)` → 骨骼偏移（headPitch/headYaw/headRoll/spinePitch/spineYaw/hipsY/armRaiseL/armRaiseR），全部用 `bump(t)=sin(πt)` 包络保证 **phase=0 与 1 时全零**（与 idle 无缝衔接，可作性质测试）。8 个动作各有默认时长；runtime 内 ActionPlayer 单活动作、新动作顶替旧动作、`durationMs??默认时长`、播完自动回 idle。手臂自然下垂用 rest pose 常量（VRM 默认 T-pose），符号在手测步校准。

**D7 — Idle 池 = 低幅复用动作库 + intent 过滤。** `idle-pool.ts`：变体 = `{action, scale, durationMs, moods?, energies?}`；`selectIdleVariants(intent)` 过滤出子集（无匹配回退通用集）；调度 = 每 4–10s 随机挑一个变体低幅播放（仅在无活动 action 时）。基础层（眨眼 + 呼吸）常驻不变。`behavior.setIntent` 通知 → `runtime.setIdle(intent)` 切子集。

**D8 — 90s 主动行为事件：渲染端检测、Main 决策 stub。** 渲染端 `idle-watch.ts`（纯逻辑类，时钟注入）：活动源 = 任意 behavior.*/chat.done 通知 + 窗口 pointerdown；90s 无活动 → `rpc('character.idleTimeout', {idleMs})`，触发后解除武装、下次活动重新武装（不连发）。Main `idle-responder.ts`：M4 决策 stub = 从低幅池（stretch/sigh/tilt）随机挑动作经 `behavior.playAction` 发回 character 窗口——事件回路端到端打通且肉眼可见；「ConversationCore 决策是否说话」按 tech-design 留给记忆/Persona 里程碑（M6+）。

**D9 — 缩放 = Main 改窗口 bounds、渲染端自适应。** `character.setScale {scale: 0.5–2}`（Zod 限界）→ `scaledBounds(curBounds, scale)` 纯函数：宽高 = 320×480 × scale，**底边中点锚定**（桌宠站位不漂移）→ `win.setBounds`。渲染端 runtime 内 ResizeObserver → `renderer.setSize` + 相机 aspect 更新（等比窗口，构图不变）。D4 滑杆 UI 是 M7；M4 暴露 RPC + e2e 断言 bounds + 手测 FPS。`resizable:false` 不影响程序化 setBounds。

**D10 — 性能预算测量 + FPS 滚动平均。** `perf-budget.ts`：`measureVrmBudget(scene)` 遍历 mesh 统计三角面、按唯一 texture 的 `image.width×height×4` 估算纹理字节；超预算（80k 面 / 64MB）console.warn，**不拒载**（预算是告警线不是硬墙，tech-design 措辞为"预算"）。`fps-meter.ts`：秒桶环形缓冲，30s 滚动平均；每 10s console.info、<30 console.warn。两者经 `window.__charDebug = { fps(), budget, lastLookAt }` 暴露给 e2e/手测（debug 表面，不进 desksoul 协议）。

**D11 — Character 窗口 CSP 落地。** `character/index.html` 加 meta CSP：`default-src 'self' asset:; img-src 'self' asset: data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' asset: ws: http://localhost:*`。比 tech-design §7 基线多出的项：`style-src 'unsafe-inline'`（vite 开发态注入样式 + 本页内联 style）、`connect-src ws:/localhost`（HMR）、`connect-src asset:`（GLTFLoader fetch 模型）。

**D12 — 范围排除**（防镀金）：
- `setLipsync` 接口保留为显式 no-op stub（§7 标 V1+），不实现 viseme。
- `behavior.actionDone` 回报：M4 无消费者，不加（M5+ 插件 hooks 需要时再上）。
- Live2D 引擎、双引擎选择器：manifest.engine 仅 'vrm' 字面量，加载器不做分支。
- D4 设置 UI / LookAt 开关与强度 / 物理开关：M7 设置面板的事。
- 主动行为「说话」决策、90s 时长可配置：M6+（Persona/记忆）再接，M4 常量 90_000 导出。
- NotificationQueue 不动：behavior.lookAt 不进队列（D5），chat 链路零改动。

---

## 文件结构

```
packages/protocol/
  src/character-manifest.ts        # 新建：CHARACTER_ID_RE + isSafeRelPath + CharacterManifestSchema
  src/methods.ts                   # +character.current / character.setScale / character.idleTimeout / behavior.lookAt
  src/index.ts                     # PROTOCOL_VERSION 0.4.0 + 导出 character-manifest
  test/character-manifest.test.ts  # 新建
  test/methods.test.ts             # 追加 4 方法用例

apps/desktop/
  electron/main/
    asset-protocol.ts              # 新建：assetSchemePrivileges + resolveAssetPath + registerAssetProtocol
    character-service.ts           # 新建：createCharacterService（manifest 读取/校验/缓存）
    cursor-publisher.ts            # 新建：startCursorPublisher（30Hz、去重、首拍必发；依赖注入）
    idle-responder.ts              # 新建：createIdleResponder（主动行为决策 stub）
    window-scale.ts                # 新建：CHARACTER_BASE_SIZE + scaledBounds（底边中点锚定）
    windows.ts                     # character 窗口尺寸改用 CHARACTER_BASE_SIZE
    ipc-router.ts                  # 接线三个 character.* method；deps 增 characterWindow/charactersRoot
    index.ts                       # 顶层注册 asset scheme；ready 后 registerAssetProtocol + cursorPublisher
  src/renderer/character/
    runtime.ts                     # 新建：CharacterRuntime 接口 + createVrmRuntime（吸收 vrm-stage 全部逻辑）
    actions.ts                     # 新建：BoneOffsets + ACTIONS + sampleAction（纯）
    lookat.ts                      # 新建：normalizedFromScreen + lookAtWorldTarget + damp（纯）
    idle-pool.ts                   # 新建：IDLE_POOL + selectIdleVariants + planNextIdle（纯）
    fps-meter.ts                   # 新建：FpsMeter（纯）
    perf-budget.ts                 # 新建：measureVrmBudget + checkBudget
    idle-watch.ts                  # 新建：IdleWatch（90s 空闲监视，时钟注入，纯）
    vrm-stage.ts                   # 删除（并入 runtime.ts）
    main.ts                        # 重接：character.current → asset:// → runtime；lookAt/idle-watch/fps/__charDebug
    index.html                     # +CSP meta
  characters/
    .gitignore                     # *.vrm
    default/manifest.json          # 新建（入 git）
    default/README.md              # 模型放置说明
  electron-builder.yml             # +extraResources characters/
  test/
    asset-protocol.test.ts         # resolveAssetPath 全覆盖
    character-service.test.ts      # tmp 目录 fixture
    cursor-publisher.test.ts       # fake timers
    idle-responder.test.ts
    window-scale.test.ts
    actions.test.ts                # 端点归零性质 + 中点非零
    lookat.test.ts
    idle-pool.test.ts
    fps-meter.test.ts
    perf-budget.test.ts            # node 下构造 three 几何
    idle-watch.test.ts
    e2e-smoke.mjs                  # M4 段：character.current / setScale bounds / lookAt 收到
  RESULTS-M4.md                    # 新建：验收映射

CLAUDE.md                          # 项目状态行：M4 完成、下一个 M5
docs/plans/2026-06-12-m4-character-runtime-plan.md  # 本计划（Task 0 入库）
```

依赖顺序：Task 1–2（protocol）→ `pnpm --filter @desksoul/protocol build` 后 desktop 才能看到新类型（turbo `test` dependsOn `^build` 自动保证；手动单跑 vitest 前先 build protocol）。Task 3–9 是 Main 侧（互相独立，按序最稳）；Task 10–15 是 renderer 纯模块（互相独立）；Task 16–17 集成；Task 18 e2e；Task 19 收口。

---

### Task 0: 分支与计划入库

**Files:** 无代码变更（git 操作 + 文档入库）

- [ ] **Step 1: 从 main 开分支**

```bash
cd /d/desk/Desktop/openpet
git checkout main && git checkout -b feat/m4-character-runtime
```

（网络约束：直连 GitHub 不通，跳过 `git pull`；本地 main 已含 M3 合并提交 0f558ae 即最新。）

- [ ] **Step 2: 提交计划文档**

```bash
git add docs/plans/2026-06-12-m4-character-runtime-plan.md
git commit -m "docs: M4 渲染层 CharacterRuntime 实施计划"
```

- [ ] **Step 3: 确认基线绿**

```bash
pnpm build && pnpm -r test
```

Expected: protocol / sidecar / desktop 测试全过（M3 基线）。

---

### Task 1: protocol — isSafeRelPath + CharacterManifestSchema

**Files:**
- Create: `packages/protocol/src/character-manifest.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/test/character-manifest.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `packages/protocol/test/character-manifest.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  isSafeRelPath,
  CharacterManifestSchema,
  CHARACTER_ID_RE,
} from '../src/character-manifest';

describe('isSafeRelPath', () => {
  it.each(['model.vrm', 'assets/model.vrm', 'a/b/c.png', 'idle_01.vrma'])(
    'accepts safe relative path %s',
    (p) => {
      expect(isSafeRelPath(p)).toBe(true);
    },
  );

  it.each([
    '',                    // 空
    '/abs/model.vrm',      // 绝对路径
    'C:/win/model.vrm',    // 盘符
    'C:\\win\\model.vrm',  // 盘符 + 反斜杠
    '..',                  // 越级
    '../model.vrm',        // 越级
    'a/../../b.vrm',       // 中段越级
    'a/./b.vrm',           // 当前段（规范化歧义，拒绝）
    'a//b.vrm',            // 空段
    'a\\b.vrm',            // 反斜杠（Windows 分隔符混入）
    'a/b.vrm/',            // 尾空段
  ])('rejects unsafe path %s', (p) => {
    expect(isSafeRelPath(p)).toBe(false);
  });
});

describe('CHARACTER_ID_RE', () => {
  it('accepts lowercase ids and rejects others', () => {
    expect(CHARACTER_ID_RE.test('default')).toBe(true);
    expect(CHARACTER_ID_RE.test('miko-2')).toBe(true);
    expect(CHARACTER_ID_RE.test('Big')).toBe(false); // asset:// host 会被小写化，禁大写
    expect(CHARACTER_ID_RE.test('-x')).toBe(false);
    expect(CHARACTER_ID_RE.test('a b')).toBe(false);
    expect(CHARACTER_ID_RE.test('')).toBe(false);
  });
});

describe('CharacterManifestSchema', () => {
  const base = {
    id: 'default',
    name: '小灵',
    version: '0.1.0',
    engine: 'vrm',
    model: 'model.vrm',
  };

  it('parses a minimal manifest', () => {
    const m = CharacterManifestSchema.parse(base);
    expect(m.id).toBe('default');
    expect(m.engine).toBe('vrm');
  });

  it('parses optional emotions map and actions list', () => {
    const m = CharacterManifestSchema.parse({
      ...base,
      emotions: { happy: { happy: 1 }, shy: { happy: 0.45, relaxed: 0.55 } },
      actions: ['wave', 'nod'],
    });
    expect(m.emotions?.['shy']).toEqual({ happy: 0.45, relaxed: 0.55 });
    expect(m.actions).toEqual(['wave', 'nod']);
  });

  it('rejects model path traversal', () => {
    expect(() => CharacterManifestSchema.parse({ ...base, model: '../sys.vrm' })).toThrow();
    expect(() => CharacterManifestSchema.parse({ ...base, model: '/abs.vrm' })).toThrow();
  });

  it('rejects bad id / engine / weights', () => {
    expect(() => CharacterManifestSchema.parse({ ...base, id: 'Big' })).toThrow();
    expect(() => CharacterManifestSchema.parse({ ...base, engine: 'live2d' })).toThrow(); // V1+
    expect(() =>
      CharacterManifestSchema.parse({ ...base, emotions: { happy: { happy: 1.5 } } }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: 跑测试看红**

```bash
pnpm --filter @desksoul/protocol exec vitest run test/character-manifest.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

创建 `packages/protocol/src/character-manifest.ts`：

```ts
import { z } from 'zod';

/**
 * 角色包 manifest —— Main（校验/asset 协议）与 Character Renderer（运行时词表）
 * 共享的单一真源（tech-design §7「资产加载安全」）。
 *
 * id 同时是 asset:// URL 的 host：标准 scheme 的 host 会被小写化，因此禁大写。
 */
export const CHARACTER_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

const NAME_RE = /^[a-zA-Z][\w-]*$/;

/**
 * 包内相对路径白名单形状：非空、不含 `\`、无空段/`.`/`..` 段、不以 `/` 开头。
 * 盘符（`C:` 等）被「首段含 `:`」即非法的事实排除（URL/路径段不允许 `:`）。
 */
export function isSafeRelPath(p: string): boolean {
  if (p.length === 0 || p.includes('\\') || p.startsWith('/')) return false;
  const segs = p.split('/');
  return segs.every((s) => s.length > 0 && s !== '.' && s !== '..' && !s.includes(':'));
}

export const CharacterManifestSchema = z.object({
  id: z.string().regex(CHARACTER_ID_RE),
  name: z.string().min(1),
  version: z.string().min(1),
  /** 双引擎二选一（§7）；live2d 留 V1+，schema 先收口为 vrm 字面量。 */
  engine: z.literal('vrm'),
  /** 包内相对路径（asset://<id>/<model> 的 path 部分）。 */
  model: z.string().refine(isSafeRelPath, { message: 'model must be a safe relative path' }),
  /** 情绪名 → VRM expression 权重组合；缺省用运行时内置表。 */
  emotions: z
    .record(z.string().regex(NAME_RE), z.record(z.string().regex(NAME_RE), z.number().min(0).max(1)))
    .optional(),
  /** 动作词表；缺省 DEFAULT_ACTIONS（persona-prompt-template）。 */
  actions: z.array(z.string().regex(NAME_RE)).optional(),
});

export type CharacterManifest = z.infer<typeof CharacterManifestSchema>;
```

修改 `packages/protocol/src/index.ts`，版本号升 0.4.0 并导出新模块：

```ts
export const PROTOCOL_VERSION = '0.4.0';

export * from './jsonrpc.js';
export * from './methods.js';
export * from './behavior-parser.js';
export * from './persona-prompt-template.js';
export * from './schemas.js';
export * from './character-manifest.js';
```

- [ ] **Step 4: 跑测试看绿**

```bash
pnpm --filter @desksoul/protocol exec vitest run
```

Expected: 全过（新文件 + 既有基线）。

- [ ] **Step 5: 提交**

```bash
git add packages/protocol
git commit -m "feat(protocol): CharacterManifest schema + 安全相对路径校验"
```

---

### Task 2: protocol — 四个新 method 注册

**Files:**
- Modify: `packages/protocol/src/methods.ts`
- Test: `packages/protocol/test/methods.test.ts`

- [ ] **Step 1: 写失败测试**

在 `packages/protocol/test/methods.test.ts` 末尾追加：

```ts
describe('character.* + behavior.lookAt (M4)', () => {
  it('character.current takes empty params and returns manifest envelope', () => {
    expect(Methods['character.current'].params.safeParse({}).success).toBe(true);
    const r = Methods['character.current'].result.safeParse({
      characterId: 'default',
      manifest: {
        id: 'default',
        name: '小灵',
        version: '0.1.0',
        engine: 'vrm',
        model: 'model.vrm',
      },
    });
    expect(r.success).toBe(true);
  });

  it('character.setScale bounds scale to [0.5, 2]', () => {
    expect(Methods['character.setScale'].params.safeParse({ scale: 1 }).success).toBe(true);
    expect(Methods['character.setScale'].params.safeParse({ scale: 0.5 }).success).toBe(true);
    expect(Methods['character.setScale'].params.safeParse({ scale: 2 }).success).toBe(true);
    expect(Methods['character.setScale'].params.safeParse({ scale: 0.4 }).success).toBe(false);
    expect(Methods['character.setScale'].params.safeParse({ scale: 2.1 }).success).toBe(false);
  });

  it('character.idleTimeout requires positive integer idleMs', () => {
    expect(Methods['character.idleTimeout'].params.safeParse({ idleMs: 90000 }).success).toBe(true);
    expect(Methods['character.idleTimeout'].params.safeParse({ idleMs: 0 }).success).toBe(false);
    expect(Methods['character.idleTimeout'].params.safeParse({ idleMs: 1.5 }).success).toBe(false);
  });

  it('behavior.lookAt is a notification with screen coords', () => {
    expect(Methods['behavior.lookAt'].params.safeParse({ x: 100, y: -3 }).success).toBe(true);
    expect(Methods['behavior.lookAt'].params.safeParse({ x: 'a', y: 0 }).success).toBe(false);
  });
});
```

（若文件顶部 import 缺 `describe/it/expect` 或 `Methods`，按既有文件头补全。）

- [ ] **Step 2: 跑测试看红**

```bash
pnpm --filter @desksoul/protocol exec vitest run test/methods.test.ts
```

Expected: FAIL（method 未注册）。

- [ ] **Step 3: 写实现**

`packages/protocol/src/methods.ts`：顶部加 import，并在 `'app.window.moveBy'` 条目之后、`// --- notification: Main → UI Overlay Renderer ---` 之前插入 character.* 三个 method；在 `'behavior.setIntent'` 之后插入 `behavior.lookAt`：

```ts
import { CharacterManifestSchema } from './character-manifest.js';
```

```ts
  // --- request/response: Renderer → Main（角色包 / 窗口缩放 / 主动行为，M4）---
  'character.current': {
    // 当前角色包（Main 校验过的 manifest）；渲染端用 asset://<characterId>/<model> 取模型。
    params: z.object({}),
    result: z.object({ characterId: z.string(), manifest: CharacterManifestSchema }),
  },
  'character.setScale': {
    // D4 角色缩放 50%–200%；Main 按底边中点锚定改 character 窗口 bounds。
    params: z.object({ scale: z.number().min(0.5).max(2) }),
    result: z.object({ ok: z.literal(true) }),
  },
  'character.idleTimeout': {
    // 渲染端 90s 空闲上报（tech-design §7「主动行为」）；Main 决策（M4 为动作 stub）。
    params: z.object({ idleMs: z.number().int().positive() }),
    result: z.object({ ok: z.literal(true) }),
  },
```

```ts
  'behavior.lookAt': {
    // Main 30Hz 光标轮询直发 character 窗口（不过 chat 背压队列）；屏幕坐标（DIP）。
    params: z.object({ x: z.number(), y: z.number() }),
    result: z.null(),
  },
```

- [ ] **Step 4: 跑测试 + build**

```bash
pnpm --filter @desksoul/protocol exec vitest run && pnpm --filter @desksoul/protocol build
```

Expected: 测试全过、tsc 无错（后续 desktop 任务依赖 dist）。

- [ ] **Step 5: 提交**

```bash
git add packages/protocol
git commit -m "feat(protocol): character.current/setScale/idleTimeout + behavior.lookAt 协议"
```

---

### Task 3: Main — asset:// 协议（路径解析纯函数 + 注册接线）

**Files:**
- Create: `apps/desktop/electron/main/asset-protocol.ts`
- Test: `apps/desktop/test/asset-protocol.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/test/asset-protocol.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { resolveAssetPath } from '../electron/main/asset-protocol';

const ROOT = path.resolve('/data/characters');
const resolved = (...p: string[]) => path.resolve(ROOT, ...p);

describe('resolveAssetPath', () => {
  it('maps asset://<id>/<file> into the character dir', () => {
    expect(resolveAssetPath(ROOT, 'asset://default/model.vrm')).toBe(
      resolved('default', 'model.vrm'),
    );
    expect(resolveAssetPath(ROOT, 'asset://miko-2/assets/tex.png')).toBe(
      resolved('miko-2', 'assets', 'tex.png'),
    );
  });

  it('ignores query string and decodes percent-encoding', () => {
    expect(resolveAssetPath(ROOT, 'asset://default/model.vrm?v=1')).toBe(
      resolved('default', 'model.vrm'),
    );
    expect(resolveAssetPath(ROOT, 'asset://default/a%20b.png')).toBe(resolved('default', 'a b.png'));
  });

  it('404s traversal / absolute / backslash / drive-letter attempts', () => {
    expect(resolveAssetPath(ROOT, 'asset://default/../other/secret.vrm')).toBeNull();
    expect(resolveAssetPath(ROOT, 'asset://default/%2e%2e/secret.vrm')).toBeNull();
    expect(resolveAssetPath(ROOT, 'asset://default/a%5Cb.png')).toBeNull(); // 反斜杠
    expect(resolveAssetPath(ROOT, 'asset://default//etc/passwd')).toBeNull(); // 空段
    expect(resolveAssetPath(ROOT, 'asset://default/C:/win.ini')).toBeNull(); // 段含冒号
  });

  it('404s bad character id host', () => {
    expect(resolveAssetPath(ROOT, 'asset://../model.vrm')).toBeNull();
    expect(resolveAssetPath(ROOT, 'asset:///model.vrm')).toBeNull(); // 空 host
    expect(resolveAssetPath(ROOT, 'asset://a_b/model.vrm')).toBeNull(); // 下划线不在 id 词表
  });

  it('404s empty path and non-asset scheme and garbage', () => {
    expect(resolveAssetPath(ROOT, 'asset://default/')).toBeNull();
    expect(resolveAssetPath(ROOT, 'asset://default')).toBeNull();
    expect(resolveAssetPath(ROOT, 'file:///etc/passwd')).toBeNull();
    expect(resolveAssetPath(ROOT, 'not a url')).toBeNull();
  });

  it('cross-package escape via resolve is impossible (prefix check)', () => {
    // 即便构造出绕过段检查的输入，resolve 后前缀必须仍在 <root>/<id>/ 内
    expect(resolveAssetPath(ROOT, 'asset://default/sub/../../default2/x.png')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试看红**

```bash
pnpm --filter @desksoul/protocol build && pnpm --filter @desksoul/desktop exec vitest run test/asset-protocol.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

创建 `apps/desktop/electron/main/asset-protocol.ts`：

```ts
/**
 * asset:// 自定义协议 —— 角色包资产的唯一合法入口（tech-design §7「资产加载安全」）。
 *
 * Renderer 只能引用 `asset://<characterId>/<相对路径>`；映射经 resolveAssetPath
 * 白名单解析（host=角色 id、段级校验、resolve 后前缀强校验），任何越级/跨包/
 * 非法形状一律 null → 404。注册分两步：
 *   - assetSchemePrivileges() 必须在 app ready 前经 registerSchemesAsPrivileged 注册
 *     （supportFetchAPI：GLTFLoader 走 fetch；corsEnabled + ACAO：renderer 的
 *     localhost/file 源对 asset:// 是跨源请求）。
 *   - registerAssetProtocol() 在 ready 后挂 protocol.handle。
 */
import { protocol, net } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHARACTER_ID_RE } from '@desksoul/protocol';

export const ASSET_SCHEME = 'asset';

export function assetSchemePrivileges(): Electron.CustomScheme[] {
  return [
    {
      scheme: ASSET_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
  ];
}

/** asset URL → 磁盘绝对路径；任何不合法形状返回 null（调用方 404）。纯函数可单测。 */
export function resolveAssetPath(charactersRoot: string, rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${ASSET_SCHEME}:`) return null;

  const id = url.hostname;
  if (!CHARACTER_ID_RE.test(id)) return null;

  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  rel = rel.replace(/^\//, '');
  if (rel.length === 0 || rel.includes('\\')) return null;
  const segs = rel.split('/');
  if (segs.some((s) => s.length === 0 || s === '.' || s === '..' || s.includes(':'))) return null;

  const base = path.resolve(charactersRoot, id);
  const full = path.resolve(base, rel);
  if (!full.startsWith(base + path.sep)) return null; // 跨包/越级兜底（防解析歧义）
  return full;
}

export function registerAssetProtocol(charactersRoot: string): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const filePath = resolveAssetPath(charactersRoot, request.url);
    if (!filePath) return new Response('not found', { status: 404 });
    const res = await net.fetch(pathToFileURL(filePath).toString());
    // net.fetch(file://) 不带 CORS 头；renderer 源（localhost/file）跨源取 asset:// 必须显式放行
    const headers = new Headers(res.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(res.body, { status: res.status, headers });
  });
}
```

- [ ] **Step 4: 跑测试看绿**

```bash
pnpm --filter @desksoul/desktop exec vitest run test/asset-protocol.test.ts
```

Expected: PASS（resolveAssetPath 全部用例；registerAssetProtocol 接线由 Task 18 e2e 验证）。

注意：vitest 在 node 环境 import 本文件会触发 `import { protocol, net } from 'electron'` —— electron 包在 node 下导出的是路径字符串，具名导入会失败。**若 Step 4 报 electron 导入错误**，把 electron 导入改为惰性：`registerAssetProtocol` 内部 `const { protocol, net } = await import('electron')`（函数签名改 `async`），`assetSchemePrivileges` 返回普通对象数组并把类型改为本地 interface（不引用 `Electron.CustomScheme`）。优先尝试静态导入——desktop 包 vitest 此前从未 import 过 electron 模块，以实测为准。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/electron/main/asset-protocol.ts apps/desktop/test/asset-protocol.test.ts
git commit -m "feat(desktop): asset:// 协议 - 角色包路径白名单解析 + 404 兜底"
```

---

### Task 4: Main — CharacterService（manifest 加载/校验/缓存）

**Files:**
- Create: `apps/desktop/electron/main/character-service.ts`
- Test: `apps/desktop/test/character-service.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/test/character-service.test.ts`：

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createCharacterService } from '../electron/main/character-service';

let root: string;

function writeManifest(id: string, manifest: unknown): void {
  mkdirSync(path.join(root, id), { recursive: true });
  writeFileSync(path.join(root, id, 'manifest.json'), JSON.stringify(manifest));
}

const VALID = {
  id: 'default',
  name: '小灵',
  version: '0.1.0',
  engine: 'vrm',
  model: 'model.vrm',
  actions: ['wave', 'nod'],
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'desksoul-chars-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('createCharacterService', () => {
  it('loads and validates the default manifest', () => {
    writeManifest('default', VALID);
    const svc = createCharacterService(root);
    const cur = svc.current();
    expect(cur.characterId).toBe('default');
    expect(cur.manifest.model).toBe('model.vrm');
    expect(cur.manifest.actions).toEqual(['wave', 'nod']);
  });

  it('caches after first load (later file corruption invisible)', () => {
    writeManifest('default', VALID);
    const svc = createCharacterService(root);
    svc.current();
    writeFileSync(path.join(root, 'default', 'manifest.json'), '{broken');
    expect(svc.current().manifest.name).toBe('小灵');
  });

  it('throws on missing manifest', () => {
    const svc = createCharacterService(root);
    expect(() => svc.current()).toThrow(/manifest/i);
  });

  it('throws on schema violation (model traversal)', () => {
    writeManifest('default', { ...VALID, model: '../escape.vrm' });
    const svc = createCharacterService(root);
    expect(() => svc.current()).toThrow();
  });

  it('throws when manifest.id mismatches its directory name', () => {
    writeManifest('default', { ...VALID, id: 'other' });
    const svc = createCharacterService(root);
    expect(() => svc.current()).toThrow(/id/i);
  });

  it('throws on broken JSON', () => {
    mkdirSync(path.join(root, 'default'), { recursive: true });
    writeFileSync(path.join(root, 'default', 'manifest.json'), '{not json');
    const svc = createCharacterService(root);
    expect(() => svc.current()).toThrow();
  });
});
```

- [ ] **Step 2: 跑测试看红**

```bash
pnpm --filter @desksoul/desktop exec vitest run test/character-service.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

创建 `apps/desktop/electron/main/character-service.ts`：

```ts
/**
 * CharacterService —— 角色包 manifest 的 Main 侧加载/校验/缓存（纯 Node，无 Electron 依赖）。
 *
 * `character.current` 的后端：读 `<charactersRoot>/<id>/manifest.json` → Zod 校验
 * （CharacterManifestSchema 含路径安全 refine）→ id 与目录名一致性 → 缓存。
 * 失败 throw（ipcMain.handle 化为 rejected promise；渲染端 catch → fallback 脸）。
 * MVP 单角色 'default'；多角色/切换是 V1（角色管理 E 系列）的事。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CharacterManifestSchema, type CharacterManifest } from '@desksoul/protocol';

export interface LoadedCharacter {
  characterId: string;
  manifest: CharacterManifest;
}

export interface CharacterService {
  current(): LoadedCharacter;
}

export function createCharacterService(charactersRoot: string, defaultId = 'default'): CharacterService {
  let cache: LoadedCharacter | null = null;

  function load(id: string): LoadedCharacter {
    const file = path.join(charactersRoot, id, 'manifest.json');
    let raw: string;
    try {
      raw = readFileSync(file, 'utf8');
    } catch (e) {
      throw new Error(`character manifest unreadable: ${file} (${String(e)})`);
    }
    const manifest = CharacterManifestSchema.parse(JSON.parse(raw));
    if (manifest.id !== id) {
      throw new Error(`manifest id "${manifest.id}" mismatches directory "${id}"`);
    }
    return { characterId: id, manifest };
  }

  return {
    current() {
      cache ??= load(defaultId);
      return cache;
    },
  };
}
```

- [ ] **Step 4: 跑测试看绿**

```bash
pnpm --filter @desksoul/desktop exec vitest run test/character-service.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/electron/main/character-service.ts apps/desktop/test/character-service.test.ts
git commit -m "feat(desktop): CharacterService - manifest 加载/Zod 校验/id 一致性/缓存"
```

---

### Task 5: 内置角色包 default + extraResources

**Files:**
- Create: `apps/desktop/characters/.gitignore`
- Create: `apps/desktop/characters/default/manifest.json`
- Create: `apps/desktop/characters/default/README.md`
- Modify: `apps/desktop/electron-builder.yml`

- [ ] **Step 1: 创建角色包文件**

`apps/desktop/characters/.gitignore`：

```
*.vrm
```

`apps/desktop/characters/default/manifest.json`（情绪/动作词表与 persona-prompt-template 的 DEFAULT_EMOTIONS / DEFAULT_ACTIONS 对齐——模板教 LLM 的标签必须全部可被运行时消费）：

```json
{
  "id": "default",
  "name": "小灵",
  "version": "0.1.0",
  "engine": "vrm",
  "model": "model.vrm",
  "emotions": {
    "happy": { "happy": 1 },
    "sad": { "sad": 1 },
    "angry": { "angry": 1 },
    "surprised": { "surprised": 1 },
    "relaxed": { "relaxed": 1 },
    "shy": { "happy": 0.45, "relaxed": 0.55 },
    "curious": { "surprised": 0.35, "happy": 0.25 },
    "sleepy": { "relaxed": 0.85 }
  },
  "actions": ["wave", "nod", "shake", "fidget", "stretch", "sigh", "jump", "tilt"]
}
```

`apps/desktop/characters/default/README.md`：

```markdown
# 内置角色包 · default

VRM 模型二进制不入 git（见 `../.gitignore`）。本地开发时把 S3 下载的示例模型复制进来：

​```bash
cp apps/desktop/public/models/sample.vrm apps/desktop/characters/default/model.vrm
​```

模型缺失时 Character 窗口自动降级为 DOM 情绪脸（行为通道契约不变），CI / e2e 不依赖模型。
manifest 字段定义见 `@desksoul/protocol` 的 `CharacterManifestSchema`。
```

（注意：README 里的代码围栏如果嵌套冲突，用缩进代码块即可，内容不变。）

- [ ] **Step 2: 复制本地模型（不入 git）**

```bash
cp apps/desktop/public/models/sample.vrm apps/desktop/characters/default/model.vrm
git check-ignore apps/desktop/characters/default/model.vrm
```

Expected: check-ignore 输出该路径（已被忽略）。

- [ ] **Step 3: electron-builder 带上角色包**

`apps/desktop/electron-builder.yml` 末尾追加：

```yaml
extraResources:
  - from: characters
    to: characters
```

（打包后落在 `process.resourcesPath/characters`，与 Task 9 的 charactersRoot 解析对应；M9 打包里程碑做实测。）

- [ ] **Step 4: 验证 manifest 可被 CharacterService 加载**

```bash
node -e "
const { createCharacterService } = require('./apps/desktop/node_modules/@desksoul/protocol/dist/index.js') ? null : null;
" 2>/dev/null || true
pnpm --filter @desksoul/desktop exec vitest run test/character-service.test.ts
```

再做一次真实文件 spot-check（node ESM 内联）：

```bash
node --input-type=module -e "
import { CharacterManifestSchema } from './packages/protocol/dist/index.js';
import { readFileSync } from 'node:fs';
const m = CharacterManifestSchema.parse(JSON.parse(readFileSync('apps/desktop/characters/default/manifest.json','utf8')));
console.log('manifest OK:', m.id, Object.keys(m.emotions).length, 'emotions');
"
```

Expected: `manifest OK: default 8 emotions`。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/characters apps/desktop/electron-builder.yml
git commit -m "feat(desktop): 内置角色包 default(manifest 入 git/模型忽略) + extraResources"
```

---

### Task 6: Main — 窗口缩放纯函数 scaledBounds

**Files:**
- Create: `apps/desktop/electron/main/window-scale.ts`
- Modify: `apps/desktop/electron/main/windows.ts`
- Test: `apps/desktop/test/window-scale.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/test/window-scale.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { CHARACTER_BASE_SIZE, scaledBounds } from '../electron/main/window-scale';

describe('scaledBounds', () => {
  const cur = { x: 100, y: 200, width: 320, height: 480 }; // scale=1 站位

  it('base size matches the character window default', () => {
    expect(CHARACTER_BASE_SIZE).toEqual({ width: 320, height: 480 });
  });

  it('keeps bottom-center anchored at 50%', () => {
    const b = scaledBounds(cur, 0.5);
    expect(b).toEqual({ x: 180, y: 440, width: 160, height: 240 });
    // 底边中点不变：x+w/2 = 260, y+h = 680
    expect(b.x + b.width / 2).toBe(cur.x + cur.width / 2);
    expect(b.y + b.height).toBe(cur.y + cur.height);
  });

  it('keeps bottom-center anchored at 200%', () => {
    const b = scaledBounds(cur, 2);
    expect(b).toEqual({ x: -60, y: -280, width: 640, height: 960 });
  });

  it('is idempotent for repeated same-scale calls (anchored on current bounds)', () => {
    const once = scaledBounds(cur, 1.5);
    const twice = scaledBounds(once, 1.5);
    expect(twice).toEqual(once);
  });

  it('rounds to integers', () => {
    const b = scaledBounds(cur, 0.77);
    expect(Number.isInteger(b.x) && Number.isInteger(b.y)).toBe(true);
    expect(b.width).toBe(Math.round(320 * 0.77));
    expect(b.height).toBe(Math.round(480 * 0.77));
  });
});
```

- [ ] **Step 2: 跑测试看红**

```bash
pnpm --filter @desksoul/desktop exec vitest run test/window-scale.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

创建 `apps/desktop/electron/main/window-scale.ts`：

```ts
/**
 * D4 角色缩放（50%–200%）的窗口几何 —— 纯函数，Electron 缝在 ipc-router。
 * 锚定底边中点：桌宠"站"在桌面上，缩放时脚底位置不漂移。
 */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const CHARACTER_BASE_SIZE = { width: 320, height: 480 } as const;

export function scaledBounds(
  current: Bounds,
  scale: number,
  base: { width: number; height: number } = CHARACTER_BASE_SIZE,
): Bounds {
  const width = Math.round(base.width * scale);
  const height = Math.round(base.height * scale);
  const centerX = current.x + current.width / 2;
  const bottom = current.y + current.height;
  return { x: Math.round(centerX - width / 2), y: Math.round(bottom - height), width, height };
}
```

修改 `apps/desktop/electron/main/windows.ts`：character 窗口尺寸常量改用单一真源。文件头 import 区加：

```ts
import { CHARACTER_BASE_SIZE } from './window-scale.js';
```

`createAppWindows` 内 character 的创建参数改为（仅 width/height/x/y 四行变化）：

```ts
  const character = new BrowserWindow({
    width: CHARACTER_BASE_SIZE.width,
    height: CHARACTER_BASE_SIZE.height,
    x: workArea.x + workArea.width - CHARACTER_BASE_SIZE.width - margin,
    y: workArea.y + workArea.height - CHARACTER_BASE_SIZE.height - margin,
    // ...其余参数原样保留
```

（overlay 的 x 计算里硬编码的 `320` 同步替换为 `CHARACTER_BASE_SIZE.width`。）

- [ ] **Step 4: 跑测试看绿 + typecheck**

```bash
pnpm --filter @desksoul/desktop exec vitest run test/window-scale.test.ts && pnpm --filter @desksoul/desktop typecheck
```

Expected: PASS / 无类型错误。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/electron/main/window-scale.ts apps/desktop/electron/main/windows.ts apps/desktop/test/window-scale.test.ts
git commit -m "feat(desktop): scaledBounds 底边中点锚定缩放 + 窗口基准尺寸单一真源"
```

---

### Task 7: Main — CursorPublisher（30Hz 光标 → character 窗口）

**Files:**
- Create: `apps/desktop/electron/main/cursor-publisher.ts`
- Test: `apps/desktop/test/cursor-publisher.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/test/cursor-publisher.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startCursorPublisher, CURSOR_INTERVAL_MS } from '../electron/main/cursor-publisher';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('startCursorPublisher', () => {
  it('emits the first sample immediately, then only on change', () => {
    const sent: Array<{ x: number; y: number }> = [];
    let cursor = { x: 10, y: 20 };
    const pub = startCursorPublisher({ getCursor: () => cursor, send: (p) => sent.push(p) });

    expect(sent).toEqual([{ x: 10, y: 20 }]); // 首拍必发（静止光标也要有初始朝向）

    vi.advanceTimersByTime(CURSOR_INTERVAL_MS * 3);
    expect(sent).toHaveLength(1); // 不动不发

    cursor = { x: 11, y: 20 };
    vi.advanceTimersByTime(CURSOR_INTERVAL_MS);
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual({ x: 11, y: 20 });
    pub.stop();
  });

  it('polls at ~30Hz', () => {
    expect(CURSOR_INTERVAL_MS).toBe(33);
  });

  it('stop() halts polling', () => {
    const sent: unknown[] = [];
    let cursor = { x: 0, y: 0 };
    const pub = startCursorPublisher({ getCursor: () => cursor, send: (p) => sent.push(p) });
    pub.stop();
    cursor = { x: 5, y: 5 };
    vi.advanceTimersByTime(CURSOR_INTERVAL_MS * 5);
    expect(sent).toHaveLength(1); // 只剩首拍
  });

  it('swallows getCursor failures (e.g. screen API transient error)', () => {
    let throwing = true;
    const sent: unknown[] = [];
    const pub = startCursorPublisher({
      getCursor: () => {
        if (throwing) throw new Error('boom');
        return { x: 1, y: 1 };
      },
      send: (p) => sent.push(p),
    });
    expect(sent).toHaveLength(0); // 首拍失败被吞
    throwing = false;
    vi.advanceTimersByTime(CURSOR_INTERVAL_MS);
    expect(sent).toEqual([{ x: 1, y: 1 }]);
    pub.stop();
  });
});
```

- [ ] **Step 2: 跑测试看红**

```bash
pnpm --filter @desksoul/desktop exec vitest run test/cursor-publisher.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

创建 `apps/desktop/electron/main/cursor-publisher.ts`：

```ts
/**
 * LookAt 光标源（tech-design §7）：Main 以 ~30Hz 轮询全局光标，值变化才推
 * `behavior.lookAt` 到 character 窗口。
 *
 * 不走 NotificationQueue —— 那是 per-session 的 chat 背压队列（cancel 会
 * dropSession），光标是常驻无 session 流；直发 + 变化去重本身就是节流。
 * 依赖全注入（getCursor/send），纯定时器逻辑可 fake-timers 单测。
 */
export const CURSOR_INTERVAL_MS = 33; // ~30Hz

export interface CursorPublisherDeps {
  getCursor: () => { x: number; y: number };
  send: (point: { x: number; y: number }) => void;
}

export function startCursorPublisher(deps: CursorPublisherDeps): { stop: () => void } {
  let last: { x: number; y: number } | null = null;

  const sample = (): void => {
    let p: { x: number; y: number };
    try {
      p = deps.getCursor();
    } catch {
      return; // screen API 偶发失败（锁屏/会话切换）：跳过本拍
    }
    if (last && last.x === p.x && last.y === p.y) return;
    last = { x: p.x, y: p.y };
    deps.send(last);
  };

  sample(); // 首拍必发：静止光标也要有初始朝向
  const timer = setInterval(sample, CURSOR_INTERVAL_MS);
  return { stop: () => clearInterval(timer) };
}
```

- [ ] **Step 4: 跑测试看绿**

```bash
pnpm --filter @desksoul/desktop exec vitest run test/cursor-publisher.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/electron/main/cursor-publisher.ts apps/desktop/test/cursor-publisher.test.ts
git commit -m "feat(desktop): CursorPublisher - 30Hz 光标轮询/变化去重/首拍必发"
```

---

### Task 8: Main — IdleResponder（主动行为决策 stub）

**Files:**
- Create: `apps/desktop/electron/main/idle-responder.ts`
- Test: `apps/desktop/test/idle-responder.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/test/idle-responder.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { createIdleResponder, IDLE_ACTION_POOL } from '../electron/main/idle-responder';

describe('createIdleResponder', () => {
  it('broadcasts a low-key playAction picked from the pool', () => {
    const sent: Array<{ channel: string; params: unknown }> = [];
    const responder = createIdleResponder((channel, params) => sent.push({ channel, params }), () => 0);
    responder.onIdleTimeout(90_000);
    expect(sent).toEqual([
      {
        channel: 'behavior.playAction',
        params: { name: IDLE_ACTION_POOL[0], durationMs: null },
      },
    ]);
  });

  it('rand picks across the whole pool', () => {
    const names: string[] = [];
    const responder = createIdleResponder(
      (_c, params) => names.push((params as { name: string }).name),
      () => 0.999,
    );
    responder.onIdleTimeout(90_000);
    expect(names[0]).toBe(IDLE_ACTION_POOL[IDLE_ACTION_POOL.length - 1]);
  });

  it('pool only contains low-key actions', () => {
    expect(IDLE_ACTION_POOL).toEqual(['stretch', 'sigh', 'tilt']);
  });
});
```

- [ ] **Step 2: 跑测试看红**

```bash
pnpm --filter @desksoul/desktop exec vitest run test/idle-responder.test.ts
```

Expected: FAIL。

- [ ] **Step 3: 写实现**

创建 `apps/desktop/electron/main/idle-responder.ts`：

```ts
/**
 * 90s 主动行为的 Main 侧决策 —— M4 是 stub：从低幅动作池随机挑一个发回
 * character 窗口（回路端到端打通且肉眼可见）。tech-design §7 的完整语义
 * （ConversationCore 决策是否说话）依赖 Persona/记忆，M6+ 在此处替换实现。
 */
export const IDLE_ACTION_POOL = ['stretch', 'sigh', 'tilt'] as const;

export interface IdleResponder {
  onIdleTimeout(idleMs: number): void;
}

export function createIdleResponder(
  sendToCharacter: (channel: string, params: unknown) => void,
  rand: () => number = Math.random,
): IdleResponder {
  return {
    onIdleTimeout(_idleMs: number): void {
      const name = IDLE_ACTION_POOL[Math.floor(rand() * IDLE_ACTION_POOL.length)]!;
      sendToCharacter('behavior.playAction', { name, durationMs: null });
    },
  };
}
```

- [ ] **Step 4: 跑测试看绿**

```bash
pnpm --filter @desksoul/desktop exec vitest run test/idle-responder.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/electron/main/idle-responder.ts apps/desktop/test/idle-responder.test.ts
git commit -m "feat(desktop): IdleResponder - 90s 主动行为决策 stub(低幅动作池)"
```

---

### Task 9: Main — ipc-router + index.ts 接线

**Files:**
- Modify: `apps/desktop/electron/main/ipc-router.ts`
- Modify: `apps/desktop/electron/main/index.ts`

接线任务：纯逻辑已在 Task 3–8 各自单测覆盖，本任务以 typecheck + 既有测试回归为门，端到端由 Task 18 e2e 验证。

- [ ] **Step 1: ipc-router 注册 character.***

`apps/desktop/electron/main/ipc-router.ts` 全量更新为：

```ts
/**
 * IPC 路由接线 — Renderer ⇄ Main 的唯一缝。
 *
 * 进站：preload 的 `window.desksoul.rpc` → `ipcMain.handle('desksoul:rpc')` →
 *       纯 router（Zod 校验 + 分发）→ ChatService / CharacterService / 窗口操作。
 * 出站：ChatService 的背压队列 flush → 广播到所有窗口的
 *       `desksoul:notify:<channel>`；各 renderer 只订阅自己关心的 channel
 *       （overlay → chat.*，character → behavior.* + chat.done）。
 *       behavior.lookAt / 主动行为 playAction 只与 character 相关 → 经
 *       sendToCharacter 直发，不进背压队列（见 cursor-publisher.ts 头注释）。
 * 业务编排全部下沉到纯模块——本文件只做 Electron 缝。
 */
import { ipcMain, BrowserWindow, type WebContents } from 'electron';
import { ChatService } from './chat-service.js';
import { createRouter } from './router.js';
import { createCharacterService } from './character-service.js';
import { createIdleResponder } from './idle-responder.js';
import { scaledBounds } from './window-scale.js';

export interface IpcRouterDeps {
  targets: () => WebContents[];
  /** character 窗口定位（setScale / 主动行为直发）。 */
  characterWindow: () => BrowserWindow | null;
  /** 角色包根目录（dev: apps/desktop/characters；打包: resources/characters）。 */
  charactersRoot: string;
  providerEntryPath: string;
  /** 会话历史 JSON 持久化路径（生产传 userData 下文件；测试可省略）。 */
  persistPath?: string;
}

export interface RpcContext {
  win: BrowserWindow | null;
}

export function registerIpcRouter(deps: IpcRouterDeps): { dispose: () => Promise<void> } {
  const broadcast = (channel: string, params: unknown): void => {
    for (const wc of deps.targets()) {
      if (!wc.isDestroyed()) wc.send(`desksoul:notify:${channel}`, params);
    }
  };
  const sendToCharacter = (channel: string, params: unknown): void => {
    const win = deps.characterWindow();
    if (win && !win.isDestroyed()) win.webContents.send(`desksoul:notify:${channel}`, params);
  };

  const chat = new ChatService({
    providerEntryPath: deps.providerEntryPath,
    broadcast,
    ...(deps.persistPath ? { persistPath: deps.persistPath } : {}),
  });
  const characters = createCharacterService(deps.charactersRoot);
  const idleResponder = createIdleResponder(sendToCharacter);

  const router = createRouter<RpcContext>({
    'sys.ping': (p) => ({ pong: 'ok', echoNonce: p.nonce }),
    'chat.send': (p) => chat.send(p.sessionId, p.text),
    'chat.cancel': (p) => chat.cancel(p.sessionId),
    'chat.snapshot': (p) => chat.snapshot(p.sessionId, p.limit),
    'character.current': () => characters.current(),
    'character.setScale': (p) => {
      const win = deps.characterWindow();
      if (win && !win.isDestroyed()) win.setBounds(scaledBounds(win.getBounds(), p.scale));
      return { ok: true as const };
    },
    'character.idleTimeout': (p) => {
      idleResponder.onIdleTimeout(p.idleMs);
      return { ok: true as const };
    },
    'app.window.setClickThrough': (p, ctx) => {
      ctx.win?.setIgnoreMouseEvents(p.ignore, { forward: true });
      return { ok: true as const };
    },
    'app.window.moveBy': (p, ctx) => {
      if (ctx.win) {
        const [x, y] = ctx.win.getPosition();
        ctx.win.setPosition(x + Math.round(p.dx), y + Math.round(p.dy));
      }
      return { ok: true as const };
    },
  });

  ipcMain.handle('desksoul:rpc', (e, payload: { method?: unknown; params?: unknown }) => {
    const method = typeof payload?.method === 'string' ? payload.method : '';
    return router.dispatch(method, payload?.params, {
      win: BrowserWindow.fromWebContents(e.sender),
    });
  });

  return {
    dispose: async () => {
      ipcMain.removeHandler('desksoul:rpc');
      await chat.dispose();
    },
  };
}
```

- [ ] **Step 2: index.ts 注册 asset scheme + cursor publisher**

`apps/desktop/electron/main/index.ts` 全量更新为：

```ts
import { app, screen } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { protocol } from 'electron';
import { createAppWindows, rendererTargets, type AppWindows } from './windows.js';
import { registerIpcRouter } from './ipc-router.js';
import { assetSchemePrivileges, registerAssetProtocol } from './asset-protocol.js';
import { startCursorPublisher } from './cursor-publisher.js';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 必须在 app ready 前注册（Electron 限制）；ready 后调用会静默不生效。
protocol.registerSchemesAsPrivileged(assetSchemePrivileges());

let wins: AppWindows | null = null;
let router: { dispose: () => Promise<void> } | null = null;
let cursorPublisher: { stop: () => void } | null = null;

app.whenReady().then(() => {
  // sidecar 的 worker entry 必须以真实文件路径喂给 new Worker()，不能被 bundle
  //（turbo 的 ^build 保证 dist 先于 desktop 构建存在）。
  const providerEntryPath = require.resolve(
    '@desksoul/sidecar/dist/workers/provider-worker-entry.js',
  );
  // 角色包根：dev 在仓库 apps/desktop/characters（out/main 的上两级）；
  // 打包后 electron-builder extraResources 落在 resources/characters。
  const charactersRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'characters')
    : path.join(__dirname, '../../characters');

  registerAssetProtocol(charactersRoot);
  wins = createAppWindows();
  router = registerIpcRouter({
    targets: rendererTargets(wins),
    characterWindow: () => (wins && !wins.character.isDestroyed() ? wins.character : null),
    charactersRoot,
    providerEntryPath,
    persistPath: path.join(app.getPath('userData'), 'sessions.json'),
  });
  cursorPublisher = startCursorPublisher({
    getCursor: () => screen.getCursorScreenPoint(),
    send: (p) => {
      const win = wins && !wins.character.isDestroyed() ? wins.character : null;
      win?.webContents.send('desksoul:notify:behavior.lookAt', p);
    },
  });

  // settings 常驻 hidden，不算"还开着"；两个可见窗口都关 = 退出。
  const maybeQuit = (): void => {
    if (wins && wins.character.isDestroyed() && wins.overlay.isDestroyed()) app.quit();
  };
  wins.character.on('closed', maybeQuit);
  wins.overlay.on('closed', maybeQuit);
});

app.on('before-quit', () => {
  cursorPublisher?.stop();
  cursorPublisher = null;
  void router?.dispose();
  router = null;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 3: typecheck + 全量测试回归 + 构建**

```bash
pnpm --filter @desksoul/desktop typecheck && pnpm --filter @desksoul/desktop exec vitest run && pnpm --filter @desksoul/desktop build
```

Expected: 全绿（既有 router/chat-service 等测试不破）、三路构建成功。

- [ ] **Step 4: dev 冒烟（手测，需本机显示）**

```bash
pnpm --filter @desksoul/desktop dev
```

Expected: 三窗口照常启动；character 窗口仍显示 VRM（此刻模型还走旧 `/models/sample.vrm` 路径，Task 17 才切 asset://）；Main 控制台无 asset/protocol 报错。Ctrl+C 退出。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/electron/main
git commit -m "feat(desktop): Main 接线 - asset 协议注册/character.* 路由/光标发布器生命周期"
```

---

### Task 10: Renderer — FpsMeter（30s 滚动平均）

**Files:**
- Create: `apps/desktop/src/renderer/character/fps-meter.ts`
- Test: `apps/desktop/test/fps-meter.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/test/fps-meter.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { FpsMeter, FPS_WINDOW_MS } from '../src/renderer/character/fps-meter';

/** 以恒定 fps 喂 meter 共 durationMs（时间戳从 t0 开始）。 */
function feed(meter: FpsMeter, fps: number, durationMs: number, t0 = 0): number {
  const step = 1000 / fps;
  let t = t0;
  for (; t < t0 + durationMs; t += step) meter.tick(t);
  return t;
}

describe('FpsMeter', () => {
  it('window constant is 30s', () => {
    expect(FPS_WINDOW_MS).toBe(30_000);
  });

  it('averages a steady 60fps stream to ~60', () => {
    const m = new FpsMeter();
    feed(m, 60, 10_000);
    expect(m.average()).toBeGreaterThan(55);
    expect(m.average()).toBeLessThan(65);
  });

  it('rolls off samples older than the window', () => {
    const m = new FpsMeter();
    const t1 = feed(m, 60, 10_000); // 0–10s @60
    feed(m, 20, 40_000, t1); // 10–50s @20：30s 窗口已完全滚出 60fps 段
    expect(m.average()).toBeGreaterThan(15);
    expect(m.average()).toBeLessThan(25);
  });

  it('returns 0 before any full second elapses', () => {
    const m = new FpsMeter();
    m.tick(0);
    m.tick(16);
    expect(m.average()).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试看红**

```bash
pnpm --filter @desksoul/desktop exec vitest run test/fps-meter.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

创建 `apps/desktop/src/renderer/character/fps-meter.ts`：

```ts
/**
 * FPS 监控（tech-design §7 性能预算）：每秒一桶计帧，30s 滚动平均。
 * 判据看滚动平均而非瞬时（S3 同口径）。纯逻辑、时间戳注入，可单测。
 */
export const FPS_WINDOW_MS = 30_000;

export class FpsMeter {
  /** [秒桶起点 ms, 帧数] 环形列表（最多 window/1000 + 1 项）。 */
  private buckets: Array<[number, number]> = [];

  tick(nowMs: number): void {
    const second = Math.floor(nowMs / 1000) * 1000;
    const lastEntry = this.buckets[this.buckets.length - 1];
    if (lastEntry && lastEntry[0] === second) {
      lastEntry[1] += 1;
    } else {
      this.buckets.push([second, 1]);
      const cutoff = second - FPS_WINDOW_MS;
      while (this.buckets.length > 0 && this.buckets[0]![0] <= cutoff) this.buckets.shift();
    }
  }

  /** 30s 窗口平均 FPS；不足 1 个完整秒桶时返回 0（当前进行中的桶不计）。 */
  average(): number {
    if (this.buckets.length <= 1) return 0;
    const complete = this.buckets.slice(0, -1); // 最后一桶未满一秒，丢弃
    const frames = complete.reduce((sum, [, n]) => sum + n, 0);
    return frames / complete.length;
  }
}
```

- [ ] **Step 4: 跑测试看绿**

```bash
pnpm --filter @desksoul/desktop exec vitest run test/fps-meter.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/character/fps-meter.ts apps/desktop/test/fps-meter.test.ts
git commit -m "feat(desktop): FpsMeter - 秒桶 30s 滚动平均"
```

---

### Task 11: Renderer — 程序化动作库 actions.ts

**Files:**
- Create: `apps/desktop/src/renderer/character/actions.ts`
- Test: `apps/desktop/test/actions.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/test/actions.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  ACTION_NAMES,
  ACTION_DEFAULT_MS,
  sampleAction,
  ZERO_OFFSETS,
  type BoneOffsets,
} from '../src/renderer/character/actions';

const KEYS = Object.keys(ZERO_OFFSETS) as Array<keyof BoneOffsets>;
const maxAbs = (o: BoneOffsets): number => Math.max(...KEYS.map((k) => Math.abs(o[k])));

describe('actions', () => {
  it('covers exactly the persona DEFAULT_ACTIONS vocabulary', () => {
    expect([...ACTION_NAMES].sort()).toEqual(
      ['fidget', 'jump', 'nod', 'shake', 'sigh', 'stretch', 'tilt', 'wave'].sort(),
    );
  });

  it('every action has a positive default duration', () => {
    for (const name of ACTION_NAMES) {
      expect(ACTION_DEFAULT_MS[name]).toBeGreaterThan(0);
    }
  });

  it.each([...ACTION_NAMES])('%s starts and ends at rest (blends with idle)', (name) => {
    expect(maxAbs(sampleAction(name, 0))).toBeLessThan(1e-9);
    expect(maxAbs(sampleAction(name, 1))).toBeLessThan(1e-9);
  });

  it.each([...ACTION_NAMES])('%s is visibly non-zero mid-way', (name) => {
    const peak = Math.max(
      maxAbs(sampleAction(name, 0.25)),
      maxAbs(sampleAction(name, 0.5)),
      maxAbs(sampleAction(name, 0.75)),
    );
    expect(peak).toBeGreaterThan(0.02);
  });

  it('clamps phase outside [0,1] to rest', () => {
    expect(maxAbs(sampleAction('nod', -0.5))).toBeLessThan(1e-9);
    expect(maxAbs(sampleAction('nod', 1.5))).toBeLessThan(1e-9);
  });

  it('unknown action name samples to rest (caller warns, renderer must not crash)', () => {
    expect(maxAbs(sampleAction('bogus', 0.5))).toBeLessThan(1e-9);
  });

  it('nod moves pitch, shake moves yaw, tilt moves roll (语义对得上)', () => {
    expect(Math.abs(sampleAction('nod', 0.25).headPitch)).toBeGreaterThan(0.02);
    expect(Math.abs(sampleAction('shake', 0.25).headYaw)).toBeGreaterThan(0.02);
    expect(Math.abs(sampleAction('tilt', 0.5).headRoll)).toBeGreaterThan(0.02);
    expect(Math.abs(sampleAction('jump', 0.5).hipsY)).toBeGreaterThan(0.01);
    expect(sampleAction('wave', 0.5).armRaiseR).toBeGreaterThan(0.3);
    expect(sampleAction('stretch', 0.5).armRaiseL).toBeGreaterThan(0.3);
  });
});
```

- [ ] **Step 2: 跑测试看红**

```bash
pnpm --filter @desksoul/desktop exec vitest run test/actions.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

创建 `apps/desktop/src/renderer/character/actions.ts`：

```ts
/**
 * 程序化动作库 —— M4 无 VRMA 动画资产，8 个动作（persona DEFAULT_ACTIONS 词表）
 * 全部用参数曲线合成：`sampleAction(name, phase)` 返回骨骼偏移（弧度 / 米）。
 *
 * 不变量：phase=0 与 phase=1 时全零（bump 包络保证）——动作从 idle 无缝起、
 * 无缝收，ActionPlayer 不需要额外的混入/混出逻辑。纯函数可单测。
 */
export interface BoneOffsets {
  /** hips 纵向位移（米，normalized rig）。 */
  hipsY: number;
  spinePitch: number;
  spineYaw: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  /** 手臂抬起量（弧度，叠加在自然下垂 rest pose 上；正值 = 抬起）。 */
  armRaiseL: number;
  armRaiseR: number;
}

export const ZERO_OFFSETS: BoneOffsets = {
  hipsY: 0,
  spinePitch: 0,
  spineYaw: 0,
  headPitch: 0,
  headYaw: 0,
  headRoll: 0,
  armRaiseL: 0,
  armRaiseR: 0,
};

export const ACTION_NAMES = [
  'wave',
  'nod',
  'shake',
  'fidget',
  'stretch',
  'sigh',
  'jump',
  'tilt',
] as const;
export type ActionName = (typeof ACTION_NAMES)[number];

export const ACTION_DEFAULT_MS: Record<ActionName, number> = {
  wave: 1800,
  nod: 900,
  shake: 1000,
  fidget: 2000,
  stretch: 2200,
  sigh: 1800,
  jump: 700,
  tilt: 1400,
};

/** 半正弦包络：两端 0、中点 1。 */
const bump = (t: number): number => Math.sin(Math.PI * t);
const TWO_PI = Math.PI * 2;

const CURVES: Record<ActionName, (t: number) => Partial<BoneOffsets>> = {
  // 点头两次：pitch 正弦 × 包络
  nod: (t) => ({ headPitch: 0.3 * Math.sin(TWO_PI * 2 * t) * bump(t) }),
  // 摇头两次半
  shake: (t) => ({ headYaw: 0.38 * Math.sin(TWO_PI * 2.5 * t) * bump(t) }),
  // 歪头保持
  tilt: (t) => ({ headRoll: 0.3 * bump(t), headYaw: 0.06 * bump(t) }),
  // 小跳：hips 上抬 + 手臂微张
  jump: (t) => ({ hipsY: 0.06 * bump(t), armRaiseL: 0.25 * bump(t), armRaiseR: 0.25 * bump(t) }),
  // 挥手：右臂抬起 + 前臂高频小摆（并在 raise 上做微调制）
  wave: (t) => ({ armRaiseR: bump(t) * (1.1 + 0.15 * Math.sin(TWO_PI * 3 * t)), headRoll: -0.08 * bump(t) }),
  // 伸懒腰：双臂高举 + 脊柱后仰 + 微踮
  stretch: (t) => ({
    armRaiseL: 1.3 * bump(t),
    armRaiseR: 1.3 * bump(t),
    spinePitch: -0.12 * bump(t),
    hipsY: 0.015 * bump(t),
  }),
  // 叹气：低头 + 含胸 + 身体下沉
  sigh: (t) => ({ headPitch: 0.2 * bump(t), spinePitch: 0.1 * bump(t), hipsY: -0.012 * bump(t) }),
  // 不安扭动：躯干小幅左右扭 + 头微摆
  fidget: (t) => ({
    spineYaw: 0.09 * Math.sin(TWO_PI * 2 * t) * bump(t),
    headYaw: 0.05 * Math.sin(TWO_PI * 2 * t + 0.7) * bump(t),
    hipsY: -0.004 * bump(t),
  }),
};

export function sampleAction(name: string, phase: number): BoneOffsets {
  const curve = (CURVES as Record<string, (t: number) => Partial<BoneOffsets>>)[name];
  if (!curve || phase <= 0 || phase >= 1) return { ...ZERO_OFFSETS };
  return { ...ZERO_OFFSETS, ...curve(phase) };
}
```

- [ ] **Step 4: 跑测试看绿**

```bash
pnpm --filter @desksoul/desktop exec vitest run test/actions.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/character/actions.ts apps/desktop/test/actions.test.ts
git commit -m "feat(desktop): 程序化动作库 - 8 动作参数曲线/端点归零不变量"
```

---

### Task 12: Renderer — LookAt 数学 lookat.ts

**Files:**
- Create: `apps/desktop/src/renderer/character/lookat.ts`
- Test: `apps/desktop/test/lookat.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/test/lookat.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  normalizedFromScreen,
  lookAtWorldTarget,
  damp,
} from '../src/renderer/character/lookat';

const WIN = { x: 1000, y: 500, width: 320, height: 480 };

describe('normalizedFromScreen', () => {
  it('window center maps to (0, 0)', () => {
    const n = normalizedFromScreen(1160, 740, WIN);
    expect(n.nx).toBeCloseTo(0);
    expect(n.ny).toBeCloseTo(0);
  });

  it('right edge → nx=1, top edge → ny=1 (向上为正)', () => {
    expect(normalizedFromScreen(1320, 740, WIN).nx).toBeCloseTo(1);
    expect(normalizedFromScreen(1160, 500, WIN).ny).toBeCloseTo(1);
    expect(normalizedFromScreen(1160, 980, WIN).ny).toBeCloseTo(-1);
  });

  it('clamps far-away cursor to ±2 (窗外仍可远望不发散)', () => {
    const n = normalizedFromScreen(9000, -9000, WIN);
    expect(n.nx).toBe(2);
    expect(n.ny).toBe(2);
  });
});

describe('lookAtWorldTarget', () => {
  const head = { x: 0, y: 1.35, z: 0 };

  it('centered gaze looks straight ahead of the head', () => {
    const t = lookAtWorldTarget(head, { nx: 0, ny: 0 });
    expect(t.x).toBeCloseTo(0);
    expect(t.y).toBeCloseTo(1.35);
    expect(t.z).toBeGreaterThan(0.5); // 目标在头前方（相机方向 +z，S3 相机位 z=2.2）
  });

  it('nx>0 (屏幕右) 把目标推向头部 -x（镜像：用户右 = 角色左）', () => {
    const t = lookAtWorldTarget(head, { nx: 1, ny: 0 });
    expect(t.x).toBeLessThan(0);
  });

  it('ny>0 (屏幕上) 抬高目标', () => {
    const t = lookAtWorldTarget(head, { nx: 0, ny: 1 });
    expect(t.y).toBeGreaterThan(1.35);
  });
});

describe('damp', () => {
  it('moves toward target, framerate-independently', () => {
    // 同样 100ms：一步到位 vs 10 步×10ms，结果应几乎一致（指数阻尼性质）
    const oneStep = damp(0, 1, 8, 0.1);
    let v = 0;
    for (let i = 0; i < 10; i++) v = damp(v, 1, 8, 0.01);
    expect(Math.abs(oneStep - v)).toBeLessThan(1e-6);
    expect(oneStep).toBeGreaterThan(0.5); // λ=8 时 100ms 应走过一半以上
    expect(oneStep).toBeLessThan(1);
  });

  it('already at target stays put', () => {
    expect(damp(0.7, 0.7, 8, 0.016)).toBeCloseTo(0.7);
  });
});
```

- [ ] **Step 2: 跑测试看红**

```bash
pnpm --filter @desksoul/desktop exec vitest run test/lookat.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

创建 `apps/desktop/src/renderer/character/lookat.ts`：

```ts
/**
 * LookAt 数学（tech-design §7「LookAt / 鼠标追踪」）—— 纯函数三件套：
 *   屏幕坐标 → 窗口归一化（clamp ±2，窗外仍可远望）
 *   归一化 → 头前方目标平面的世界坐标（three-vrm lookAt target 用）
 *   指数阻尼（帧率无关）做平滑插值，消除 30Hz 输入的抖动
 * Main 侧 30Hz 节流见 cursor-publisher.ts；这里只做渲染端那一半。
 */
export interface Normalized {
  nx: number;
  ny: number;
}

const NORM_CLAMP = 2;

export function normalizedFromScreen(
  screenX: number,
  screenY: number,
  win: { x: number; y: number; width: number; height: number },
): Normalized {
  const clamp = (v: number): number => Math.min(NORM_CLAMP, Math.max(-NORM_CLAMP, v));
  const nx = clamp((screenX - win.x - win.width / 2) / (win.width / 2));
  // 屏幕 y 向下增长；ny 取「向上为正」符合世界坐标直觉
  const ny = clamp(-(screenY - win.y - win.height / 2) / (win.height / 2));
  return { nx, ny };
}

/** 目标平面参数：头前方 1.4m，横向/纵向各 ±0.6m 摆幅（n=±1 时）。 */
const PLANE_DIST = 1.4;
const SPREAD_X = 0.6;
const SPREAD_Y = 0.45;

/**
 * 归一化注视点 → 世界坐标。相机在 +z 看向 -z（S3 布局：camera.position.z=2.2），
 * 角色面朝 +z；用户从屏幕看是镜像 —— 光标在屏幕右（nx>0），角色应看向自己的
 * 左侧（世界 -x）才显得"看着光标"。
 */
export function lookAtWorldTarget(
  head: { x: number; y: number; z: number },
  n: Normalized,
): { x: number; y: number; z: number } {
  return {
    x: head.x - n.nx * SPREAD_X,
    y: head.y + n.ny * SPREAD_Y,
    z: head.z + PLANE_DIST,
  };
}

/** 帧率无关的指数阻尼：lambda 越大跟随越紧（8 ≈ 100ms 走完 55%）。 */
export function damp(current: number, target: number, lambda: number, dtSec: number): number {
  return target + (current - target) * Math.exp(-lambda * dtSec);
}
```

- [ ] **Step 4: 跑测试看绿**

```bash
pnpm --filter @desksoul/desktop exec vitest run test/lookat.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/character/lookat.ts apps/desktop/test/lookat.test.ts
git commit -m "feat(desktop): LookAt 数学 - 屏幕归一化/世界目标/指数阻尼"
```

---

### Task 13: Renderer — Idle 池 idle-pool.ts

**Files:**
- Create: `apps/desktop/src/renderer/character/idle-pool.ts`
- Test: `apps/desktop/test/idle-pool.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/test/idle-pool.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import {
  IDLE_POOL,
  selectIdleVariants,
  planNextIdle,
  IDLE_GAP_MIN_MS,
  IDLE_GAP_MAX_MS,
} from '../src/renderer/character/idle-pool';

describe('IDLE_POOL', () => {
  it('every variant is low-amplitude and references a real action', () => {
    const actions = ['wave', 'nod', 'shake', 'fidget', 'stretch', 'sigh', 'jump', 'tilt'];
    for (const v of IDLE_POOL) {
      expect(actions).toContain(v.action);
      expect(v.scale).toBeGreaterThan(0);
      expect(v.scale).toBeLessThanOrEqual(0.7); // idle 变体必须低幅，不与显式动作混淆
      expect(v.durationMs).toBeGreaterThan(0);
    }
  });

  it('has unconstrained variants (任何 intent 下池子非空的保底)', () => {
    expect(IDLE_POOL.some((v) => !v.moods && !v.energies)).toBe(true);
  });
});

describe('selectIdleVariants', () => {
  it('neutral intent gets only unconstrained variants', () => {
    const subset = selectIdleVariants({ mood: 'neutral', energy: 'mid' });
    expect(subset.length).toBeGreaterThan(0);
    for (const v of subset) {
      if (v.moods) expect(v.moods).toContain('neutral');
      if (v.energies) expect(v.energies).toContain('mid');
    }
  });

  it('mood=shy adds the shy-fidget variant', () => {
    const ids = selectIdleVariants({ mood: 'shy', energy: 'low' }).map((v) => v.id);
    expect(ids).toContain('shy-fidget');
  });

  it('energy=high adds bounce, energy=low adds droop', () => {
    expect(selectIdleVariants({ mood: 'neutral', energy: 'high' }).map((v) => v.id)).toContain(
      'bounce',
    );
    expect(selectIdleVariants({ mood: 'neutral', energy: 'low' }).map((v) => v.id)).toContain(
      'droop',
    );
  });

  it('falls back to unconstrained set for unknown intent vocabulary', () => {
    const subset = selectIdleVariants({ mood: 'bogus', energy: 'bogus' });
    expect(subset.length).toBeGreaterThan(0);
    expect(subset.every((v) => !v.moods && !v.energies)).toBe(true);
  });
});

describe('planNextIdle', () => {
  it('schedules within [4s, 10s] and picks from the subset', () => {
    const subset = selectIdleVariants({ mood: 'neutral', energy: 'mid' });
    const lo = planNextIdle(1000, subset, () => 0);
    const hi = planNextIdle(1000, subset, () => 0.999999);
    expect(lo.at).toBe(1000 + IDLE_GAP_MIN_MS);
    expect(hi.at).toBeLessThanOrEqual(1000 + IDLE_GAP_MAX_MS);
    expect(subset.map((v) => v.id)).toContain(lo.variant.id);
    expect(subset.map((v) => v.id)).toContain(hi.variant.id);
  });
});
```

- [ ] **Step 2: 跑测试看红**

```bash
pnpm --filter @desksoul/desktop exec vitest run test/idle-pool.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

创建 `apps/desktop/src/renderer/character/idle-pool.ts`：

```ts
/**
 * Idle 动画池（tech-design §7「Idle 行为」）：变体 = 低幅复用程序化动作库，
 * 按当前 intent（mood/energy）过滤子集；空匹配回退「无约束」通用集，
 * 池子永不为空。调度是纯步进：planNextIdle 给出下次触发时刻 + 变体。
 * 基础层（眨眼 + 呼吸）不在池里 —— 那是 runtime 常驻行为。
 */
import type { ActionName } from './actions';

export interface IdleVariant {
  id: string;
  action: ActionName;
  /** 动作幅度缩放（≤0.7，与显式 playAction 区分）。 */
  scale: number;
  durationMs: number;
  /** 约束：声明则仅在命中的 mood / energy 下入选。 */
  moods?: readonly string[];
  energies?: readonly string[];
}

export const IDLE_POOL: readonly IdleVariant[] = [
  { id: 'sway', action: 'fidget', scale: 0.35, durationMs: 2600 },
  { id: 'glance', action: 'tilt', scale: 0.45, durationMs: 2000 },
  { id: 'micro-nod', action: 'nod', scale: 0.3, durationMs: 1400 },
  { id: 'bounce', action: 'jump', scale: 0.35, durationMs: 1100, energies: ['high'] },
  { id: 'droop', action: 'sigh', scale: 0.55, durationMs: 2600, energies: ['low'] },
  { id: 'shy-fidget', action: 'fidget', scale: 0.6, durationMs: 2000, moods: ['shy'] },
  { id: 'perk-up', action: 'tilt', scale: 0.6, durationMs: 1600, moods: ['happy', 'curious'] },
];

export interface IdleIntent {
  mood: string;
  energy: string;
}

export function selectIdleVariants(intent: IdleIntent): IdleVariant[] {
  const matched = IDLE_POOL.filter((v) => {
    const moodOk = !v.moods || v.moods.includes(intent.mood);
    const energyOk = !v.energies || v.energies.includes(intent.energy);
    return moodOk && energyOk;
  });
  if (matched.length > 0) return matched;
  return IDLE_POOL.filter((v) => !v.moods && !v.energies);
}

export const IDLE_GAP_MIN_MS = 4_000;
export const IDLE_GAP_MAX_MS = 10_000;

export function planNextIdle(
  nowMs: number,
  subset: readonly IdleVariant[],
  rand: () => number = Math.random,
): { at: number; variant: IdleVariant } {
  const at = nowMs + IDLE_GAP_MIN_MS + rand() * (IDLE_GAP_MAX_MS - IDLE_GAP_MIN_MS);
  const variant = subset[Math.floor(rand() * subset.length)] ?? subset[0]!;
  return { at, variant };
}
```

- [ ] **Step 4: 跑测试看绿**

```bash
pnpm --filter @desksoul/desktop exec vitest run test/idle-pool.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/character/idle-pool.ts apps/desktop/test/idle-pool.test.ts
git commit -m "feat(desktop): Idle 动画池 - intent 子集过滤/通用集保底/调度步进"
```

---

### Task 14: Renderer — 性能预算测量 perf-budget.ts

**Files:**
- Create: `apps/desktop/src/renderer/character/perf-budget.ts`
- Test: `apps/desktop/test/perf-budget.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/test/perf-budget.test.ts`（three 的几何/材质在 node 下可构造，texture.image 用 `{width,height}` 普通对象即可，不触 DOM）：

```ts
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
  measureSceneBudget,
  checkBudget,
  BUDGET_LIMITS,
} from '../src/renderer/character/perf-budget';

function meshWithTriangles(tris: number, texture?: THREE.Texture): THREE.Mesh {
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(tris * 9); // 3 顶点 × xyz，非索引几何
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.MeshBasicMaterial();
  if (texture) mat.map = texture;
  return new THREE.Mesh(geo, mat);
}

function fakeTexture(w: number, h: number): THREE.Texture {
  const t = new THREE.Texture();
  t.image = { width: w, height: h };
  return t;
}

describe('measureSceneBudget', () => {
  it('counts triangles across meshes (indexed and non-indexed)', () => {
    const scene = new THREE.Object3D();
    scene.add(meshWithTriangles(100));
    const indexed = meshWithTriangles(0);
    const geo = indexed.geometry;
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    geo.setIndex(Array.from({ length: 300 }, (_, i) => i % 3)); // 100 个三角面
    scene.add(indexed);
    expect(measureSceneBudget(scene).triangles).toBe(200);
  });

  it('sums unique textures only once (材质间共享纹理不重复计)', () => {
    const tex = fakeTexture(1024, 1024); // 4MB
    const scene = new THREE.Object3D();
    scene.add(meshWithTriangles(1, tex));
    scene.add(meshWithTriangles(1, tex));
    expect(measureSceneBudget(scene).textureBytes).toBe(1024 * 1024 * 4);
  });

  it('handles texture without image gracefully', () => {
    const scene = new THREE.Object3D();
    scene.add(meshWithTriangles(1, new THREE.Texture()));
    expect(measureSceneBudget(scene).textureBytes).toBe(0);
  });
});

describe('checkBudget', () => {
  it('limits match tech-design §7 (8万面 / 64MB)', () => {
    expect(BUDGET_LIMITS.maxTriangles).toBe(80_000);
    expect(BUDGET_LIMITS.maxTextureBytes).toBe(64 * 1024 * 1024);
  });

  it('flags overruns', () => {
    expect(checkBudget({ triangles: 80_001, textureBytes: 0 })).toEqual([
      expect.stringContaining('triangles'),
    ]);
    expect(checkBudget({ triangles: 0, textureBytes: 64 * 1024 * 1024 + 1 })).toEqual([
      expect.stringContaining('texture'),
    ]);
    expect(checkBudget({ triangles: 1000, textureBytes: 1000 })).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试看红**

```bash
pnpm --filter @desksoul/desktop exec vitest run test/perf-budget.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

创建 `apps/desktop/src/renderer/character/perf-budget.ts`：

```ts
/**
 * 性能预算（tech-design §7）：单角色 ≤8 万三角面、纹理总量 ≤64MB。
 * 加载完成后测一次：超标 console.warn（预算是告警线，不拒载——拒载的
 * 用户体验问题留给角色包商店审核，V1+）。
 */
import * as THREE from 'three';

export const BUDGET_LIMITS = {
  maxTriangles: 80_000,
  maxTextureBytes: 64 * 1024 * 1024,
} as const;

export interface SceneBudget {
  triangles: number;
  textureBytes: number;
}

export function measureSceneBudget(root: THREE.Object3D): SceneBudget {
  let triangles = 0;
  const textures = new Set<THREE.Texture>();

  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry;
    if (geo.index) triangles += geo.index.count / 3;
    else if (geo.attributes['position']) triangles += geo.attributes['position'].count / 3;

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      for (const value of Object.values(mat)) {
        if ((value as THREE.Texture)?.isTexture) textures.add(value as THREE.Texture);
      }
    }
  });

  let textureBytes = 0;
  for (const tex of textures) {
    const img = tex.image as { width?: number; height?: number } | undefined;
    if (img?.width && img?.height) textureBytes += img.width * img.height * 4; // RGBA8 估算
  }
  return { triangles, textureBytes };
}

/** 超标项的人类可读告警列表；空数组 = 预算内。 */
export function checkBudget(b: SceneBudget): string[] {
  const warnings: string[] = [];
  if (b.triangles > BUDGET_LIMITS.maxTriangles) {
    warnings.push(`triangles ${b.triangles} > budget ${BUDGET_LIMITS.maxTriangles}`);
  }
  if (b.textureBytes > BUDGET_LIMITS.maxTextureBytes) {
    warnings.push(
      `texture bytes ${b.textureBytes} > budget ${BUDGET_LIMITS.maxTextureBytes} (est. RGBA8)`,
    );
  }
  return warnings;
}
```

- [ ] **Step 4: 跑测试看绿**

```bash
pnpm --filter @desksoul/desktop exec vitest run test/perf-budget.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/character/perf-budget.ts apps/desktop/test/perf-budget.test.ts
git commit -m "feat(desktop): 性能预算测量 - 三角面/唯一纹理字节估算 + 超标告警"
```

---

### Task 15: Renderer — IdleWatch（90s 空闲监视）

**Files:**
- Create: `apps/desktop/src/renderer/character/idle-watch.ts`
- Test: `apps/desktop/test/idle-watch.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/test/idle-watch.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { IdleWatch, IDLE_TIMEOUT_MS } from '../src/renderer/character/idle-watch';

describe('IdleWatch', () => {
  it('default timeout is 90s (tech-design §7)', () => {
    expect(IDLE_TIMEOUT_MS).toBe(90_000);
  });

  it('fires once after timeoutMs of no activity', () => {
    const fired: number[] = [];
    const w = new IdleWatch(90_000, (idleMs) => fired.push(idleMs));
    w.activity(0);
    w.tick(89_999);
    expect(fired).toEqual([]);
    w.tick(90_000);
    expect(fired).toEqual([90_000]);
  });

  it('does not re-fire while still idle (单发，不连发)', () => {
    const fired: number[] = [];
    const w = new IdleWatch(90_000, (ms) => fired.push(ms));
    w.activity(0);
    w.tick(90_000);
    w.tick(180_000);
    w.tick(400_000);
    expect(fired).toEqual([90_000]);
  });

  it('re-arms after new activity', () => {
    const fired: number[] = [];
    const w = new IdleWatch(90_000, (ms) => fired.push(ms));
    w.activity(0);
    w.tick(90_000); // fire #1
    w.activity(100_000);
    w.tick(189_999);
    expect(fired).toHaveLength(1);
    w.tick(190_000); // fire #2
    expect(fired).toEqual([90_000, 90_000]);
  });

  it('activity before timeout postpones firing', () => {
    const fired: number[] = [];
    const w = new IdleWatch(90_000, (ms) => fired.push(ms));
    w.activity(0);
    w.tick(60_000);
    w.activity(60_000);
    w.tick(120_000);
    expect(fired).toEqual([]);
    w.tick(150_000);
    expect(fired).toEqual([90_000]);
  });

  it('does not fire before any activity is recorded (启动即静置不算)', () => {
    const fired: number[] = [];
    const w = new IdleWatch(90_000, (ms) => fired.push(ms));
    w.tick(500_000);
    expect(fired).toEqual([]);
  });
});
```

（「启动即静置不算」的语义：boot 时调一次 `activity(now)` 作为基线——见 Task 17 接线；Watch 本体在无基线时保持沉默，避免 app 启动 90s 后凭空触发。）

- [ ] **Step 2: 跑测试看红**

```bash
pnpm --filter @desksoul/desktop exec vitest run test/idle-watch.test.ts
```

Expected: FAIL（模块不存在）。

- [ ] **Step 3: 写实现**

创建 `apps/desktop/src/renderer/character/idle-watch.ts`：

```ts
/**
 * 90s 空闲监视（tech-design §7「主动行为」的渲染端半边）：
 * 活动源（behavior.*/chat.done 通知、窗口 pointerdown）调 activity()；
 * tick() 由低频定时器驱动（5s 粒度足够，不追求精确到帧）。
 * 触发后解除武装、等下次活动重武装 —— 不连发。时钟注入，纯逻辑可单测。
 */
export const IDLE_TIMEOUT_MS = 90_000;

export class IdleWatch {
  private lastActivity: number | null = null;
  private armed = false;

  constructor(
    private readonly timeoutMs: number,
    private readonly onIdle: (idleMs: number) => void,
  ) {}

  activity(nowMs: number): void {
    this.lastActivity = nowMs;
    this.armed = true;
  }

  tick(nowMs: number): void {
    if (!this.armed || this.lastActivity === null) return;
    const idleMs = nowMs - this.lastActivity;
    if (idleMs >= this.timeoutMs) {
      this.armed = false;
      this.onIdle(idleMs);
    }
  }
}
```

- [ ] **Step 4: 跑测试看绿**

```bash
pnpm --filter @desksoul/desktop exec vitest run test/idle-watch.test.ts
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/character/idle-watch.ts apps/desktop/test/idle-watch.test.ts
git commit -m "feat(desktop): IdleWatch - 90s 空闲单发监视/活动重武装"
```

---

### Task 16: Renderer — runtime.ts（CharacterRuntime 实现，吸收 vrm-stage）

**Files:**
- Create: `apps/desktop/src/renderer/character/runtime.ts`
- Delete: `apps/desktop/src/renderer/character/vrm-stage.ts`
- Modify: `apps/desktop/src/renderer/character/interaction.ts`（仅 import 类型来源不变，无需改——确认即可）

WebGL 路径无法 vitest（无 GPU/DOM），本任务以 typecheck 为门 + Task 17 接好后 e2e/手测验证。纯逻辑全部已在 Task 10–15 单测过，这里只做组装。

- [ ] **Step 1: 写 runtime.ts**

创建 `apps/desktop/src/renderer/character/runtime.ts`：

```ts
/**
 * CharacterRuntime —— tech-design §7 统一抽象的 VRM 引擎实现（S3 spike 形态的
 * 完整生产化，吸收并取代 vrm-stage.ts）。
 *
 * 职责（仍是"愚蠢播放器"）：
 *   - load：GLTFLoader + VRMLoaderPlugin、性能三件套、预算测量
 *   - applyEmotion：manifest 词表（缺省内置表）→ expression 权重组合，400ms 缓动
 *   - playAction：程序化动作库单活动作播放（新顶旧、完毕回 idle）
 *   - setLookAt：屏幕坐标 → 阻尼平滑 → vrm.lookAt target
 *   - setIdle：intent → idle 变体子集（眨眼/呼吸常驻）
 *   - setLipsync：V1+ stub（§7 接口完整性）
 * 业务状态（说什么/何时说）一概不持有。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import type { CharacterManifest } from '@desksoul/protocol';
import { sampleAction, ACTION_DEFAULT_MS, ZERO_OFFSETS, type BoneOffsets } from './actions';
import { normalizedFromScreen, lookAtWorldTarget, damp, type Normalized } from './lookat';
import { selectIdleVariants, planNextIdle, type IdleVariant } from './idle-pool';
import { measureSceneBudget, checkBudget, type SceneBudget } from './perf-budget';
import { FpsMeter } from './fps-meter';

const TRANSITION_MS = 400; // 350–500ms 平滑区间中值（S3 实测）

/** 内置情绪表：S3 的 8 个 + persona 词表的 curious/sleepy（D4 决策：消除模板漂移）。 */
export const BUILTIN_EMOTIONS: Record<string, Record<string, number>> = {
  happy: { happy: 1 },
  angry: { angry: 1 },
  sad: { sad: 1 },
  relaxed: { relaxed: 1 },
  surprised: { surprised: 1 },
  shy: { happy: 0.45, relaxed: 0.55 },
  thinking: { relaxed: 0.35, sad: 0.15 },
  confused: { sad: 0.4, surprised: 0.35 },
  curious: { surprised: 0.35, happy: 0.25 },
  sleepy: { relaxed: 0.85 },
};

/** 手臂自然下垂的 rest pose（VRM 默认 T-pose）；符号经手测校准（Task 17 Step 4）。 */
const ARM_REST_Z = 1.15;

export interface CharacterRuntime {
  /** interaction 的 readPixels 命中检测需要。 */
  readonly renderer: THREE.WebGLRenderer;
  applyEmotion(name: string, weight?: number): void;
  playAction(name: string, durMs?: number | null): void;
  /** 屏幕坐标（DIP；Main 的 behavior.lookAt 直传）。 */
  setLookAt(x: number, y: number): void;
  /** V1+ 语音嘴型；M4 stub。 */
  setLipsync(visemes: unknown | null): void;
  setIdle(intent: { mood: string; energy: string }): void;
  listEmotions(): string[];
  listActions(): string[];
  getStats(): { fps: number; budget: SceneBudget; budgetWarnings: string[] };
  dispose(): void;
}

export async function createVrmRuntime(
  container: HTMLElement,
  modelUrl: string,
  manifest: CharacterManifest,
): Promise<CharacterRuntime> {
  const width = container.clientWidth || 320;
  const height = container.clientHeight || 480;

  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true, // 事件回调里 readPixels 需保留 buffer（S1）
  });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 20);
  camera.position.set(0, 1.3, 2.2);
  camera.lookAt(0, 1.2, 0);

  const light = new THREE.DirectionalLight(0xffffff, Math.PI);
  light.position.set(1, 1, 1).normalize();
  scene.add(light);
  scene.add(new THREE.AmbientLight(0xffffff, 0.4 * Math.PI));

  // ---- load：VRM + 性能三件套（S3 实证 ≥30 FPS 的前提）----
  const vrm = await new Promise<VRM>((resolve, reject) => {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    loader.load(
      modelUrl,
      (gltf) => {
        const v = gltf.userData.vrm as VRM | undefined;
        if (!v) {
          reject(new Error('file loaded but contains no VRM'));
          return;
        }
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.combineSkeletons(gltf.scene);
        VRMUtils.combineMorphs(v);
        v.scene.traverse((obj) => {
          obj.frustumCulled = false;
        });
        resolve(v);
      },
      undefined,
      (err) => reject(err instanceof Error ? err : new Error(String(err))),
    );
  });
  scene.add(vrm.scene);

  // ---- 性能预算：加载即测，超标告警（D10）----
  const budget = measureSceneBudget(vrm.scene);
  const budgetWarnings = checkBudget(budget);
  for (const w of budgetWarnings) console.warn(`[runtime] budget: ${w}`);

  // ---- 情绪：manifest 词表优先，缺省内置表（D4）----
  const emotions: Record<string, Record<string, number>> = manifest.emotions ?? BUILTIN_EMOTIONS;
  const allExpressionNames = [...new Set(Object.values(emotions).flatMap((m) => Object.keys(m)))];
  let fromWeights: Record<string, number> = {};
  let toWeights: Record<string, number> = {};
  let transitionStart = 0;

  const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

  function applyEmotion(name: string, weight = 1): void {
    const em = vrm.expressionManager;
    if (!em) return;
    const snapshot: Record<string, number> = {};
    for (const n of allExpressionNames) snapshot[n] = em.getValue(n) ?? 0;
    fromWeights = snapshot;
    const target: Record<string, number> = {};
    for (const n of allExpressionNames) target[n] = 0;
    for (const [n, w] of Object.entries(emotions[name] ?? {})) target[n] = w * weight;
    toWeights = target;
    transitionStart = performance.now();
  }

  function updateTransition(): void {
    const em = vrm.expressionManager;
    if (!em) return;
    const t = Math.min((performance.now() - transitionStart) / TRANSITION_MS, 1);
    const k = easeInOut(t);
    for (const n of allExpressionNames) {
      const from = fromWeights[n] ?? 0;
      const to = toWeights[n] ?? 0;
      em.setValue(n, from + (to - from) * k);
    }
  }

  // ---- 动作：单活动作播放器（D6）----
  const actionVocab = manifest.actions ?? Object.keys(ACTION_DEFAULT_MS);
  let activeAction: { name: string; start: number; durMs: number; scale: number } | null = null;

  function playActionScaled(name: string, durMs: number | null | undefined, scale: number): void {
    if (!actionVocab.includes(name)) {
      console.warn(`[runtime] unknown action "${name}" (vocab: ${actionVocab.join(',')})`);
      return;
    }
    const fallback = (ACTION_DEFAULT_MS as Record<string, number>)[name] ?? 1500;
    activeAction = { name, start: performance.now(), durMs: durMs ?? fallback, scale };
  }

  function currentOffsets(now: number): BoneOffsets {
    if (!activeAction) return ZERO_OFFSETS;
    const phase = (now - activeAction.start) / activeAction.durMs;
    if (phase >= 1) {
      activeAction = null;
      return ZERO_OFFSETS;
    }
    const raw = sampleAction(activeAction.name, phase);
    if (activeAction.scale === 1) return raw;
    const scaled = { ...raw };
    for (const k of Object.keys(scaled) as Array<keyof BoneOffsets>) {
      scaled[k] = raw[k] * activeAction.scale;
    }
    return scaled;
  }

  // ---- 骨骼应用：rest pose + 动作偏移（每帧覆写，幂等）----
  const bone = (name: Parameters<NonNullable<VRM['humanoid']>['getNormalizedBoneNode']>[0]) =>
    vrm.humanoid?.getNormalizedBoneNode(name) ?? null;
  const hips = bone('hips');
  const spine = bone('spine');
  const chest = bone('chest');
  const head = bone('head');
  const upperArmL = bone('leftUpperArm');
  const upperArmR = bone('rightUpperArm');
  const hipsRestY = hips?.position.y ?? 0;

  function applyPose(now: number, offsets: BoneOffsets): void {
    if (upperArmL) upperArmL.rotation.z = ARM_REST_Z - offsets.armRaiseL;
    if (upperArmR) upperArmR.rotation.z = -(ARM_REST_Z - offsets.armRaiseR);
    if (head) {
      head.rotation.x = offsets.headPitch;
      head.rotation.y = offsets.headYaw;
      head.rotation.z = offsets.headRoll;
    }
    if (spine) {
      spine.rotation.x = offsets.spinePitch;
      spine.rotation.y = offsets.spineYaw;
    }
    if (hips) hips.position.y = hipsRestY + offsets.hipsY;
    if (chest) chest.rotation.x = Math.sin(now / 1000) * 0.02; // 呼吸常驻（S3）
  }

  // ---- idle：眨眼常驻 + 变体池调度（D7）----
  let nextBlinkAt = performance.now() + 1500;
  let blinkPhase = -1;

  function updateBlink(now: number, delta: number): void {
    const em = vrm.expressionManager;
    if (!em) return;
    if (blinkPhase < 0 && now >= nextBlinkAt) blinkPhase = 0;
    if (blinkPhase >= 0) {
      blinkPhase += delta / 0.12;
      const v = blinkPhase < 1 ? blinkPhase : 2 - blinkPhase;
      em.setValue('blink', Math.max(0, Math.min(1, v)));
      if (blinkPhase >= 2) {
        blinkPhase = -1;
        em.setValue('blink', 0);
        nextBlinkAt = now + 2000 + Math.random() * 4000;
      }
    }
  }

  let idleSubset: IdleVariant[] = selectIdleVariants({ mood: 'neutral', energy: 'mid' });
  let nextIdle = planNextIdle(performance.now(), idleSubset);

  function updateIdleVariants(now: number): void {
    if (now < nextIdle.at) return;
    if (!activeAction) {
      const v = nextIdle.variant;
      playActionScaled(v.action, v.durationMs, v.scale);
    }
    nextIdle = planNextIdle(now, idleSubset); // 被显式动作占用时顺延到下个窗口
  }

  // ---- LookAt：阻尼平滑 + vrm.lookAt target（D5）----
  const lookAtTarget = new THREE.Object3D();
  scene.add(lookAtTarget);
  if (vrm.lookAt) vrm.lookAt.target = lookAtTarget;
  let rawN: Normalized = { nx: 0, ny: 0 };
  const smoothN: Normalized = { nx: 0, ny: 0 };
  const headWorld = new THREE.Vector3(0, 1.35, 0);
  head?.getWorldPosition(headWorld);

  function setLookAt(x: number, y: number): void {
    rawN = normalizedFromScreen(x, y, {
      x: window.screenX,
      y: window.screenY,
      width: window.innerWidth,
      height: window.innerHeight,
    });
  }

  function updateLookAt(dt: number): void {
    smoothN.nx = damp(smoothN.nx, rawN.nx, 8, dt);
    smoothN.ny = damp(smoothN.ny, rawN.ny, 8, dt);
    const t = lookAtWorldTarget(headWorld, smoothN);
    lookAtTarget.position.set(t.x, t.y, t.z);
  }

  // ---- 窗口缩放自适应（D9）----
  const resizeObserver = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });
  resizeObserver.observe(container);

  // ---- 渲染循环 ----
  const fps = new FpsMeter();
  const clock = new THREE.Clock();
  let raf = 0;
  let disposed = false;

  function loop(): void {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    const delta = clock.getDelta();
    const now = performance.now();
    fps.tick(now);
    updateBlink(now, delta);
    updateIdleVariants(now);
    updateTransition();
    updateLookAt(delta);
    applyPose(now, currentOffsets(now));
    vrm.update(delta);
    renderer.render(scene, camera);
  }
  loop();

  return {
    renderer,
    applyEmotion,
    playAction(name, durMs) {
      playActionScaled(name, durMs ?? null, 1);
    },
    setLookAt,
    setLipsync(_visemes) {
      // V1+ 语音嘴型（tech-design §7 接口占位）；M4 显式 no-op
    },
    setIdle(intent) {
      idleSubset = selectIdleVariants(intent);
      nextIdle = planNextIdle(performance.now(), idleSubset);
    },
    listEmotions: () => Object.keys(emotions),
    listActions: () => [...actionVocab],
    getStats: () => ({ fps: fps.average(), budget, budgetWarnings }),
    dispose(): void {
      disposed = true;
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      VRMUtils.deepDispose(vrm.scene);
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
```

- [ ] **Step 2: 删除 vrm-stage.ts**

```bash
git rm apps/desktop/src/renderer/character/vrm-stage.ts
```

（main.ts 此刻还 import 它——Task 17 一起改；本任务结束时 typecheck 会暂时红，所以 Step 3 只跑单测，typecheck 门挪到 Task 17。若希望每步全绿，可把本任务 Step 2 推迟到 Task 17 Step 1 执行——执行者二选一，提交粒度不变。）

- [ ] **Step 3: 跑既有单测（不含 typecheck）**

```bash
pnpm --filter @desksoul/desktop exec vitest run
```

Expected: 全过（runtime.ts 不在任何测试的 import 链上）。

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/renderer/character/runtime.ts
git commit -m "feat(desktop): CharacterRuntime - VRM 引擎全接口实现(load/dispose/emotion/action/lookat/idle/budget)"
```

---

### Task 17: Renderer — main.ts 重接 + index.html CSP

**Files:**
- Modify: `apps/desktop/src/renderer/character/main.ts`
- Modify: `apps/desktop/src/renderer/character/index.html`

- [ ] **Step 1: 重写 main.ts**

`apps/desktop/src/renderer/character/main.ts` 全量更新为：

```ts
// Character renderer — "愚蠢的播放器"：只订阅 behavior.* 并反映之，无业务状态。
// M4：模型经 character.current → asset://（不再走 vite public 路径）；
// VRM 不可用（manifest 失败/模型缺失/加载失败）→ DOM 情绪脸，行为契约不变。
import { createVrmRuntime, type CharacterRuntime } from './runtime';
import { mountFallbackFace, type FallbackFace } from './fallback-face';
import { setupInteraction } from './interaction';
import { IdleWatch, IDLE_TIMEOUT_MS } from './idle-watch';

const FPS_REPORT_MS = 10_000;
const IDLE_TICK_MS = 5_000;

declare global {
  interface Window {
    /** debug 表面（e2e / 手测用），不属于 desksoul 协议。 */
    __charDebug?: {
      mode: 'vrm' | 'fallback';
      fps: () => number;
      budget: () => unknown;
      lastLookAt: { x: number; y: number } | null;
      idleFired: number;
    };
  }
}

async function bootRuntime(stageEl: HTMLElement): Promise<CharacterRuntime> {
  const cur = await window.desksoul.rpc('character.current', {});
  const modelUrl = `asset://${cur.characterId}/${cur.manifest.model}`;
  return createVrmRuntime(stageEl, modelUrl, cur.manifest);
}

async function boot(): Promise<void> {
  const stageEl = document.getElementById('stage')!;
  const fallbackEl = document.getElementById('fallback')!;

  let runtime: CharacterRuntime | null = null;
  let face: FallbackFace | null = null;
  try {
    runtime = await bootRuntime(stageEl);
    setupInteraction(runtime.renderer);
  } catch (e) {
    console.warn('[character] VRM unavailable, using fallback face:', e);
    fallbackEl.style.display = 'flex';
    face = mountFallbackFace(fallbackEl);
    setupInteraction(null); // DOM 无 alpha buffer：只拖拽，不穿透
  }

  const debug: NonNullable<Window['__charDebug']> = {
    mode: runtime ? 'vrm' : 'fallback',
    fps: () => runtime?.getStats().fps ?? 0,
    budget: () => runtime?.getStats() ?? null,
    lastLookAt: null,
    idleFired: 0,
  };
  window.__charDebug = debug;

  // ---- 90s 主动行为（D8）：通知/指针活动重置，超时上报 Main ----
  const idleWatch = new IdleWatch(IDLE_TIMEOUT_MS, (idleMs) => {
    debug.idleFired += 1;
    void window.desksoul.rpc('character.idleTimeout', { idleMs: Math.round(idleMs) });
  });
  const markActivity = (): void => idleWatch.activity(performance.now());
  markActivity(); // 启动基线：开机静置 90s 也算一次完整空闲期
  window.addEventListener('pointerdown', markActivity);
  setInterval(() => idleWatch.tick(performance.now()), IDLE_TICK_MS);

  // ---- behavior.* 订阅（M1 契约不变，M4 全部接到 runtime）----
  window.desksoul.on('behavior.applyEmotion', ({ name, weight }) => {
    markActivity();
    if (runtime) runtime.applyEmotion(name, weight);
    else face?.apply(name);
  });

  window.desksoul.on('behavior.playAction', ({ name, durationMs }) => {
    markActivity();
    if (runtime) runtime.playAction(name, durationMs);
    else face?.setAction(name, durationMs);
  });

  window.desksoul.on('behavior.setIntent', ({ mood, energy }) => {
    markActivity();
    if (runtime) runtime.setIdle({ mood, energy });
    else face?.setIntent(mood, energy);
  });

  window.desksoul.on('behavior.lookAt', ({ x, y }) => {
    debug.lastLookAt = { x, y };
    runtime?.setLookAt(x, y); // 不算 activity：光标常动，算了 90s 永不触发
  });

  // 回合结束 1.2s 后复位 neutral（S4 行为；neutral 不在情绪表 → 全零权重 = 复位）
  window.desksoul.on('chat.done', () => {
    markActivity();
    setTimeout(() => {
      if (runtime) runtime.applyEmotion('neutral', 0);
      else face?.reset();
    }, 1200);
  });

  // ---- FPS 周期上报（D10）：console 口径，HUD 是 M7/M8 的事 ----
  if (runtime) {
    setInterval(() => {
      const { fps } = runtime!.getStats();
      if (fps === 0) return; // 窗口未满一秒
      if (fps < 30) console.warn(`[character] FPS(30s avg) ${fps.toFixed(1)} < 30`);
      else console.info(`[character] FPS(30s avg) ${fps.toFixed(1)}`);
    }, FPS_REPORT_MS);
  }
}

void boot();
export {};
```

- [ ] **Step 2: index.html 加 CSP（D11）**

`apps/desktop/src/renderer/character/index.html` 的 `<head>` 内、`<meta charset>` 之后插入：

```html
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self' asset:; img-src 'self' asset: data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' asset: ws: http://localhost:*"
    />
```

- [ ] **Step 3: typecheck + 全量单测 + 构建**

```bash
pnpm --filter @desksoul/desktop typecheck && pnpm --filter @desksoul/desktop exec vitest run && pnpm --filter @desksoul/desktop build
```

Expected: 全绿（vrm-stage 引用已全部消失）、三路构建成功。

- [ ] **Step 4: dev 手测 + 手臂符号校准（需本机显示 + 模型已就位）**

```bash
pnpm --filter @desksoul/desktop dev
```

检查清单：
1. 角色经 asset:// 正常出现（DevTools Network 应见 `asset://default/model.vrm`，状态 200）。
2. **手臂自然下垂**——若双臂朝天/穿模，调 `runtime.ts` 的 `ARM_REST_Z` 符号或数值（VRM normalized rig 约定：left z+ 放下、right z- 放下；若相反则交换正负），改完热重载肉眼确认。
3. 光标在窗口附近移动，角色视线平滑跟随（无抖动、≈100ms 跟随感）；光标移到屏幕远处，视线斜向远望不发散。
4. DevTools console 跑 `window.__charDebug.fps()` ≥ 30（等 30s 让窗口填满）。
5. 聊天发一句话（overlay）→ 表情/动作随文本流变化（M1 行为不退化）。
6. console 每 10s 出 FPS info；无 budget 告警（sample.vrm 应在预算内）。

如手臂符号有改动：

```bash
git add apps/desktop/src/renderer/character/runtime.ts
git commit -m "fix(desktop): VRM 手臂 rest pose 符号手测校准"
```

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/character/main.ts apps/desktop/src/renderer/character/index.html
git commit -m "feat(desktop): character renderer 重接 - asset:// 模型/lookAt/90s 空闲/FPS 上报 + CSP"
```

---

### Task 18: e2e-smoke 扩展（M4 段）

**Files:**
- Modify: `apps/desktop/test/e2e-smoke.mjs`

CI 无 VRM 模型 → character 走 fallback 脸，但 **manifest 在 git、asset 协议与 RPC 通路与渲染形态无关**，全部可自动验证。

- [ ] **Step 1: 在现有 M2 断言之后追加 M4 段**

打开 `apps/desktop/test/e2e-smoke.mjs`，找到最后一个验收段（M2 快照重建断言）与最终 PASS 输出之间，插入：

```js
  // ---- M4-1: character.current 经路由返回校验过的 manifest ----
  const cur = await character.webContents.executeJavaScript(
    `window.desksoul.rpc('character.current', {})`,
  );
  if (cur?.characterId !== 'default') return fail(`character.current id: ${cur?.characterId}`);
  if (cur?.manifest?.model !== 'model.vrm') return fail('manifest.model mismatch');
  if (!Array.isArray(cur?.manifest?.actions) || cur.manifest.actions.length !== 8) {
    return fail('manifest.actions should list 8 actions');
  }

  // ---- M4-2: asset:// 协议越级不可达、合法路径可达（fetch 从 character 窗口发起）----
  const assetProbe = await character.webContents.executeJavaScript(`(async () => {
    const out = {};
    try { out.evil = (await fetch('asset://default/%2e%2e/default/manifest.json')).status; }
    catch (e) { out.evil = 'blocked:' + String(e).slice(0, 40); }
    try { out.legit = (await fetch('asset://default/manifest.json')).status; }
    catch (e) { out.legit = 'blocked:' + String(e).slice(0, 40); }
    return out;
  })()`);
  // 越级：URL 层可能规范化吞掉 ..、协议层必须 404 —— 唯独不能 200 读到内容
  if (assetProbe.evil === 200) return fail('asset traversal must not succeed');
  if (assetProbe.legit !== 200) return fail(`asset legit fetch: ${assetProbe.legit}`);

  // ---- M4-3: behavior.lookAt 推到 character（cursor publisher 首拍必发）----
  const lookAt = await waitFor(
    () => character.webContents.executeJavaScript(`window.__charDebug?.lastLookAt ?? null`),
    'behavior.lookAt delivery',
  );
  if (typeof lookAt.x !== 'number' || typeof lookAt.y !== 'number') {
    return fail(`lookAt payload: ${JSON.stringify(lookAt)}`);
  }

  // ---- M4-4: character.setScale 底边中点锚定改 bounds（50% / 200% / 复原）----
  const before = character.getBounds();
  await overlay.webContents.executeJavaScript(
    `window.desksoul.rpc('character.setScale', { scale: 0.5 })`,
  );
  const half = character.getBounds();
  if (half.width !== 160 || half.height !== 240) {
    return fail(`setScale 0.5 bounds: ${half.width}x${half.height}`);
  }
  if (Math.abs(half.x + half.width / 2 - (before.x + before.width / 2)) > 1) {
    return fail('setScale must keep bottom-center x');
  }
  if (Math.abs(half.y + half.height - (before.y + before.height)) > 1) {
    return fail('setScale must keep bottom y');
  }
  await overlay.webContents.executeJavaScript(
    `window.desksoul.rpc('character.setScale', { scale: 2 })`,
  );
  const dbl = character.getBounds();
  if (dbl.width !== 640 || dbl.height !== 960) {
    return fail(`setScale 2 bounds: ${dbl.width}x${dbl.height}`);
  }
  await overlay.webContents.executeJavaScript(
    `window.desksoul.rpc('character.setScale', { scale: 1 })`,
  );

  // ---- M4-5: character.idleTimeout → Main 决策 stub 发回 playAction ----
  await character.webContents.executeJavaScript(`(() => {
    window.__m4ActionSeen = null;
    window.desksoul.on('behavior.playAction', (p) => { window.__m4ActionSeen = p; });
    return window.desksoul.rpc('character.idleTimeout', { idleMs: 90000 });
  })()`);
  const idleAction = await waitFor(
    () => character.webContents.executeJavaScript(`window.__m4ActionSeen`),
    'idle responder playAction',
  );
  if (!['stretch', 'sigh', 'tilt'].includes(idleAction?.name)) {
    return fail(`idle action name: ${idleAction?.name}`);
  }
```

同时：文件头注释追加一行 `// M4 追加：character.current / asset:// 越级 404 / lookAt 直发 / setScale 锚定 / idleTimeout 决策回路。`；最终 PASS 日志文案改为含 M4（按现有文案微调，保持原结构）。

- [ ] **Step 2: 构建 + 跑 e2e（两种渲染形态）**

```bash
pnpm build && pnpm --filter @desksoul/desktop exec electron test/e2e-smoke.mjs
```

Expected: 退出码 0、输出 PASS（本地有模型 → VRM 形态）。再删模型验证 fallback 形态（M4 断言不依赖渲染形态）：

```bash
mv apps/desktop/characters/default/model.vrm /tmp/model.vrm.bak
pnpm --filter @desksoul/desktop exec electron test/e2e-smoke.mjs
mv /tmp/model.vrm.bak apps/desktop/characters/default/model.vrm
```

Expected: 两种形态都 PASS。

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/test/e2e-smoke.mjs
git commit -m "test(desktop): e2e 冒烟扩展 M4 - manifest/asset 越级/lookAt/setScale/idle 回路"
```

---

### Task 19: 全门禁 + 验收记录 + 合并打 tag

**Files:**
- Create: `apps/desktop/RESULTS-M4.md`
- Modify: `CLAUDE.md`（项目状态行）

- [ ] **Step 1: 全仓门禁**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm exec turbo run build --filter=@desksoul/desktop
```

Expected: 全绿。

- [ ] **Step 2: D4 缩放 50–200% FPS 手测（验收硬项，需显示 + 模型）**

```bash
pnpm --filter @desksoul/desktop dev
```

在 overlay 窗口 DevTools 依次执行，每档等 ≥30s 后读 character 窗口的 `window.__charDebug.fps()`：

```js
await window.desksoul.rpc('character.setScale', { scale: 0.5 });  // fps ≥ 30?
await window.desksoul.rpc('character.setScale', { scale: 1 });    // fps ≥ 30?
await window.desksoul.rpc('character.setScale', { scale: 2 });    // fps ≥ 30?
```

同时手测：8 情绪按通道切换流畅（overlay 发含 `<emo:.../>` 的对话或 console 直发）、动作可见、光标追踪平滑、静置 90s 角色自己做小动作（`idleFired` 增加）。

**若 200% 档 FPS < 30**：把 `runtime.ts` 的 `renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))` 上限降为 `1.5` 重测；仍不行降 `1`（640×960 CSS px @dpr1.5 ≈ 1.4M 像素，集显应稳）。调整后补提交 `fix(desktop): 200% 缩放下调 pixelRatio 上限保 30FPS`。

- [ ] **Step 3: 写 RESULTS-M4.md**

创建 `apps/desktop/RESULTS-M4.md`，按 RESULTS-M3 体例写验收映射。必含：

```markdown
# M4 渲染层 CharacterRuntime — RESULTS

**状态:** ✅/❌（按实测填）
**日期:** <执行日>
**平台:** Windows 11

## 验收映射（impl-plan M4）

| 验收项 | 口径 | 结果 |
| --- | --- | --- |
| D4 缩放 50–200% 不掉帧（≥30 FPS） | 手测 __charDebug.fps()，三档各 30s | |
| 8 种基础 emotion 切换流畅 | 手测（manifest 8 情绪经 chat 通道驱动） | |
| 内置 1 个角色包能完整加载 | 手测 asset://default/model.vrm 200 + 渲染出角色 | |
| 资产越级 404 / manifest 校验 | 自动（asset-protocol/character-service 单测 + e2e M4-2） | |
| LookAt 30Hz 节流 + 平滑插值 | 自动（cursor-publisher/lookat 单测 + e2e M4-3）+ 手测跟随 | |
| Idle 池 + intent 子集 + 90s 主动行为 | 自动（idle-pool/idle-watch/idle-responder 单测 + e2e M4-5）+ 手测 | |
| 性能预算监控 | 自动（perf-budget/fps-meter 单测）+ 手测 console 口径 | |

## 已知限制（按设计延后）
- setLipsync stub（V1+）；behavior.actionDone 未上（无消费者）；Live2D 引擎 V1+。
- LookAt 开关/强度、D4 设置 UI → M7；主动行为「说话」决策 → M6+。
- 打包态 extraResources 实测 → M9。
```

- [ ] **Step 4: 更新 CLAUDE.md 状态行**

`CLAUDE.md` 项目概览段：把「M3（行为协议生产化…）已完成，下一个里程碑是 M4（渲染层 CharacterRuntime）」更新为 M4 已完成（CharacterRuntime 全接口 + asset:// 资产安全 + LookAt/Idle/缩放/性能预算），下一个里程碑是 M5（Provider 插件运行时 + OpenAI 兼容 + Ollama）。

- [ ] **Step 5: 提交 + 合并 + tag**

```bash
git add apps/desktop/RESULTS-M4.md CLAUDE.md
git commit -m "docs: M4 验收结果 + 项目状态行更新"
git checkout main && git merge --no-ff feat/m4-character-runtime -m "Merge feat/m4-character-runtime: M4 渲染层 CharacterRuntime - 全接口/asset 安全加载/LookAt/Idle 池/90s 主动行为/缩放/性能预算"
git tag mvp/M4-done
```

（push 受网络约束：本机直连 GitHub 不通，由用户自行 push 或走镜像。）

---

## Self-Review 结论

- **规格覆盖**：impl-plan M4 五条范围 → Task 16（接口全方法 + listEmotions/listActions）、Task 3+5（资产安全 + asset://）、Task 7+12（LookAt 30Hz + 平滑）、Task 13+15+8（Idle 池/intent 子集/90s 事件）、Task 10+14（FPS + 预算）；验收三条 → Task 19 Step 2（缩放 FPS）、Task 17 Step 4（8 情绪）、Task 5+17（角色包加载）。tech-design §7 的 CSP → Task 17 Step 2；「渲染窗口=愚蠢播放器」不变量贯穿 Task 16/17。
- **类型一致性已校**：`CharacterManifest`（Task 1）↔ methods result（Task 2）↔ character-service（Task 4）↔ runtime 参数（Task 16）；`BoneOffsets`/`ACTION_DEFAULT_MS`（Task 11）↔ runtime ActionPlayer（Task 16）；`IdleVariant`（Task 13）↔ runtime idle 调度（Task 16）；`scaledBounds`（Task 6）↔ ipc-router（Task 9）↔ e2e 断言（Task 18）。
- **已知风险点已内置应对**：electron 模块进 vitest（Task 3 Step 4 备选方案）、VRM 手臂符号（Task 17 Step 4 校准步）、200% FPS（Task 19 Step 2 降 pixelRatio 预案）、asset URL 规范化吞 `..`（Task 18 M4-2 断言写成「不能 200」而非「必须 404」）。

