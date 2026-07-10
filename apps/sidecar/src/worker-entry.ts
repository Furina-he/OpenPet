import { parentPort, type MessagePort } from 'node:worker_threads';
import { parseRequest } from '@openpet/protocol';
import { handleRequest } from './server.js';

export function attachServer(port: MessagePort): void {
  port.on('message', async (raw: unknown) => {
    try {
      const req = parseRequest(JSON.stringify(raw));
      const res = await handleRequest(req);
      port.postMessage(res);
    } catch (e) {
      port.postMessage({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error', data: String(e) },
      });
    }
  });
}

if (parentPort) {
  attachServer(parentPort);
}
