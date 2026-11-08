import '@testing-library/jest-dom/vitest'

// Node 25+ has a localStorage / sessionStorage of its own (undefined without --localstorage-file).
// vitest only copies the jsdom window's keys that the global does not have yet, so Node's empty
// ones hide jsdom's. Put jsdom's back; on older Node this does nothing.
const dom = (globalThis as { jsdom?: { window: Window } }).jsdom
if (dom) {
  for (const key of ['localStorage', 'sessionStorage'] as const) {
    if (!globalThis[key]) {
      Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true })
    }
  }
}
