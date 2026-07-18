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
