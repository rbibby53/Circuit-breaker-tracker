import { useState } from 'react';
import { useAuthConfig } from '../auth';
import { initials } from './Layout';

/** A person's Gravatar picture when there is one (and Settings allow it), otherwise their initials. */
export function Avatar({
  name,
  url,
  light = false,
}: {
  name: string;
  url: string | null | undefined;
  light?: boolean;
}) {
  const config = useAuthConfig();
  // Gravatar answers 404 when there is no picture. Initials show until a picture has loaded,
  // so a slow or blocked gravatar.com never leaves an empty circle.
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const tryPicture = config.data?.gravatar && url && failed !== url;
  const showing = tryPicture && loaded === url;
  return (
    <span className={`avatar${light ? ' avatar-light' : ''}${showing ? ' has-picture' : ''}`} aria-hidden="true">
      <span className="avatar-initials">{initials(name)}</span>
      {tryPicture && (
        <img
          src={url}
          alt=""
          referrerPolicy="no-referrer"
          loading="lazy"
          onLoad={() => setLoaded(url)}
          onError={() => setFailed(url)}
        />
      )}
    </span>
  );
}
