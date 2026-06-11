export {};

declare global {
  interface Window {
    desksoul: {
      rpc: (method: string, params?: unknown) => Promise<unknown>;
      on: (channel: string, cb: (payload: unknown) => void) => () => void;
    };
  }
}
