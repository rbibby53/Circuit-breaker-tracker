import { Link } from 'react-router-dom';
import { useTitle } from '../lib/useTitle';

export function NotFoundPage() {
  useTitle('Not found');
  return (
    <main className="content narrow">
      <h1>Page not found</h1>
      <p className="muted">That address doesn't match anything here.</p>
      <p>
        <Link to="/">Go to your sites</Link>
      </p>
    </main>
  );
}
