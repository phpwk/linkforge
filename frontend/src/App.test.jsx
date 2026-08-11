import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, test, expect, vi, beforeEach } from 'vitest';
import App from './App';

function mockFetchSequence(responses) {
  let call = 0;
  global.fetch = vi.fn(() => {
    const r = responses[Math.min(call, responses.length - 1)];
    call += 1;
    return Promise.resolve({
      ok: r.ok,
      status: r.status,
      json: () => Promise.resolve(r.body),
    });
  });
}

beforeEach(() => {
  window.__LINKFORGE_CONFIG__ = { apiBaseUrl: '' };
});

describe('App', () => {
  test('loads and displays existing links on mount', async () => {
    mockFetchSequence([
      { ok: true, status: 200, body: [{ code: 'abc1234', originalUrl: 'https://example.com', clicks: 3 }] },
    ]);
    render(<App />);
    expect(await screen.findByText('https://example.com')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  test('submits a new url and refreshes the list', async () => {
    mockFetchSequence([
      { ok: true, status: 200, body: [] }, // initial load
      { ok: true, status: 201, body: { code: 'newcode', originalUrl: 'https://new.example', createdAt: '' } }, // create
      { ok: true, status: 200, body: [{ code: 'newcode', originalUrl: 'https://new.example', clicks: 0 }] }, // refresh
    ]);
    render(<App />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText(/url to shorten/i), { target: { value: 'https://new.example' } });
    fireEvent.click(screen.getByRole('button', { name: /shorten/i }));

    expect(await screen.findByText('https://new.example')).toBeInTheDocument();
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test('shows an error message when the API rejects the submission', async () => {
    mockFetchSequence([
      { ok: true, status: 200, body: [] },
      { ok: false, status: 400, body: { error: 'url must be an absolute http(s) URL' } },
    ]);
    render(<App />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText(/url to shorten/i), { target: { value: 'not-a-url' } });
    fireEvent.click(screen.getByRole('button', { name: /shorten/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/absolute http/i);
  });
});
