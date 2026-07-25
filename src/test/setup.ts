import "@testing-library/jest-dom";

// Node 24 ships an experimental global `localStorage` that stays `undefined`
// unless `--localstorage-file` is passed, and jsdom does not expose its own
// Storage as a bare global here. Result: every test doing `localStorage.clear()`
// throws "Cannot read properties of undefined". Install a deterministic
// in-memory Storage on both globalThis and window so tests are version-proof.
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  } as Storage;
}

for (const name of ["localStorage", "sessionStorage"] as const) {
  const storage = createMemoryStorage();
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value: storage,
  });
  if (typeof window !== "undefined") {
    Object.defineProperty(window, name, {
      configurable: true,
      writable: true,
      value: storage,
    });
  }
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
