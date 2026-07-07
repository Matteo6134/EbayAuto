import { beforeEach } from 'vitest';

const guardFetch: typeof fetch = async (input) => {
  throw new Error(`Chiamata di rete reale bloccata nei test: ${String(input)}`);
};

beforeEach(() => {
  globalThis.fetch = guardFetch;
});
