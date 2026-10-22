/* eslint-disable @typescript-eslint/no-explicit-any */
class IntersectionObserverMock {
  callback: any;
  constructor(callback: any) {
    this.callback = callback;
  }
  disconnect() {}
  observe(element: any) {
    this.callback([{ isIntersecting: true, target: element }], this);
  }
  takeRecords() { return []; }
  unobserve() {}
}

global.IntersectionObserver = IntersectionObserverMock as any;
if (typeof window !== 'undefined') {
  window.IntersectionObserver = IntersectionObserverMock as any;
}

// Node 25+ exposes its own `localStorage` global, which without
// --localstorage-file is a stub whose methods are undefined. It shadows the
// jsdom Storage, so every localStorage read in a test throws. Swap in a plain
// in-memory Storage so the tests see browser behavior on any Node version.
class MemoryStorage {
  private items = new Map<string, string>();
  get length() { return this.items.size; }
  key(index: number) { return [...this.items.keys()][index] ?? null; }
  getItem(key: string) { return this.items.get(key) ?? null; }
  setItem(key: string, value: string) { this.items.set(key, String(value)); }
  removeItem(key: string) { this.items.delete(key); }
  clear() { this.items.clear(); }
}

if (typeof globalThis.localStorage?.getItem !== 'function') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}
