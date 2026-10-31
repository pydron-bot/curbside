/**
 * Android / desktop Chrome and Edge: the browser's own install prompt, kept
 * for an INSTALL button. The event can fire before any UI exists, so it's
 * caught from import. iOS Safari never fires it (the title shows its Add to
 * Home Screen tip instead), and an installed copy never sees it.
 */
interface InstallEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallEvent | null = null;
const listeners = new Set<(available: boolean) => void>();

function notify(): void {
  for (const l of listeners) l(deferred !== null);
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Our button instead of the browser's mini-infobar.
    e.preventDefault();
    deferred = e as InstallEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

/** Called now and whenever installing becomes possible or stops being so. Returns an unsubscribe. */
export function onInstallAvailable(listener: (available: boolean) => void): () => void {
  listeners.add(listener);
  listener(deferred !== null);
  return () => listeners.delete(listener);
}

/** Show the browser's install prompt (needs a user gesture). Each prompt event can be used once. */
export async function promptInstall(): Promise<void> {
  const e = deferred;
  if (!e) return;
  deferred = null;
  notify();
  try {
    await e.prompt();
    await e.userChoice;
  } catch {
    // Dismissed or not allowed: the browser fires a fresh event when it'll offer again.
  }
}
