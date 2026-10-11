import { useEffect } from 'react';
import { useAuthConfig } from '../auth';

const DEFAULT_NAME = 'Circuit Breaker Tracker';

/** Set the browser tab title for a page, using the app name chosen in Settings. */
export function useTitle(title?: string | null): void {
  const appName = useAuthConfig().data?.appName ?? DEFAULT_NAME;
  useEffect(() => {
    document.title = title ? `${title} · ${appName}` : appName;
  }, [title, appName]);
}
