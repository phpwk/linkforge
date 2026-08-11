import { useEffect, useState } from 'react';
import { createLink, listLinks, shortUrlFor } from './api';

export default function App() {
  const [url, setUrl] = useState('');
  const [links, setLinks] = useState([]);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  async function refresh() {
    try {
      setLinks(await listLinks());
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await createLink(url);
      setUrl('');
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <h1>LinkForge</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="url-input">URL to shorten</label>
        <input
          id="url-input"
          type="text"
          value={url}
          placeholder="https://example.com/a/long/path"
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <button type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Shorten'}
        </button>
      </form>

      {error && <p role="alert">{error}</p>}

      <table>
        <thead>
          <tr>
            <th>Short link</th>
            <th>Destination</th>
            <th>Clicks</th>
          </tr>
        </thead>
        <tbody>
          {links.map((link) => (
            <tr key={link.code}>
              <td>
                <a href={shortUrlFor(link.code)}>{shortUrlFor(link.code)}</a>
              </td>
              <td>{link.originalUrl}</td>
              <td>{link.clicks}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
