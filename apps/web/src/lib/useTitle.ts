import { useEffect } from 'react';

const APP = 'Circuit Breaker Tracker';

/** Set the browser tab title for a page. */
export function useTitle(title?: string | null): void {
  useEffect(() => {
    document.title = title ? `${title} · ${APP}` : APP;
  }, [title]);
}
