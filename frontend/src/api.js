// Resolution order:
//  1. window.__LINKFORGE_CONFIG__.apiBaseUrl — set at container start
//     from the API_BASE_URL env var (production/staging).
//  2. '' (relative) — local dev, where the Vite proxy forwards /api
//     to a backend running on :8080.
function apiBase() {
  return (typeof window !== 'undefined' && window.__LINKFORGE_CONFIG__?.apiBaseUrl) || '';
}

async function request(path, options) {
  const res = await fetch(`${apiBase()}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `request failed with status ${res.status}`);
  }
  return res.json();
}

export function createLink(url) {
  return request('/api/links', { method: 'POST', body: JSON.stringify({ url }) });
}

export function listLinks() {
  return request('/api/links');
}

export function shortUrlFor(code) {
  const base = apiBase() || window.location.origin;
  return `${base}/${code}`;
}
