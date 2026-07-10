import { describe, it, expect, vi } from 'vitest';
import { createAppService } from '../electron/main/app-service';

describe('app-service · openExternal', () => {
  it('opens http(s) urls via the injected opener', async () => {
    const opener = vi.fn();
    const svc = createAppService({ openExternal: opener });
    const r = await svc['app.openExternal']({ url: 'https://github.com/Furina-he/openpet' });
    expect(r).toEqual({ ok: true });
    expect(opener).toHaveBeenCalledWith('https://github.com/Furina-he/openpet');
  });
  it('refuses non-http(s) schemes with -32602 and does not open', async () => {
    const opener = vi.fn();
    const svc = createAppService({ openExternal: opener });
    await expect(svc['app.openExternal']({ url: 'file:///etc/passwd' })).rejects.toMatchObject({
      code: -32602,
    });
    expect(opener).not.toHaveBeenCalled();
  });
});
