// M1 端到端冒烟（自动化）：加载真实构建产物启动完整 app（三窗口 + router + worker），
// 然后驱动 impl-plan M1 的验收链路：
//   overlay 发 chat.send → Main 路由 → mock provider worker → ConversationCore 双轨
//   → broadcast → overlay 收 chat.stream/chat.done、character 收 behavior.applyEmotion
// 退出码 0 = 验收通过。M8 会升级为 Playwright with Electron 跑 packaged app。
//
// M2 追加：cancel 全链路（瞬停 + done(cancel)）、chat.stream 带 seq、
// overlay 崩溃自愈后经 chat.snapshot 自动重建会话视图。
//
// M4 追加：character.current manifest / asset:// 越级不可达 / behavior.lookAt 直发 /
// setScale 底边锚定 / idleTimeout 主动行为决策回路。
//
// 运行：pnpm --filter @desksoul/desktop exec electron test/e2e-smoke.mjs
//（先 pnpm build；file:// 模式下 VRM 模型不可达 → character 走 fallback 脸，
//  与判据无关：判据是 behavior.* 通道驱动 renderer，不是渲染形态。）
import { app, BrowserWindow } from 'electron';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
// 启动真实 app：必须静态 import —— registerSchemesAsPrivileged（asset://）只能在
// app ready 前调用；动态 import 会输给 ready 事件（M4 实证）。静态导入在模块图
// 求值阶段执行，与生产主入口同时序。
import '../out/main/index.js';

// M5：生产默认 provider 为真实 openai。e2e 冒烟无网络/无 key，强制走 mock provider
// 路径（worker-entry: providerId==='mock' → 脚本回复），与 M1 验收链路一致。
// index.js 的 whenReady 回调在 ready 之后才读此 env；模块求值期设置即可（先于 ready）。
process.env.DESKSOUL_DEFAULT_PROVIDER = 'mock';

const TIMEOUT_MS = 20_000;

function fail(msg) {
  console.error(`[smoke] FAIL: ${msg}`);
  app.exit(1);
}

function findWindow(name) {
  return (
    BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(`/${name}/`)) ?? null
  );
}

