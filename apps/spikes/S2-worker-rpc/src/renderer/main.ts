interface OpenpetApi {
  rpc: (method: string, params?: unknown) => Promise<unknown>;
  killWorker: () => Promise<void>;
}

declare global {
  interface Window {
    openpet: OpenpetApi;
  }
}

const log = document.getElementById('log') as HTMLDivElement;
const pingBtn = document.getElementById('ping') as HTMLButtonElement;
const killBtn = document.getElementById('kill') as HTMLButtonElement;

function append(line: string): void {
  const ts = new Date().toLocaleTimeString();
  log.textContent += `[${ts}] ${line}\n`;
}

let nonce = 0;

pingBtn.addEventListener('click', async () => {
  const n = `n${++nonce}`;
  try {
    const res = await window.openpet.rpc('sys.ping', { nonce: n });
    append(`ping(${n}) → ${JSON.stringify(res)}`);
  } catch (e) {
    append(`ping(${n}) ✗ ${(e as Error).message}`);
  }
});

killBtn.addEventListener('click', async () => {
  await window.openpet.killWorker();
  append('已触发 worker.terminate()，等 ~1s 后再 ping 应自动重连成功');
});

export {};
