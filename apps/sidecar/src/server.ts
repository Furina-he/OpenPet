import type { JsonRpcRequest, JsonRpcResponse } from '@openpet/protocol';

export async function handleRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
  if (req.method === 'sys.ping') {
    const p = req.params as { nonce: string };
    return { jsonrpc: '2.0', id: req.id, result: { pong: 'ok', echoNonce: p.nonce } };
  }
  return {
    jsonrpc: '2.0',
    id: req.id,
    error: { code: -32601, message: 'Method not found' },
  };
}
