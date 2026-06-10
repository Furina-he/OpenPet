import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PluginHost, type Egress } from '../electron/main/plugin-host';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The real sandboxed worker, spawned with the production jail flags.
const WORKER = path.join(__dirname, '../worker/sandbox-worker.mjs');

const ALLOWED = 'https://api.openai.com/v1/chat';
const EVIL = 'https://evil.example.com/steal';

let host: PluginHost | null = null;
afterEach(async () => {
  await host?.dispose();
  host = null;
});

describe('PluginHost sandbox gateway', () => {
  it('jails secrets, denies system fs, blocks evil host, allows whitelisted host with key injected', async () => {
    let injectedAuth: string | undefined;
    const egress: Egress = async (_url, init) => {
      injectedAuth = init.headers['Authorization'];
      return { status: 200, body: 'OK from gateway' };
    };
    const blocked: string[] = [];

    host = new PluginHost(WORKER, {
      allowedHosts: ['api.openai.com'],
      keyForHost: (h) => (h === 'api.openai.com' ? 'sk-secret-key' : null),
      egress,
      onBlocked: (h) => blocked.push(h),
    });

    const probes = await host.run(ALLOWED, EVIL);

    // 1) env:{} wiped the environment — no inherited SECRET, zero keys.
    expect(probes.envSecret).toBeNull();
    expect(probes.envKeys).toBe(0);

    // 2) reading a system file is denied by the permission model.
    expect(probes.fsHosts).toBe('ERR_ACCESS_DENIED');

    // 3) the non-whitelisted host never reached egress; the worker got an error.
    expect(String(probes.evil)).toContain('host not allowed');
    expect(blocked).toEqual(['evil.example.com']);

    // 4) the whitelisted host went through, key injected host-side (never in the
    //    worker), and the worker saw a normal 200 response body.
    expect(probes.allowed).toBe('status 200');
    expect(probes.allowedBody).toBe('OK from gateway');
    expect(injectedAuth).toBe('Bearer sk-secret-key');
  });

  it('does not inject Authorization for a whitelisted host with no key', async () => {
    let injectedAuth: string | undefined = 'unset';
    const egress: Egress = async (_url, init) => {
      injectedAuth = init.headers['Authorization'];
      return { status: 204, body: '' };
    };

    host = new PluginHost(WORKER, {
      allowedHosts: ['api.openai.com'],
      keyForHost: () => null,
      egress,
    });

    const probes = await host.run(ALLOWED, EVIL);
    expect(probes.allowed).toBe('status 204');
    expect(injectedAuth).toBeUndefined();
  });
});
