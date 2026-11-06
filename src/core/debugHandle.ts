/**
 * `window.__ub`: the game's internals for the smoke test, the tuning
 * harnesses (tools/) and the console. main.ts exposes each system where it
 * makes it, so adding one doesn't touch a shared list; the handle goes on the
 * window once the module has run, as the whole object it always was.
 */

const handle: Record<string, unknown> = {};

/** Add `value` to `__ub` as `name` (a name exposed twice throws: two branches merged the same one). */
export function expose(name: string, value: unknown): void {
  if (name in handle) throw new Error(`__ub.${name} exposed twice`);
  handle[name] = value;
}

/** Add a live value (a `let` that changes, such as `paused`) to `__ub` as a getter. */
export function exposeGetter(name: string, get: () => unknown): void {
  if (name in handle) throw new Error(`__ub.${name} exposed twice`);
  Object.defineProperty(handle, name, { get, enumerable: true, configurable: true });
}

/** Put the handle on the window (call once, after everything is exposed). */
export function installDebugHandle(): void {
  (globalThis as unknown as { __ub: unknown }).__ub = handle;
}

/** For tests: the handle as it stands. */
export function debugHandle(): Readonly<Record<string, unknown>> {
  return handle;
}
