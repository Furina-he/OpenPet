// S5 adversarial worker — stands in for an untrusted third-party Provider plugin.
//
// It runs inside the jail the PluginHost builds for it:
//   - env: {}                       → no ambient secrets (process.env is empty)
//   - --permission --allow-fs-read  → fs limited to its own code dir; system
//                                     files are off-limits
//   - globalThis.fetch proxied      → every request goes to the Main PluginHost,
//                                     which alone holds the host whitelist + keys
//
// On `run` it deliberately attempts the things a hostile plugin would try, and
// reports what happened. The success criteria (RESULTS.md) read straight off the
// returned `probes`: secrets unreadable, system fs denied, evil host rejected,
// whitelisted host allowed (with Authorization injected host-side).
import { parentPort } from 'node:worker_threads';
import { installFetchProxy } from './fetch-proxy.mjs';

if (!parentPort) throw new Error('sandbox-worker must run inside a worker');

// Swap real fetch for the MessagePort proxy before any plugin code could run.
installFetchProxy();

parentPort.on('message', async (msg) => {
  if (!msg || msg.kind !== 'run') return;
  const { allowedUrl, evilUrl } = msg;
  const probes = {};

  // 1) Secrets via env — env:{} should have wiped the inherited environment.
  probes.envSecret = process.env.SECRET ?? null;
  probes.envKeys = Object.keys(process.env).length;

  // 2) Read a system file — the permission model should deny anything outside
  //    the worker's own --allow-fs-read scope.
  try {
    const fs = await import('node:fs');
    fs.readFileSync('C:\\Windows\\System32\\drivers\\etc\\hosts');
    probes.fsHosts = 'READ_OK'; // FAILURE: jail leaked
  } catch (e) {
    probes.fsHosts = e.code ?? e.message;
  }

  // 3) Fetch a NON-whitelisted host — the gateway must reject before any
  //    network egress (the worker never learns the verdict's reason but us).
  try {
    const r = await fetch(evilUrl);
    probes.evil = `status ${r.status}`; // FAILURE: gateway let it through
  } catch (e) {
    probes.evil = e.message;
  }

  // 4) Fetch a whitelisted host — the gateway allows it and injects the API key
  //    host-side. The worker sees a normal Response; it never touches the key.
  try {
    const r = await fetch(allowedUrl);
    probes.allowed = `status ${r.status}`;
    probes.allowedBody = await r.text();
  } catch (e) {
    probes.allowed = `ERR ${e.message}`;
  }

  parentPort.postMessage({ kind: 'probes', probes });
});
