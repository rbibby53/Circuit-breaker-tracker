/** Forget the panels kept on this device for field mode, e.g. when signing out. */
export function clearOfflineData(): void {
  try {
    navigator.serviceWorker?.controller?.postMessage('clear-data');
    void caches?.keys().then((keys) => keys.filter((k) => k.endsWith('-data')).forEach((k) => void caches.delete(k)));
  } catch {
    // No service worker or cache storage here: nothing was kept.
  }
}
