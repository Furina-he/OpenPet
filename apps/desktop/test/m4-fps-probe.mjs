// M4 验收探针（一次性工具，不进 CI）：真实构建产物上自动采集
//   1. character 窗口渲染形态（须为 vrm）+ 截图（人工核对手臂 rest pose / 表情）
//   2. D4 缩放 50%/100%/200% 三档、各 32s 的 FPS 30s 滚动平均（M4 验收硬指标 ≥30）
// 运行：pnpm build && pnpm --filter @desksoul/desktop exec electron test/m4-fps-probe.mjs
import { app, BrowserWindow } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import '../out/main/index.js';

const OUT_DIR = join(process.cwd(), 'test', 'm4-captures');

function findWindow(name) {
  return (
    BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes(`/${name}/`)) ?? null
  );
}

async function waitFor(probe, what, timeoutMs = 30_000) {
  const start = Date.now();
  for (;;) {
    const v = await Promise.resolve()
      .then(probe)
      .catch(() => null);
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function capture(win, file) {
  const img = await win.webContents.capturePage();
  writeFileSync(join(OUT_DIR, file), img.toPNG());
  console.log(`[probe] captured ${file}`);
}

async function main() {
  await app.whenReady();
  mkdirSync(OUT_DIR, { recursive: true });
  const character = await waitFor(() => findWindow('character'), 'character window');
  const overlay = await waitFor(() => findWindow('overlay'), 'overlay window');

  const mode = await waitFor(
    () => character.webContents.executeJavaScript(`window.__charDebug?.mode ?? null`),
    'character runtime boot',
  );
  console.log(`[probe] renderer mode: ${mode}`);
  if (mode !== 'vrm') {
    console.error('[probe] FAIL: expected vrm mode (model.vrm 缺失?)');
    app.exit(1);
    return;
  }

  // 静置 2s 让首帧/姿态稳定，截 neutral 基准（人工核对手臂自然下垂）
  await sleep(2000);
  await capture(character, 'scale100-neutral.png');

  // 情绪通道驱动 happy / sleepy，截图核对表情映射（含 M4 新增 curious/sleepy 组合）
  character.webContents.send('desksoul:notify:behavior.applyEmotion', { name: 'happy', weight: 1 });
  await sleep(700);
  await capture(character, 'scale100-happy.png');
  character.webContents.send('desksoul:notify:behavior.applyEmotion', { name: 'sleepy', weight: 1 });
  await sleep(700);
  await capture(character, 'scale100-sleepy.png');
  character.webContents.send('desksoul:notify:behavior.applyEmotion', { name: 'neutral', weight: 0 });

  // 动作通道驱动 wave，动作中段截图（人工核对程序化动作形态）
  character.webContents.send('desksoul:notify:behavior.playAction', {
    name: 'wave',
    durationMs: 1800,
  });
  await sleep(900);
  await capture(character, 'scale100-wave-mid.png');
  await sleep(1200);

  // FPS 三档采样：FpsMeter 是 30s 滚动窗，每档等 32s 让窗口完全刷新
  const budget = await character.webContents.executeJavaScript(
    `window.__charDebug.budget()`,
  );
  console.log(`[probe] budget: ${JSON.stringify(budget?.budget)} warnings: ${JSON.stringify(budget?.budgetWarnings)}`);

  const results = {};
  for (const scale of [0.5, 1, 2]) {
    await overlay.webContents.executeJavaScript(
      `window.desksoul.rpc('character.setScale', { scale: ${scale} })`,
    );
    console.log(`[probe] scale=${scale} sampling 32s...`);
    await sleep(32_000);
    const fps = await character.webContents.executeJavaScript(`window.__charDebug.fps()`);
    results[scale] = fps;
    console.log(`[probe] scale=${scale} FPS(30s avg)=${fps.toFixed(1)}`);
    if (scale === 2) await capture(character, 'scale200.png');
  }
  await overlay.webContents.executeJavaScript(
    `window.desksoul.rpc('character.setScale', { scale: 1 })`,
  );

  const allOk = Object.values(results).every((f) => f >= 30);
  console.log(`[probe] RESULT ${allOk ? 'PASS' : 'FAIL'}: ${JSON.stringify(results)}`);
  app.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error(`[probe] FAIL: ${e?.stack ?? e}`);
  app.exit(1);
});
