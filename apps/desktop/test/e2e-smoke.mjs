// M1 端到端冒烟（自动化）：加载真实构建产物启动完整 app（三窗口 + router + worker），
// 然后驱动 impl-plan M1 的验收链路：
//   overlay 发 chat.send → Main 路由 → mock provider worker → ConversationCore 双轨
//   → broadcast → overlay 收 chat.stream/chat.done、character 收 behavior.applyEmotion
// 退出码 0 = 验收通过。M8 会升级为 Playwright with Electron 跑 packaged app。
//
// 运行：pnpm --filter @desksoul/desktop exec electron test/e2e-smoke.mjs
//（先 pnpm build；file:// 模式下 VRM 模型不可达 → character 走 fallback 脸，
//  与判据无关：判据是 behavior.* 通道驱动 renderer，不是渲染形态。）
import { app, BrowserWindow } from 'electron';

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
  // 启动真实 app（whenReady 内创建三窗口 + 注册路由）
  await import('../out/main/index.js');
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
  app.exit(0);
}

main().catch((e) => fail(e?.stack ?? String(e)));
