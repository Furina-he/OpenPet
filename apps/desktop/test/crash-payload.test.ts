import { describe, it, expect } from 'vitest';
import { assembleDiag } from '../electron/main/crash-payload';

describe('assembleDiag（J5 脱敏）', () => {
  it('含系统/堆栈/配置摘要；剔除 Key 与对话；日志截 200 行', () => {
    const out = assembleDiag({
      version: '0.1.0',
      platform: 'win32',
      stack: 'Error: boom\n  at x',
      prefs: { 'model.activeProvider': 'openai', 'model.activeModel': 'gpt-4o' },
      logs: Array.from({ length: 500 }, (_, i) => `line ${i}`),
      secrets: { apiKey: 'sk-SHOULD-NOT-APPEAR' },
    });
    expect(out.version).toBe('0.1.0');
    expect(out.config['model.activeProvider']).toBe('openai');
    expect(out.logs).toHaveLength(200); // 最近 200 行
    expect(out.logs[0]).toBe('line 300');
    expect(JSON.stringify(out)).not.toContain('sk-SHOULD-NOT-APPEAR');
    expect(JSON.stringify(out)).not.toContain('apiKey');
  });
});
