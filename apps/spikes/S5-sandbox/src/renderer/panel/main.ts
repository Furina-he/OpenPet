// S5 control panel renderer — runs the sandbox gateway demo and renders each
// adversarial probe as a pass/fail verdict. It speaks only `window.openpet.rpc`
// (sandbox + contextIsolation); the actual jail + gateway live in Main.

interface OpenpetApi {
  rpc: (method: string, params?: unknown) => Promise<unknown>;
}

declare global {
  interface Window {
    openpet: OpenpetApi;
  }
}

interface RunResult {
  ok: true;
  probes: {
    envSecret: string | null;
    envKeys: number;
    fsHosts: string;
    evil: string;
    allowed: string;
    allowedBody?: string;
  };
  blocked: string[];
}

const runBtn = document.getElementById('run') as HTMLButtonElement;
const probesEl = document.getElementById('probes') as HTMLDivElement;

/** One verdict row. `pass` controls the ✓/✗ styling. */
function row(pass: boolean, title: string, detail: string): void {
  const el = document.createElement('div');
  el.className = `probe ${pass ? 'pass' : 'fail'}`;
  el.innerHTML = `
    <div class="verdict">${pass ? '✓' : '✗'}</div>
    <div class="body">
      <div class="title"></div>
      <div class="detail"></div>
    </div>`;
  (el.querySelector('.title') as HTMLElement).textContent = title;
  (el.querySelector('.detail') as HTMLElement).textContent = detail;
  probesEl.appendChild(el);
}

function render(res: RunResult): void {
  probesEl.replaceChildren();
  const p = res.probes;

  // The same four success criteria from RESULTS.md, read off the probe report.
  row(
    p.envSecret === null && p.envKeys === 0,
    'env 中的 secrets 不可读',
    `process.env.SECRET=${JSON.stringify(p.envSecret)} · env 键数=${p.envKeys}`,
  );
  row(
    p.fsHosts === 'ERR_ACCESS_DENIED',
    '读系统文件 (hosts) 被权限模型拒绝',
    `fs.readFileSync → ${p.fsHosts}`,
  );
  row(
    /not allowed/.test(p.evil) && res.blocked.includes('evil.example.com'),
    '非白名单 host 被网关拦截（未发起外网请求）',
    `evil.example.com → ${p.evil}`,
  );
  row(
    p.allowed.startsWith('status'),
    '白名单 host 放行，Authorization 由 Main 注入',
    `api.openai.com → ${p.allowed}${p.allowedBody ? ` · body=${p.allowedBody.slice(0, 60)}` : ''}`,
  );
}

runBtn.addEventListener('click', async () => {
  runBtn.disabled = true;
  probesEl.replaceChildren();
  try {
    const res = (await window.openpet.rpc('sandbox.run')) as RunResult;
    render(res);
  } catch (e) {
    row(false, '运行失败', (e as Error).message);
  } finally {
    runBtn.disabled = false;
  }
});

export {};