async function waitFor(probe, what, timeoutMs = TIMEOUT_MS) {
  const start = Date.now();
  for (;;) {
    // crash 边缘的 executeJavaScript 可能永不 settle：每次探测都加 race，
    // 否则 waitFor 的超时检查永远轮不到。
    const v = await Promise.race([
      Promise.resolve()
        .then(probe)
        .catch(() => null),
      new Promise((r) => setTimeout(() => r(null), 800)),
    ]);
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function main() {
  // e2e 幂等：清掉上次运行持久化的会话历史。否则 App.vue 启动即重建旧的
  // '热可可' 回复，M2-2 的等待条件被旧 DOM 提前满足，快照会拍在流式中途。
  // （main() 在模块求值期同步调用，rmSync 必然先于 ready 回调里的 SessionStore 读盘。）
  rmSync(join(app.getPath('userData'), 'sessions.json'), { force: true });

  await app.whenReady();

  // 窗口按加载的 renderer URL 识别
  const character = await waitFor(() => findWindow('character'), 'character window');
  const overlay = await waitFor(() => findWindow('overlay'), 'overlay window');
  const settings = await waitFor(() => findWindow('settings'), 'settings window');
  if (settings.isVisible()) return fail('settings window should stay hidden');
  console.log('[smoke] 3 windows up (character/overlay/settings, settings hidden)');

  await Promise.all(
    [character, overlay].map((w) =>
      waitFor(
        () =>
          w.webContents
            .executeJavaScript('typeof window.desksoul')
            .then((t) => t === 'object'),
        'preload bridge',
      ),
    ),
  );
  console.log('[smoke] window.desksoul bridge present in both renderers');

  // character 侧安插行为通道探针
  await character.webContents.executeJavaScript(`
    window.__smoke = { emotions: [], actions: 0, intents: 0 };
    window.desksoul.on('behavior.applyEmotion', (p) => window.__smoke.emotions.push(p.name));
    window.desksoul.on('behavior.playAction', () => window.__smoke.actions++);
    window.desksoul.on('behavior.setIntent', () => window.__smoke.intents++);
    'ok';
  `);

  // overlay 侧安插文本流探针 + sys.ping 健康检查
  const ping = await overlay.webContents.executeJavaScript(
    `window.desksoul.rpc('sys.ping', { nonce: 'smoke' })`,
  );
  if (ping?.echoNonce !== 'smoke') return fail(`sys.ping broken: ${JSON.stringify(ping)}`);
  console.log('[smoke] sys.ping round-trip ok');

  // schema 校验探针：违约 params 必须被拒
  const rejected = await overlay.webContents.executeJavaScript(
    `window.desksoul.rpc('chat.send', { wrong: 1 }).then(() => false, (e) => String(e.message))`,
  );
  if (!rejected) return fail('invalid chat.send params were not rejected');
  console.log(`[smoke] zod rejection ok (${String(rejected).slice(0, 60)}…)`);

  // 发起对话（E2E 主链路）
  await overlay.webContents.executeJavaScript(`
    window.__smoke = { text: '', done: null };
    window.desksoul.on('chat.stream', (p) => { if (p.sessionId === 'smoke-s1') window.__smoke.text += p.text; });
    window.desksoul.on('chat.done', (p) => { if (p.sessionId === 'smoke-s1') window.__smoke.done = p.finishReason; });
    window.desksoul.rpc('chat.send', { sessionId: 'smoke-s1', text: 'hello' });
  `);

  const overlayResult = await waitFor(
    () =>
      overlay.webContents
        .executeJavaScript('window.__smoke')
        .then((s) => (s.done ? s : null)),
    'chat.done in overlay',
  );
  const charResult = await character.webContents.executeJavaScript('window.__smoke');

  console.log(`[smoke] overlay text: ${JSON.stringify(overlayResult.text)}`);
  console.log(`[smoke] overlay done: ${overlayResult.done}`);
  console.log(`[smoke] character probes: ${JSON.stringify(charResult)}`);

  if (overlayResult.done !== 'stop') return fail(`expected stop done, got ${overlayResult.done}`);
  if (!overlayResult.text.includes('热可可')) return fail('streamed text incomplete');
  if (/<emo:|<act:|\[intent/.test(overlayResult.text))
    return fail('behavior tags leaked into chat.stream');
  if (!charResult.emotions.includes('shy') || !charResult.emotions.includes('happy'))
    return fail(`character missed emotions: ${JSON.stringify(charResult.emotions)}`);
  if (charResult.actions < 1) return fail('character missed playAction');
  if (charResult.intents < 1) return fail('character missed setIntent');

  console.log('[smoke] PASS: dual-track streaming E2E verified');

  // ---- 崩溃隔离：强杀 character renderer → overlay 存活 + character 自愈后链路仍通 ----
  character.webContents.forcefullyCrashRenderer();
  await waitFor(
    () =>
      character.webContents
        .executeJavaScript('typeof window.desksoul')
        .then((t) => t === 'object')
        .catch(() => false),
    'character renderer recovery',
  );
  if (overlay.webContents.isCrashed()) return fail('overlay crashed alongside character');
  console.log('[smoke] character renderer crashed & auto-reloaded; overlay unaffected');

  await character.webContents.executeJavaScript(`
    window.__smoke = { emotions: [], actions: 0, intents: 0 };
    window.desksoul.on('behavior.applyEmotion', (p) => window.__smoke.emotions.push(p.name));
    'ok';
  `);
  await overlay.webContents.executeJavaScript(
    `window.desksoul.rpc('chat.send', { sessionId: 'smoke-s2', text: 'again' })`,
  );
  const recovered = await waitFor(
    () =>
      character.webContents
        .executeJavaScript('window.__smoke')
        .then((s) => (s.emotions.length > 0 ? s : null)),
    'post-crash behavior events',
  );
  console.log(`[smoke] post-crash character probes: ${JSON.stringify(recovered)}`);
  console.log('[smoke] PASS: crash isolation + recovery verified');

  // ---- M2-1: cancel 全链路（流式中取消 → 瞬停 + done(cancel)）----
  await overlay.webContents.executeJavaScript(`
    window.__cancel = { text: '', done: null, seqOk: true };
    window.desksoul.on('chat.stream', (p) => {
      if (p.sessionId !== 'smoke-cancel') return;
      if (typeof p.seq !== 'number') window.__cancel.seqOk = false;
      window.__cancel.text += p.text;
    });
    window.desksoul.on('chat.done', (p) => {
      if (p.sessionId === 'smoke-cancel') window.__cancel.done = p.finishReason;
    });
    window.desksoul.rpc('chat.send', { sessionId: 'smoke-cancel', text: 'cancel me' });
    'ok';
  `);
  await waitFor(
    () => overlay.webContents.executeJavaScript('window.__cancel.text.length > 0'),
    'first delta before cancel',
  );
  const cancelStart = Date.now();
  await overlay.webContents.executeJavaScript(
    `window.desksoul.rpc('chat.cancel', { sessionId: 'smoke-cancel' })`,
  );
  const cancelled = await waitFor(
    () => overlay.webContents.executeJavaScript('window.__cancel').then((s) => (s.done ? s : null)),
    'cancel done',
  );
  const cancelMs = Date.now() - cancelStart;
  if (cancelled.done !== 'cancel') return fail(`expected cancel done, got ${cancelled.done}`);
  if (!cancelled.seqOk) return fail('chat.stream payload missing numeric seq');
  if (cancelMs > 1500) return fail(`cancel took ${cancelMs}ms (200ms 链路 + IPC/CI 余量也不该这么久)`);
  await new Promise((r) => setTimeout(r, 400)); // 留出迟到 delta 的窗口
  const textAfter = await overlay.webContents.executeJavaScript('window.__cancel.text');
  if (textAfter !== cancelled.text) return fail('text kept growing after cancel');
  console.log(`[smoke] PASS: cancel round-trip ${cancelMs}ms, stream frozen after cancel`);

  // ---- M2-2: chat.snapshot 重建（overlay 崩溃自愈 → App.vue 自动恢复历史）----
  // 用 App.vue 的真实 session（default）跑一轮完整对话，让真实 UI 路径渲染它。
  // 等待条件用 chat.done 通知（真条件）而非 DOM 文本——DOM 是代理信号，
  // 与 done 之间隔着一个 chunk 间隔的竞态窗口。
  await overlay.webContents.executeJavaScript(`
    window.__snapDone = null;
    window.desksoul.on('chat.done', (p) => { if (p.sessionId === 'default') window.__snapDone = p.finishReason; });
    window.desksoul.rpc('chat.send', { sessionId: 'default', text: '快照测试' });
    'ok';
  `);
  await waitFor(
    () => overlay.webContents.executeJavaScript('window.__snapDone'),
    'default session done',
  );
  const renderedOk = await overlay.webContents.executeJavaScript(
    `document.body.innerText.includes('热可可')`,
  );
  if (!renderedOk) return fail('default session reply not rendered in overlay UI');
  const snap = await overlay.webContents.executeJavaScript(
    `window.desksoul.rpc('chat.snapshot', { sessionId: 'default' })`,
  );
  if (typeof snap?.seq !== 'number' || snap.streaming !== false)
    return fail(`bad snapshot shape: ${JSON.stringify(snap)}`);
  const lastMsg = snap.messages[snap.messages.length - 1];
  if (
    lastMsg?.role !== 'assistant' ||
    !lastMsg.text.includes('热可可') ||
    lastMsg.finishReason !== 'stop'
  )
    return fail(`bad snapshot tail: ${JSON.stringify(lastMsg)}`);
  console.log('[smoke] chat.snapshot shape ok');

  overlay.webContents.forcefullyCrashRenderer();
  await waitFor(
    () =>
      overlay.webContents
        .executeJavaScript(`document.body.innerText.includes('热可可')`)
        .catch(() => false),
    'overlay rebuilt history from chat.snapshot after crash',
  );
  console.log('[smoke] PASS: overlay crashed & rebuilt conversation via chat.snapshot');

  // ---- M4-1: character.current 经路由返回校验过的 manifest ----
  const cur = await character.webContents.executeJavaScript(
    `window.desksoul.rpc('character.current', {})`,
  );
  if (cur?.characterId !== 'default') return fail(`character.current id: ${cur?.characterId}`);
  if (cur?.manifest?.model !== 'model.vrm') return fail('manifest.model mismatch');
  if (!Array.isArray(cur?.manifest?.actions) || cur.manifest.actions.length !== 8) {
    return fail('manifest.actions should list 8 actions');
  }
  console.log('[smoke] M4 character.current manifest ok');

  // ---- M4-2: asset:// 协议越级不可达、合法路径可达（fetch 从 character 窗口发起）----
  const assetProbe = await character.webContents.executeJavaScript(`(async () => {
    const out = {};
    try { out.evil = (await fetch('asset://default/%2e%2e/%2e%2e/secrets.txt')).status; }
    catch (e) { out.evil = 'blocked:' + String(e).slice(0, 40); }
    try { out.legit = (await fetch('asset://default/manifest.json')).status; }
    catch (e) { out.legit = 'blocked:' + String(e).slice(0, 40); }
    return out;
  })()`);
  // 越级：URL 层可能规范化吞掉 ..、协议层必须 404 —— 唯独不能 200 读到内容
  if (assetProbe.evil === 200) return fail('asset traversal must not succeed');
  if (assetProbe.legit !== 200) return fail(`asset legit fetch: ${JSON.stringify(assetProbe)}`);
  console.log(`[smoke] M4 asset:// ok (evil=${assetProbe.evil}, legit=200)`);

  // ---- M4-3: behavior.lookAt 推到 character（cursor publisher 首拍必发）----
  const lookAt = await waitFor(
    () => character.webContents.executeJavaScript(`window.__charDebug?.lastLookAt ?? null`),
    'behavior.lookAt delivery',
  );
  if (typeof lookAt.x !== 'number' || typeof lookAt.y !== 'number') {
    return fail(`lookAt payload: ${JSON.stringify(lookAt)}`);
  }
  console.log(`[smoke] M4 behavior.lookAt delivered (${lookAt.x},${lookAt.y})`);

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
  console.log('[smoke] M4 setScale 50%/200% bottom-center anchored ok');

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
  console.log(`[smoke] M4 idleTimeout → playAction(${idleAction.name}) round-trip ok`);

  // ---- M4-6: 长按拖拽（连续 moveBy）不得累积放大窗口 ----
  // Windows 非 100% DPI 缩放下 setPosition 每次调用有 DIP↔物理像素舍入漂移，
  // 30Hz 拖拽迅速累积成"模型越拖越大"（125% 缩放实测 40 次涨 36×53px）。
  // 修复后 moveBy 以 Main 持有的期望尺寸 setBounds 锁定；读回值仍可能有 ±1px
  // 的量化噪声（边界舍入），但不随次数累积 —— 80 次后仍须 ≤1px。
  const dragBefore = character.getBounds();
  for (let i = 0; i < 80; i++) {
    await character.webContents.executeJavaScript(
      `window.desksoul.rpc('app.window.moveBy', { dx: 2, dy: 1 })`,
    );
  }
  const dragAfter = character.getBounds();
  if (
    Math.abs(dragAfter.width - dragBefore.width) > 1 ||
    Math.abs(dragAfter.height - dragBefore.height) > 1
  ) {
    return fail(
      `drag must not resize: ${dragBefore.width}x${dragBefore.height} → ${dragAfter.width}x${dragAfter.height}`,
    );
  }
  if (dragAfter.x === dragBefore.x && dragAfter.y === dragBefore.y) {
    return fail('drag did not move the window at all');
  }
  character.setBounds(dragBefore); // 复位站位
  console.log('[smoke] M4 drag keeps window size locked ok');
  console.log('[smoke] PASS: M1+M2+M4 acceptance');
  app.exit(0);
}

main().catch((e) => fail(e?.stack ?? String(e)));
